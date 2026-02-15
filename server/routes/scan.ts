import type { Express, Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { businesses as businessesTable, campaigns as campaignsTable, leads as leadsTable, aiResponses as aiResponsesTable } from "@shared/schema";
import { ai, safeParseJsonFromAI, TONE_MAP, MIN_POST_LENGTH, MIN_SCAN_INTENT_SCORE } from "../utils/ai";
import { escapeHtml } from "../utils/html";
import { getFeedbackGuidance } from "../utils/feedback";
import { createRateLimiter } from "../utils/rate-limit";
import { generateScanToken } from "../telegram-bot";
import { sendTelegramMessageToChat } from "../telegram";

const scanRateLimit = createRateLimiter({
  name: "scan-endpoints",
  maxRequests: 15,
  windowMs: 60 * 1000,
  keyFn: (req) => String(req.body?.chatId || req.ip || "unknown"),
});

function setCorsHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
}

function corsOptions(_req: Request, res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
}

async function validateScanRequest(req: Request): Promise<
  | { valid: true; chatId: string; businessId: number; postText: string; business: any; bizCampaigns: any[] }
  | { valid: false; error: { matched: false; reason: string } }
> {
  const { chatId, businessId, token, postText } = req.body;

  if (!chatId || !businessId || !postText || typeof postText !== "string" || !token) {
    return { valid: false, error: { matched: false, reason: "missing_fields" } };
  }

  const expectedToken = generateScanToken(String(chatId), Number(businessId));
  if (token !== expectedToken) {
    return { valid: false, error: { matched: false, reason: "invalid_token" } };
  }

  if (postText.length < MIN_POST_LENGTH) {
    return { valid: false, error: { matched: false, reason: "too_short" } };
  }

  const biz = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  if (biz.length === 0) {
    return { valid: false, error: { matched: false, reason: "business_not_found" } };
  }

  const bizCampaigns = await db.select().from(campaignsTable).where(eq(campaignsTable.businessId, businessId));
  return { valid: true, chatId: String(chatId), businessId: Number(businessId), postText, business: biz[0], bizCampaigns };
}

