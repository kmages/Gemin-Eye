import { db } from "../db";
import { businesses, campaigns, leads, aiResponses, responseFeedback } from "@shared/schema";
import { eq } from "drizzle-orm";
import { generateContent, safeParseJsonFromAI } from "../utils/ai";
import { escapeHtml } from "../utils/html";
import { getFeedbackGuidance } from "../utils/feedback";
import { markOwnResponse } from "../utils/dedup";

export interface BusinessWithCampaigns {
  id: number;
  name: string;
  type: string;
  targetAudience: string;
  coreOffering: string;
  preferredTone: string;
  campaigns: Array<{
    id: number;
    name: string;
    platform: string;
    keywords: string[];
    targetGroups: string[];
  }>;
}

export async function getAllBusinessesWithCampaigns(): Promise<BusinessWithCampaigns[]> {
  const allBiz = await db.select().from(businesses);
  const allCamps = await db.select().from(campaigns);

  return allBiz.map((b) => ({
    id: b.id,
    name: b.name,
    type: b.type,
    targetAudience: b.targetAudience,
    coreOffering: b.coreOffering,
    preferredTone: b.preferredTone,
    campaigns: allCamps
      .filter((c) => c.businessId === b.id && c.status === "active")
      .map((c) => ({
        id: c.id,
        name: c.name,
        platform: c.platform,
        keywords: (c.keywords as string[]) || [],
        targetGroups: (c.targetGroups as string[]) || [],
      })),
  }));
}

const URL_REGEX = /https?:\/\/(?:www\.)?(?:reddit\.com|old\.reddit\.com|redd\.it|facebook\.com|fb\.com|m\.facebook\.com)[^\s)>\]]+/gi;

export function extractPostUrl(text: string): string | null {
  const matches = text.match(URL_REGEX);
  return matches ? matches[0] : null;
}

export function stripUrls(text: string): string {
  return text.replace(URL_REGEX, "").trim();
}

export function detectPlatformFromUrl(url: string): "reddit" | "facebook" | null {
  if (/reddit\.com|redd\.it/i.test(url)) return "reddit";
  if (/facebook\.com|fb\.com/i.test(url)) return "facebook";
  return null;
}

export function detectPlatformFromText(text: string): "reddit" | "facebook" | null {
  const lower = text.toLowerCase();
  if (lower.includes("reddit") || lower.includes("r/") || lower.includes("/r/")) return "reddit";
  if (lower.includes("facebook") || lower.includes("fb group")) return "facebook";
  return null;
}

export interface ImageExtraction {
  text: string;
  platform: "reddit" | "facebook" | null;
  groupName: string | null;
  authorName: string | null;
  postUrl: string | null;
}

function detectMimeType(filePath: string): string {
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function downloadTelegramPhotoWithMime(fileId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  try {
    const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });
    const fileData = await fileRes.json() as any;
    if (!fileData.ok || !fileData.result?.file_path) return null;

    const filePath = fileData.result.file_path as string;
    const mimeType = detectMimeType(filePath);
    const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const imgRes = await fetch(downloadUrl);
    if (!imgRes.ok) return null;

    const arrayBuf = await imgRes.arrayBuffer();
    return { buffer: Buffer.from(arrayBuf), mimeType };
  } catch (error) {
    console.error("Error downloading Telegram photo:", error);
    return null;
  }
}

export async function extractTextFromImage(imageBuffer: Buffer, mimeType: string): Promise<ImageExtraction | null> {
  try {
    const base64Image = imageBuffer.toString("base64");

    const result = await generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Image,
              },
            },
            {
              text: `You are analyzing a screenshot of a social media post. Extract the following information:

1. The full text content of the post (the main body/question being asked)
2. The platform (Reddit or Facebook) - look for visual cues like Reddit's upvote arrows, subreddit names (r/...), Facebook's blue header, group names, like/comment buttons
3. The group or subreddit name if visible
4. The author's name/username if visible

Return ONLY valid JSON:
{
  "post_text": "<the full text of the post>",
  "platform": "<reddit or facebook or unknown>",
  "group_name": "<group or subreddit name, or null>",
  "author_name": "<author name or null>",
  "post_url": "<any visible URL in the screenshot, or null>"
}

If you cannot read any text from the image, return: {"post_text": "", "platform": "unknown", "group_name": null, "author_name": null, "post_url": null}`,
            },
          ],
        },
      ],
      config: { maxOutputTokens: 2048 },
    });

    const responseText = result.text;
    const parsed = safeParseJsonFromAI(responseText);
    if (!parsed) return null;
    if (!parsed.post_text || parsed.post_text.length < 3) return null;

    let platform: "reddit" | "facebook" | null = null;
    if (parsed.platform === "reddit") platform = "reddit";
    else if (parsed.platform === "facebook") platform = "facebook";

    return {
      text: parsed.post_text,
      platform,
      groupName: parsed.group_name || null,
      authorName: parsed.author_name || null,
      postUrl: parsed.post_url || null,
    };
  } catch (error) {
    console.error("Error extracting text from image:", error);
    return null;
  }
}

