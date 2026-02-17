import type { Express, Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { businesses as businessesTable, campaigns as campaignsTable, leads as leadsTable, aiResponses as aiResponsesTable } from "@shared/schema";
import type { Business, Campaign } from "@shared/schema";
import { generateContent, safeParseJsonFromAI, TONE_MAP, MIN_POST_LENGTH, MIN_SCAN_INTENT_SCORE } from "../utils/ai";
import { escapeHtml } from "../utils/html";
import { getFeedbackGuidance } from "../utils/feedback";
import { keywordMatch } from "../utils/keywords";
import { createRateLimiter } from "../utils/rate-limit";
import { markOwnResponse, isOwnResponse } from "../utils/dedup";
import { validateScanToken } from "../telegram/bookmarklets";
import { sendTelegramMessageToChat } from "../telegram";
import { isMonitoringEnabled } from "./admin";

const scanRateLimit = createRateLimiter({
  name: "scan-endpoints",
  maxRequests: 120,
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
  | { valid: true; chatId: string; businessId: number; postText: string; business: Business; bizCampaigns: Campaign[] }
  | { valid: false; error: { matched: false; reason: string } }
> {
  const { chatId, businessId, token, postText } = req.body;

  if (!isMonitoringEnabled()) {
    return { valid: false, error: { matched: false, reason: "monitoring_disabled" } };
  }

  if (!chatId || !businessId || !postText || typeof postText !== "string" || !token) {
    return { valid: false, error: { matched: false, reason: "missing_fields" } };
  }

  if (!validateScanToken(String(chatId), Number(businessId), token)) {
    return { valid: false, error: { matched: false, reason: "invalid_token" } };
  }

  if (postText.length < MIN_POST_LENGTH) {
    return { valid: false, error: { matched: false, reason: "too_short" } };
  }

  const biz = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  if (biz.length === 0) {
    return { valid: false, error: { matched: false, reason: "business_not_found" } };
  }

  const allBizCampaigns = await db.select().from(campaignsTable).where(eq(campaignsTable.businessId, businessId));
  const bizCampaigns = allBizCampaigns.filter(c => c.status === "active");
  if (bizCampaigns.length === 0) {
    return { valid: false, error: { matched: false, reason: "all_campaigns_paused" } };
  }
  return { valid: true, chatId: String(chatId), businessId: Number(businessId), postText, business: biz[0], bizCampaigns };
}

const TWO_WEEKS_HOURS = 14 * 24;

function parsePostAgeHours(ageStr: string): number | null {
  if (!ageStr || typeof ageStr !== "string") return null;
  const s = ageStr.trim().toLowerCase();
  let m = s.match(/^(\d+)\s*s$/);
  if (m) return 0;
  m = s.match(/^(\d+)\s*m$/);
  if (m) return parseFloat(m[1]) / 60;
  m = s.match(/^(\d+)\s*(h|hr|hrs)$/);
  if (m) return parseFloat(m[1]);
  m = s.match(/^(\d+)\s*d$/);
  if (m) return parseFloat(m[1]) * 24;
  m = s.match(/^(\d+)\s*w$/);
  if (m) return parseFloat(m[1]) * 24 * 7;
  m = s.match(/^(\d+)\s*(mo)$/);
  if (m) return parseFloat(m[1]) * 24 * 30;
  m = s.match(/^(\d+)\s*(y|yr|yrs)$/);
  if (m) return parseFloat(m[1]) * 24 * 365;
  if (s === "just now") return 0;
  if (s === "yesterday") return 24;
  m = s.match(/^(\d+)\s+(min|minute|mins)s?\s+ago$/);
  if (m) return parseFloat(m[1]) / 60;
  m = s.match(/^(\d+)\s+(hour|hr|hours|hrs)\s+ago$/);
  if (m) return parseFloat(m[1]);
  m = s.match(/^(\d+)\s+days?\s+ago$/);
  if (m) return parseFloat(m[1]) * 24;
  m = s.match(/^(\d+)\s+weeks?\s+ago$/);
  if (m) return parseFloat(m[1]) * 24 * 7;
  m = s.match(/^(\d+)\s+(month|months|mo)\s+ago$/);
  if (m) return parseFloat(m[1]) * 24 * 30;
  m = s.match(/^(\d+)\s+(year|years|yr|yrs)\s+ago$/);
  if (m) return parseFloat(m[1]) * 24 * 365;

  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  m = s.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
  if (m && months[m[1]] !== undefined) {
    const year = m[3] ? parseInt(m[3]) : new Date().getFullYear();
    const date = new Date(year, months[m[1]], parseInt(m[2]));
    if (!isNaN(date.getTime())) {
      const hours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
      return hours > 0 ? hours : null;
    }
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const year = parseInt(m[3]) < 100 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
    const date = new Date(year, parseInt(m[1]) - 1, parseInt(m[2]));
    if (!isNaN(date.getTime())) {
      const hours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
      return hours > 0 ? hours : null;
    }
  }
  return null;
}

async function handleScanRequest(
  platform: "facebook" | "linkedin",
  business: Business,
  bizCampaigns: Campaign[],
  postText: string,
  chatId: string,
  meta: { groupName?: string; authorName?: string; pageUrl?: string; postAge?: string }
) {
  if (await isOwnResponse(postText)) {
    return { matched: false, reason: "own_response" };
  }

  const allKeywords = bizCampaigns.flatMap(c => (c.keywords as string[]) || []);
  if (!keywordMatch(postText, allKeywords)) {
    return { matched: false, reason: "no_keyword_match" };
  }

  const platformLabel = platform === "facebook" ? "Facebook" : "LinkedIn";
  const contextLabel = platform === "facebook"
    ? `post from "${meta.groupName || "a Facebook group"}"`
    : `post by "${meta.authorName || "someone"}"`;

  const matchResult = await generateContent({
    model: "gemini-2.5-flash",
    contents: `You are a lead scout for "${business.name}" (${business.type}).
They offer: ${business.coreOffering}

Analyze this ${platformLabel} ${contextLabel}:
"${postText.slice(0, 500)}"

Is this person asking a question or seeking help/recommendations that "${business.name}" could address?

SCORING GUIDE (be strict and spread scores across the full range):
1-2: Completely unrelated topic, no connection to business
3-4: Loosely related topic but NOT asking for help or recommendations
5-6: Related topic, asking a question, but not specifically looking for what this business offers
7-8: Clearly seeking help/recommendations in this business's area
9-10: Actively looking for EXACTLY what this business offers, urgent need, ready to buy/act

IMPORTANT: Return ONLY a single JSON object with no other text, no explanation, no markdown:
{"is_lead": true, "intent_score": 5, "reasoning": "one sentence explanation"}`,
    config: { maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
  });

  const match = safeParseJsonFromAI(matchResult.text);
  if (!match) {
    console.error(`${platform} scan: AI parse error for "${business.name}"`);
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

  const responseResult = await generateContent({
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

  const responseText = responseResult.text.trim();
  if (!responseText) {
    return { matched: true, score: match.intent_score, reason: "no_response_generated" };
  }

  await markOwnResponse(responseText);

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

  const postAgeHours = parsePostAgeHours(meta.postAge || "");
  const isTooOld = postAgeHours !== null && postAgeHours > TWO_WEEKS_HOURS;

  if (isTooOld) {
    console.log(`${platform} scan: lead saved but skipping Telegram (post age: ${meta.postAge})`);
    return { matched: true, score: match.intent_score, notified: false, reason: "post_too_old" };
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
  if (meta.postAge) {
    const ageText = meta.postAge.trim().toLowerCase();
    const needsAgo = !ageText.includes("ago") && ageText !== "just now" && ageText !== "yesterday";
    msg += `<b>Posted:</b> ${escapeHtml(meta.postAge)}${needsAgo ? " ago" : ""}\n`;
  }
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

  return { matched: true, score: match.intent_score, notified: true };
}

export function registerScanRoutes(app: Express) {
  app.options("/api/fb-scan", corsOptions);
  app.options("/api/li-scan", corsOptions);

  app.post("/api/fb-scan", scanRateLimit, setCorsHeaders, async (req, res) => {
    try {
      const validation = await validateScanRequest(req);
      if (!validation.valid) { res.json(validation.error); return; }

      const { chatId, postText, business, bizCampaigns } = validation;
      const { groupName, pageUrl, postAge } = req.body;
      const result = await handleScanRequest("facebook", business, bizCampaigns, postText, chatId, { groupName, pageUrl, postAge });
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