async function handleScanRequest(
  platform: "facebook" | "linkedin",
  business: any,
  bizCampaigns: any[],
  postText: string,
  chatId: string,
  meta: { groupName?: string; authorName?: string; pageUrl?: string }
) {
  const allKeywords = bizCampaigns.flatMap(c => (c.keywords as string[]) || []);
  const lower = postText.toLowerCase();
  const hasKeyword = allKeywords.some(kw => lower.includes(kw.toLowerCase()));
  if (!hasKeyword) {
    return { matched: false, reason: "no_keyword_match" };
  }

  const platformLabel = platform === "facebook" ? "Facebook" : "LinkedIn";
  const contextLabel = platform === "facebook"
    ? `post from "${meta.groupName || "a Facebook group"}"`
    : `post by "${meta.authorName || "someone"}"`;

  const matchResult = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are a lead scout for "${business.name}" (${business.type}).
They offer: ${business.coreOffering}

Analyze this ${platformLabel} ${contextLabel}:
"${postText.slice(0, 500)}"

Is this person asking a question or seeking help/recommendations that "${business.name}" could address?
Rate the intent from 1-10 (10 = actively looking for exactly what this business offers).

Return ONLY valid JSON:
{"is_lead": true/false, "intent_score": <1-10>, "reasoning": "<one sentence>"}`,
    config: { maxOutputTokens: 512 },
  });

  const match = safeParseJsonFromAI(matchResult.text || "");
  if (!match) {
    return { matched: false, reason: "ai_parse_error" };
  }

  if (!match.is_lead || match.intent_score < MIN_SCAN_INTENT_SCORE) {
    return { matched: false, reason: "low_intent", score: match.intent_score };
  }

  const feedbackGuidance = await getFeedbackGuidance(business.id);
  const toneDesc = platform === "linkedin" ? "professional and helpful" : "friendly and helpful";
  const responseStyle = platform === "linkedin"
    ? "a natural, professional LinkedIn comment (2-3 sentences). Sound like a real professional sharing knowledge or a recommendation. Keep it conversational but polished for LinkedIn."
    : "a natural, human-sounding comment (2-3 sentences). Do NOT make it sound like an ad. Sound like a real person sharing a helpful recommendation.";

  const responseResult = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: `You are writing a ${platformLabel} comment${platform === "facebook" ? " in a community group" : " on a professional post"}. Your goal is to be genuinely helpful while subtly recommending a business.

The ${contextLabel}: "${postText.slice(0, 500)}"

Business to recommend: ${business.name}
What they do: ${business.coreOffering}
Tone: ${TONE_MAP[business.preferredTone] || toneDesc}
${feedbackGuidance}

Write ${responseStyle} Include the business name naturally.

Return ONLY the response text, no quotes or formatting.`,
    config: { maxOutputTokens: 8192 },
  });

  const responseText = (responseResult.text || "").trim();
  if (!responseText) {
    return { matched: true, score: match.intent_score, reason: "no_response_generated" };
  }

  let savedResponseId: number | null = null;
  const targetCampaign = platform === "linkedin"
    ? (bizCampaigns.find(c => c.platform === "LinkedIn") || bizCampaigns[0])
    : bizCampaigns[0];

  if (targetCampaign) {
    try {
      const [savedLead] = await db.insert(leadsTable).values({
        campaignId: targetCampaign.id,
        platform,
        groupName: meta.groupName || `${platformLabel} ${platform === "linkedin" ? "Feed" : "Group"}`,
        authorName: meta.authorName || `${platformLabel} user`,
        originalPost: postText.slice(0, 2000),
        postUrl: meta.pageUrl || null,
        intentScore: match.intent_score,
        status: "matched",
      }).returning();

      if (savedLead) {
        const [savedResponse] = await db.insert(aiResponsesTable).values({
          leadId: savedLead.id,
          content: responseText,
          status: "pending",
        }).returning();
        savedResponseId = savedResponse?.id || null;
      }
    } catch (err) {
      console.error(`Error saving ${platformLabel} scan lead:`, err);
    }
  }

  const scoreBar = "*".repeat(match.intent_score) + "_".repeat(10 - match.intent_score);
  let msg = `<b>${platformLabel} Lead Found</b>\n\n`;
  msg += `<b>Business:</b> ${escapeHtml(business.name)}\n`;
  if (platform === "facebook") {
    msg += `<b>Group:</b> ${escapeHtml(meta.groupName || "Facebook Group")}\n`;
  } else {
    msg += `<b>Author:</b> ${escapeHtml(meta.authorName || "LinkedIn user")}\n`;
  }
  msg += `<b>Intent:</b> ${scoreBar} ${match.intent_score}/10\n`;
  msg += `<b>Why:</b> ${escapeHtml(match.reasoning || "")}\n\n`;
  msg += `<b>Post:</b>\n<i>"${escapeHtml(postText.slice(0, 200))}"</i>`;

  if (meta.pageUrl) {
    msg += `\n\nTap "Open ${platformLabel} Post" below, then paste the reply.`;
  }

  const prefix = platform === "facebook" ? "fb" : "li";
  const buttons: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
  if (meta.pageUrl) {
    buttons.push([{ text: `Open ${platformLabel} Post`, url: meta.pageUrl }]);
  }
  if (savedResponseId) {
    buttons.push([
      { text: "Used It", callback_data: `${prefix}_good_${savedResponseId}` },
      { text: "Bad Match", callback_data: `${prefix}_bad_${savedResponseId}` },
      { text: "Too Salesy", callback_data: `${prefix}_salesy_${savedResponseId}` },
      { text: "Wrong Client", callback_data: `${prefix}_wrong_${savedResponseId}` },
    ]);
  }

  await sendTelegramMessageToChat(chatId, msg, buttons.length > 0 ? { buttons } : undefined);
  await sendTelegramMessageToChat(chatId, responseText);

  return { matched: true, score: match.intent_score };
}

export function registerScanRoutes(app: Express) {
  app.options("/api/fb-scan", corsOptions);
  app.options("/api/li-scan", corsOptions);

  app.post("/api/fb-scan", scanRateLimit, setCorsHeaders, async (req, res) => {
    try {
      const validation = await validateScanRequest(req);
      if (!validation.valid) { res.json(validation.error); return; }

      const { chatId, postText, business, bizCampaigns } = validation;
      const { groupName, pageUrl } = req.body;
      const result = await handleScanRequest("facebook", business, bizCampaigns, postText, chatId, { groupName, pageUrl });
      res.json(result);
    } catch (error) {
      console.error("FB scan error:", error);
      res.json({ matched: false, reason: "server_error" });
    }
  });

  app.post("/api/li-scan", scanRateLimit, setCorsHeaders, async (req, res) => {
    try {
      const validation = await validateScanRequest(req);
      if (!validation.valid) { res.json(validation.error); return; }

      const { chatId, postText, business, bizCampaigns } = validation;
      const { authorName, pageUrl } = req.body;
      const result = await handleScanRequest("linkedin", business, bizCampaigns, postText, chatId, { authorName, pageUrl });
      res.json(result);
    } catch (error) {
      console.error("LinkedIn scan error:", error);
      res.json({ matched: false, reason: "server_error" });
    }
  });
}