export interface PostAnalysis {
  message: string;
  responseText: string | null;
  postUrl: string | null;
  platform: "reddit" | "facebook" | null;
  responseId: number | null;
  needsGroupContext: boolean;
}

export async function handlePost(postText: string, groupName?: string, postUrl?: string | null, overridePlatform?: "reddit" | "facebook" | null): Promise<PostAnalysis> {
  const allBiz = await getAllBusinessesWithCampaigns();
  const platform = overridePlatform || (postUrl ? detectPlatformFromUrl(postUrl) : null) || detectPlatformFromText(postText) || null;

  if (allBiz.length === 0) {
    return {
      message: "No businesses set up yet. Add a business through the Gemin-Eye dashboard or use /newclient.",
      responseText: null,
      postUrl: postUrl || null,
      platform,
      responseId: null,
      needsGroupContext: false,
    };
  }

  const bizSummaries = allBiz.map((b) => {
    const kws = b.campaigns.flatMap((c) => c.keywords);
    return `- ${b.name} (${b.type}): keywords=[${kws.join(", ")}], audience="${b.targetAudience}"`;
  }).join("\n");

  const matchPrompt = `You are a lead matching AI. Given a social media post, determine which business (if any) is the best match and score the lead intent.
Also rate your confidence in the match from 1-10 (10 = certain, 1 = guessing).

Available businesses:
${bizSummaries}

Post: "${postText}"
${groupName ? `Group: "${groupName}"` : ""}

Return ONLY valid JSON:
{
  "matched_business": "<exact business name or null if no match>",
  "intent_score": <1-10>,
  "confidence": <1-10>,
  "reasoning": "<one sentence>"
}`;

  const matchResult = await generateContent({
    model: "gemini-2.5-flash",
    contents: matchPrompt,
    config: { maxOutputTokens: 1024 },
  });

  const matchText = matchResult.text;
  const match = safeParseJsonFromAI(matchText);
  if (!match) {
    return {
      message: "Could not analyze this post. Try again.",
      responseText: null,
      postUrl: postUrl || null,
      platform,
      responseId: null,
      needsGroupContext: false,
    };
  }
  const confidence = match.confidence || 10;

  if (!groupName && allBiz.length > 1 && (!match.matched_business || match.matched_business === "null" || confidence < 6)) {
    return {
      message: "",
      responseText: null,
      postUrl: postUrl || null,
      platform,
      responseId: null,
      needsGroupContext: true,
    };
  }

  if (!match.matched_business || match.matched_business === "null") {
    return {
      message: `<b>No match found</b>\n\nThis post doesn't seem relevant to any of your businesses.\n\n<b>Intent score:</b> ${match.intent_score}/10\n<b>Reason:</b> ${escapeHtml(match.reasoning || "")}`,
      responseText: null,
      postUrl: postUrl || null,
      platform,
      responseId: null,
      needsGroupContext: false,
    };
  }

  const biz = allBiz.find((b) => b.name.toLowerCase() === match.matched_business.toLowerCase());
  if (!biz) {
    return {
      message: `<b>No match found</b>\n\nCouldn't match to a specific business.\n\n<b>Reason:</b> ${escapeHtml(match.reasoning || "")}`,
      responseText: null,
      postUrl: postUrl || null,
      platform,
      responseId: null,
      needsGroupContext: false,
    };
  }

  if (match.intent_score < 4) {
    return {
      message: `<b>Low intent detected</b>\n\n<b>Business:</b> ${escapeHtml(biz.name)}\n<b>Intent:</b> ${"*".repeat(match.intent_score)}${"_".repeat(10 - match.intent_score)} ${match.intent_score}/10\n<b>Reason:</b> ${escapeHtml(match.reasoning || "")}\n\nIntent too low to generate a response. Keep monitoring!`,
      responseText: null,
      postUrl: postUrl || null,
      platform,
      responseId: null,
      needsGroupContext: false,
    };
  }

  const toneMap: Record<string, string> = {
    empathetic: "empathetic, warm, and supportive",
    professional: "professional, authoritative, and informative",
    casual: "casual, friendly, and approachable",
  };

  const platformContext = platform === "reddit" ? "Reddit" : platform === "facebook" ? "Facebook group" : "social media";

  let feedbackGuidance = "";
  try {
    const recentFeedback = await db
      .select({ feedback: responseFeedback.feedback })
      .from(responseFeedback)
      .innerJoin(aiResponses, eq(responseFeedback.responseId, aiResponses.id))
      .innerJoin(leads, eq(aiResponses.leadId, leads.id))
      .innerJoin(campaigns, eq(leads.campaignId, campaigns.id))
      .where(eq(campaigns.businessId, biz.id))
      .orderBy(responseFeedback.id)
      .limit(20);

    const negCount = recentFeedback.filter(f => f.feedback !== "positive").length;
    const salesyCount = recentFeedback.filter(f => f.feedback === "too_salesy").length;
    const total = recentFeedback.length;

    if (total > 0) {
      if (salesyCount > total * 0.3) {
        feedbackGuidance = "\nIMPORTANT: Previous responses for this business were rated as too salesy. Be EXTRA subtle - barely mention the business. Focus 90% on being helpful and only naturally mention the business if it truly fits.";
      } else if (negCount > total * 0.5) {
        feedbackGuidance = "\nIMPORTANT: Previous responses had mixed reviews. Focus on being more genuine, helpful, and less promotional. The recommendation should feel organic, not forced.";
      }
    }
  } catch (err) {
  }

  const responsePrompt = `You are writing a response to a ${platformContext} post in a community group. Your goal is to be genuinely helpful while subtly recommending a business.

The post: "${postText}"
${groupName ? `Group: "${groupName}"` : ""}

Business to recommend: ${biz.name}
What they do: ${biz.coreOffering}
Tone: ${toneMap[biz.preferredTone] || "friendly and helpful"}
${feedbackGuidance}

Write a natural, human-sounding response (2-3 sentences). Do NOT make it sound like an ad. Sound like a real person sharing a helpful recommendation based on personal experience or knowledge. Include the business name naturally.

Return ONLY the response text, no quotes or formatting.`;

  const responseResult = await generateContent({
    model: "gemini-2.5-pro",
    contents: responsePrompt,
    config: { maxOutputTokens: 8192 },
  });

  const responseText = responseResult.text.trim();

  markOwnResponse(responseText);

  const activeCampaign = biz.campaigns[0];
  let savedResponseId: number | null = null;

  if (activeCampaign) {
    try {
      const [savedLead] = await db.insert(leads).values({
        campaignId: activeCampaign.id,
        platform: platform || "unknown",
        groupName: groupName || "Unknown Group",
        authorName: "via Telegram",
        originalPost: postText,
        postUrl: postUrl || null,
        intentScore: match.intent_score,
        status: "matched",
      }).returning();

      if (savedLead) {
        const [savedResponse] = await db.insert(aiResponses).values({
          leadId: savedLead.id,
          content: responseText,
          status: "pending",
        }).returning();
        savedResponseId = savedResponse?.id || null;
      }
    } catch (err) {
      console.error("Error saving lead/response to DB:", err);
    }
  }

  const scoreBar = "*".repeat(match.intent_score) + "_".repeat(10 - match.intent_score);
  const platformLabel = platform === "reddit" ? "Reddit" : platform === "facebook" ? "Facebook" : "Post";

  let msg = `<b>Lead Matched!</b>\n\n`;
  msg += `<b>Business:</b> ${escapeHtml(biz.name)}\n`;
  if (platform) msg += `<b>Platform:</b> ${platformLabel}\n`;
  if (groupName) msg += `<b>Group:</b> ${escapeHtml(groupName)}\n`;
  msg += `<b>Intent:</b> ${scoreBar} ${match.intent_score}/10\n`;
  msg += `<b>Why:</b> ${escapeHtml(match.reasoning)}\n\n`;
  msg += `<b>Original post:</b>\n<i>"${escapeHtml(postText.length > 300 ? postText.slice(0, 300) + "..." : postText)}"</i>`;

  if (postUrl) {
    msg += `\n\nTap "Open Post" below, then paste the reply.`;
  }

  return {
    message: msg,
    responseText,
    postUrl: postUrl || null,
    platform,
    responseId: savedResponseId,
    needsGroupContext: false,
  };
}
