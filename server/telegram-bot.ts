import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { businesses, campaigns, leads, aiResponses } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendTelegramMessage } from "./telegram";
import { storage } from "./storage";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

interface BusinessWithCampaigns {
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

async function getAllBusinessesWithCampaigns(): Promise<BusinessWithCampaigns[]> {
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const URL_REGEX = /https?:\/\/(?:www\.)?(?:reddit\.com|old\.reddit\.com|redd\.it|facebook\.com|fb\.com|m\.facebook\.com)[^\s)>\]]+/gi;

function extractPostUrl(text: string): string | null {
  const matches = text.match(URL_REGEX);
  return matches ? matches[0] : null;
}

function stripUrls(text: string): string {
  return text.replace(URL_REGEX, "").trim();
}

function detectPlatformFromUrl(url: string): "reddit" | "facebook" | null {
  if (/reddit\.com|redd\.it/i.test(url)) return "reddit";
  if (/facebook\.com|fb\.com/i.test(url)) return "facebook";
  return null;
}

function detectPlatformFromText(text: string): "reddit" | "facebook" | null {
  const lower = text.toLowerCase();
  if (lower.includes("reddit") || lower.includes("r/") || lower.includes("/r/")) return "reddit";
  if (lower.includes("facebook") || lower.includes("fb group")) return "facebook";
  return null;
}

interface ImageExtraction {
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

async function downloadTelegramPhotoWithMime(fileId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
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

async function extractTextFromImage(imageBuffer: Buffer, mimeType: string): Promise<ImageExtraction | null> {
  try {
    const base64Image = imageBuffer.toString("base64");

    const result = await ai.models.generateContent({
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

    const responseText = result.text || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
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

interface PostAnalysis {
  message: string;
  postUrl: string | null;
  platform: "reddit" | "facebook" | null;
}

async function handlePost(postText: string, groupName?: string, postUrl?: string | null, overridePlatform?: "reddit" | "facebook" | null): Promise<PostAnalysis> {
  const allBiz = await getAllBusinessesWithCampaigns();
  const platform = overridePlatform || (postUrl ? detectPlatformFromUrl(postUrl) : null) || detectPlatformFromText(postText) || null;

  if (allBiz.length === 0) {
    return {
      message: "No businesses set up yet. Add a business through the Gemin-Eye dashboard or use /newclient.",
      postUrl: postUrl || null,
      platform,
    };
  }

  const bizSummaries = allBiz.map((b) => {
    const kws = b.campaigns.flatMap((c) => c.keywords);
    return `- ${b.name} (${b.type}): keywords=[${kws.join(", ")}], audience="${b.targetAudience}"`;
  }).join("\n");

  const matchPrompt = `You are a lead matching AI. Given a social media post, determine which business (if any) is the best match and score the lead intent.

Available businesses:
${bizSummaries}

Post: "${postText}"
${groupName ? `Group: "${groupName}"` : ""}

Return ONLY valid JSON:
{
  "matched_business": "<exact business name or null if no match>",
  "intent_score": <1-10>,
  "reasoning": "<one sentence>"
}`;

  const matchResult = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: matchPrompt,
    config: { maxOutputTokens: 1024 },
  });

  const matchText = matchResult.text || "";
  const matchJson = matchText.match(/\{[\s\S]*\}/);
  if (!matchJson) {
    return {
      message: "Could not analyze this post. Try again.",
      postUrl: postUrl || null,
      platform,
    };
  }

  const match = JSON.parse(matchJson[0]);

  if (!match.matched_business || match.matched_business === "null") {
    return {
      message: `<b>No match found</b>\n\nThis post doesn't seem relevant to any of your businesses.\n\n<b>Intent score:</b> ${match.intent_score}/10\n<b>Reason:</b> ${escapeHtml(match.reasoning || "")}`,
      postUrl: postUrl || null,
      platform,
    };
  }

  const biz = allBiz.find((b) => b.name.toLowerCase() === match.matched_business.toLowerCase());
  if (!biz) {
    return {
      message: `<b>No match found</b>\n\nCouldn't match to a specific business.\n\n<b>Reason:</b> ${escapeHtml(match.reasoning || "")}`,
      postUrl: postUrl || null,
      platform,
    };
  }

  if (match.intent_score < 4) {
    return {
      message: `<b>Low intent detected</b>\n\n<b>Business:</b> ${escapeHtml(biz.name)}\n<b>Intent:</b> ${"*".repeat(match.intent_score)}${"_".repeat(10 - match.intent_score)} ${match.intent_score}/10\n<b>Reason:</b> ${escapeHtml(match.reasoning || "")}\n\nIntent too low to generate a response. Keep monitoring!`,
      postUrl: postUrl || null,
      platform,
    };
  }

  const toneMap: Record<string, string> = {
    empathetic: "empathetic, warm, and supportive",
    professional: "professional, authoritative, and informative",
    casual: "casual, friendly, and approachable",
  };

  const platformLabel = platform === "reddit" ? "Reddit" : platform === "facebook" ? "Facebook group" : "social media";

  const responsePrompt = `You are writing a response to a ${platformLabel} post in a community group. Your goal is to be genuinely helpful while subtly recommending a business.

The post: "${postText}"
${groupName ? `Group: "${groupName}"` : ""}

Business to recommend: ${biz.name}
What they do: ${biz.coreOffering}
Tone: ${toneMap[biz.preferredTone] || "friendly and helpful"}

Write a natural, human-sounding response (2-3 sentences). Do NOT make it sound like an ad. Sound like a real person sharing a helpful recommendation based on personal experience or knowledge. Include the business name naturally.

Return ONLY the response text, no quotes or formatting.`;

  const responseResult = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: responsePrompt,
    config: { maxOutputTokens: 8192 },
  });

  const responseText = (responseResult.text || "").trim();

  const scoreBar = "*".repeat(match.intent_score) + "_".repeat(10 - match.intent_score);
  const platformEmoji = platform === "reddit" ? "Reddit" : platform === "facebook" ? "Facebook" : "Post";

  let msg = `<b>Lead Matched!</b>\n\n`;
  msg += `<b>Business:</b> ${escapeHtml(biz.name)}\n`;
  if (platform) msg += `<b>Platform:</b> ${platformEmoji}\n`;
  msg += `<b>Intent:</b> ${scoreBar} ${match.intent_score}/10\n`;
  msg += `<b>Why:</b> ${escapeHtml(match.reasoning)}\n\n`;
  msg += `<b>Original post:</b>\n<i>"${escapeHtml(postText.length > 300 ? postText.slice(0, 300) + "..." : postText)}"</i>\n\n`;
  msg += `<b>Copy this response:</b>\n<code>${escapeHtml(responseText)}</code>`;

  if (postUrl) {
    msg += `\n\nTap the button below to open the post and paste your reply.`;
  }

  return {
    message: msg,
    postUrl: postUrl || null,
    platform,
  };
}

const pendingClientSetups = new Map<string, { step: string; name?: string; type?: string; audience?: string; offering?: string; tone?: string; keywords?: string[]; groups?: string[] }>();

async function handleAdminCommand(chatId: string, text: string): Promise<boolean> {
  const pending = pendingClientSetups.get(chatId);

  if (pending && !text.startsWith("/")) {
    return await handleClientSetupFlow(chatId, text, pending);
  }

  if (pending && text.startsWith("/")) {
    pendingClientSetups.delete(chatId);
  }

  if (text === "/newclient") {
    pendingClientSetups.set(chatId, { step: "name" });
    await sendTelegramMessage("<b>New Client Setup</b>\n\nWhat's the business name?");
    return true;
  }

  if (text === "/removeclient") {
    const allBiz = await getAllBusinessesWithCampaigns();
    if (allBiz.length === 0) {
      await sendTelegramMessage("No businesses to remove.");
      return true;
    }

    let msg = `<b>Remove a Client</b>\n\nReply with the number of the business to remove:\n\n`;
    allBiz.forEach((b, i) => {
      msg += `<b>${i + 1}.</b> ${escapeHtml(b.name)} (${escapeHtml(b.type)})\n`;
    });
    msg += `\nOr type /cancel to go back.`;

    pendingClientSetups.set(chatId, { step: "remove_select" });
    await sendTelegramMessage(msg);
    return true;
  }

  if (text === "/keywords") {
    const allBiz = await getAllBusinessesWithCampaigns();
    if (allBiz.length === 0) {
      await sendTelegramMessage("No businesses set up. Use /newclient first.");
      return true;
    }

    let msg = `<b>Update Keywords</b>\n\nWhich business? Reply with the number:\n\n`;
    allBiz.forEach((b, i) => {
      const kws = b.campaigns.flatMap((c) => c.keywords).slice(0, 8);
      msg += `<b>${i + 1}.</b> ${escapeHtml(b.name)}\n    Current: ${kws.map(k => escapeHtml(k)).join(", ")}\n\n`;
    });
    msg += `Or type /cancel to go back.`;

    pendingClientSetups.set(chatId, { step: "keywords_select" });
    await sendTelegramMessage(msg);
    return true;
  }

  if (text === "/groups") {
    const allBiz = await getAllBusinessesWithCampaigns();
    if (allBiz.length === 0) {
      await sendTelegramMessage("No businesses set up. Use /newclient first.");
      return true;
    }

    let msg = `<b>Update Target Groups</b>\n\nWhich business? Reply with the number:\n\n`;
    allBiz.forEach((b, i) => {
      const grps = b.campaigns.flatMap((c) => c.targetGroups).slice(0, 5);
      msg += `<b>${i + 1}.</b> ${escapeHtml(b.name)}\n    Current: ${grps.map(g => escapeHtml(g)).join(", ")}\n\n`;
    });
    msg += `Or type /cancel to go back.`;

    pendingClientSetups.set(chatId, { step: "groups_select" });
    await sendTelegramMessage(msg);
    return true;
  }

  if (text === "/cancel") {
    pendingClientSetups.delete(chatId);
    await sendTelegramMessage("Cancelled.");
    return true;
  }

  return false;
}

async function handleClientSetupFlow(chatId: string, text: string, pending: { step: string; name?: string; type?: string; audience?: string; offering?: string; tone?: string; keywords?: string[]; groups?: string[] }): Promise<boolean> {
  if (text === "/cancel") {
    pendingClientSetups.delete(chatId);
    await sendTelegramMessage("Client setup cancelled.");
    return true;
  }

  switch (pending.step) {
    case "name":
      pending.name = text;
      pending.step = "type";
      await sendTelegramMessage(`Got it: <b>${escapeHtml(text)}</b>\n\nWhat type of business is this?\n<i>(e.g., "Diner in Brookfield, IL", "AI productivity tool", "Bocce ball club")</i>`);
      break;

    case "type":
      pending.type = text;
      pending.step = "audience";
      await sendTelegramMessage(`Business type: <b>${escapeHtml(text)}</b>\n\nWho is the target audience?\n<i>(e.g., "Families in the Western Suburbs looking for casual dining")</i>`);
      break;

    case "audience":
      pending.audience = text;
      pending.step = "offering";
      await sendTelegramMessage(`Target audience set.\n\nDescribe what this business offers in 1-2 sentences:\n<i>(e.g., "Classic American diner serving hearty breakfasts and comfort food. Family-owned with generous portions.")</i>`);
      break;

    case "offering":
      pending.offering = text;
      pending.step = "tone";
      await sendTelegramMessage(`Got the offering.\n\nWhat tone should AI responses use?\n\n<b>1.</b> Casual (friendly, approachable)\n<b>2.</b> Empathetic (warm, supportive)\n<b>3.</b> Professional (authoritative, informative)\n\nReply with 1, 2, or 3.`);
      break;

    case "tone": {
      const toneChoice = text.trim();
      if (toneChoice === "1") pending.tone = "casual";
      else if (toneChoice === "2") pending.tone = "empathetic";
      else if (toneChoice === "3") pending.tone = "professional";
      else pending.tone = "casual";

      pending.step = "keywords";
      await sendTelegramMessage(`Tone: <b>${pending.tone}</b>\n\nNow list the keywords to watch for, separated by commas:\n<i>(e.g., "restaurant recommendation, best pizza, where to eat, Brookfield food")</i>`);
      break;
    }

    case "keywords": {
      pending.keywords = text.split(",").map(k => k.trim()).filter(k => k.length > 0);
      pending.step = "groups";
      await sendTelegramMessage(`Keywords: ${pending.keywords.map(k => `<b>${escapeHtml(k)}</b>`).join(", ")}\n\nFinally, list the groups/subreddits to target, separated by commas:\n<i>(e.g., "r/chicagofood, Western Suburbs Foodies, Brookfield IL Community")</i>`);
      break;
    }

    case "groups": {
      pending.groups = text.split(",").map(g => g.trim()).filter(g => g.length > 0);

      const biz = await storage.createBusiness({
        userId: "telegram-admin",
        name: pending.name!,
        type: pending.type!,
        targetAudience: pending.audience!,
        coreOffering: pending.offering!,
        preferredTone: pending.tone!,
      });

      const redditGroups = pending.groups.filter(g => g.toLowerCase().startsWith("r/"));
      const facebookGroups = pending.groups.filter(g => !g.toLowerCase().startsWith("r/"));

      if (facebookGroups.length > 0) {
        await storage.createCampaign({
          businessId: biz.id,
          name: `${pending.name} - Facebook`,
          platform: "Facebook",
          status: "active",
          strategy: `Monitor Facebook groups for ${pending.type} leads`,
          targetGroups: facebookGroups,
          keywords: pending.keywords || [],
        });
      }

      if (redditGroups.length > 0) {
        await storage.createCampaign({
          businessId: biz.id,
          name: `${pending.name} - Reddit`,
          platform: "Reddit",
          status: "active",
          strategy: `Monitor Reddit communities for ${pending.type} leads`,
          targetGroups: redditGroups,
          keywords: pending.keywords || [],
        });
      }

      if (facebookGroups.length === 0 && redditGroups.length === 0) {
        await storage.createCampaign({
          businessId: biz.id,
          name: `${pending.name} - General`,
          platform: "Facebook",
          status: "active",
          strategy: `Monitor social media for ${pending.type} leads`,
          targetGroups: pending.groups,
          keywords: pending.keywords || [],
        });
      }

      pendingClientSetups.delete(chatId);

      let msg = `<b>Client Created!</b>\n\n`;
      msg += `<b>Name:</b> ${escapeHtml(biz.name)}\n`;
      msg += `<b>Type:</b> ${escapeHtml(biz.type)}\n`;
      msg += `<b>Tone:</b> ${escapeHtml(pending.tone!)}\n`;
      msg += `<b>Keywords:</b> ${(pending.keywords || []).map(k => escapeHtml(k)).join(", ")}\n`;
      msg += `<b>Groups:</b> ${(pending.groups || []).map(g => escapeHtml(g)).join(", ")}\n\n`;
      msg += `I'm now watching for leads for <b>${escapeHtml(biz.name)}</b>. Send me posts to analyze!`;

      await sendTelegramMessage(msg);
      break;
    }

    case "remove_select": {
      const allBiz = await getAllBusinessesWithCampaigns();
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || idx < 0 || idx >= allBiz.length) {
        await sendTelegramMessage("Invalid number. Try again or /cancel.");
        return true;
      }

      const bizToRemove = allBiz[idx];
      const allCampsToRemove = bizToRemove.campaigns;

      for (const camp of allCampsToRemove) {
        const campLeads = await db.select().from(leads).where(eq(leads.campaignId, camp.id));
        for (const lead of campLeads) {
          await db.delete(aiResponses).where(eq(aiResponses.leadId, lead.id));
        }
        await db.delete(leads).where(eq(leads.campaignId, camp.id));
        await db.delete(campaigns).where(eq(campaigns.id, camp.id));
      }
      await db.delete(businesses).where(eq(businesses.id, bizToRemove.id));

      pendingClientSetups.delete(chatId);
      await sendTelegramMessage(`<b>${escapeHtml(bizToRemove.name)}</b> has been removed along with all its campaigns, leads, and responses.`);
      break;
    }

    case "keywords_select": {
      const allBiz = await getAllBusinessesWithCampaigns();
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || idx < 0 || idx >= allBiz.length) {
        await sendTelegramMessage("Invalid number. Try again or /cancel.");
        return true;
      }

      pending.name = allBiz[idx].name;
      pending.step = "keywords_update";
      const currentKws = allBiz[idx].campaigns.flatMap(c => c.keywords);
      await sendTelegramMessage(`<b>Updating keywords for ${escapeHtml(allBiz[idx].name)}</b>\n\nCurrent keywords: ${currentKws.map(k => escapeHtml(k)).join(", ")}\n\nSend the new complete list of keywords, separated by commas:\n<i>(This will replace all current keywords)</i>`);
      break;
    }

    case "keywords_update": {
      const newKeywords = text.split(",").map(k => k.trim()).filter(k => k.length > 0);
      const allBiz = await getAllBusinessesWithCampaigns();
      const biz = allBiz.find(b => b.name === pending.name);
      if (biz) {
        for (const camp of biz.campaigns) {
          await db.update(campaigns).set({ keywords: newKeywords }).where(eq(campaigns.id, camp.id));
        }
      }

      pendingClientSetups.delete(chatId);
      await sendTelegramMessage(`<b>Keywords updated for ${escapeHtml(pending.name!)}</b>\n\nNew keywords: ${newKeywords.map(k => escapeHtml(k)).join(", ")}`);
      break;
    }

    case "groups_select": {
      const allBiz = await getAllBusinessesWithCampaigns();
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || idx < 0 || idx >= allBiz.length) {
        await sendTelegramMessage("Invalid number. Try again or /cancel.");
        return true;
      }

      pending.name = allBiz[idx].name;
      pending.step = "groups_update";
      const currentGroups = allBiz[idx].campaigns.flatMap(c => c.targetGroups);
      await sendTelegramMessage(`<b>Updating groups for ${escapeHtml(allBiz[idx].name)}</b>\n\nCurrent groups: ${currentGroups.map(g => escapeHtml(g)).join(", ")}\n\nSend the new complete list of groups/subreddits, separated by commas:\n<i>(This will replace all current groups)</i>`);
      break;
    }

    case "groups_update": {
      const newGroups = text.split(",").map(g => g.trim()).filter(g => g.length > 0);
      const allBiz = await getAllBusinessesWithCampaigns();
      const biz = allBiz.find(b => b.name === pending.name);
      if (biz) {
        for (const camp of biz.campaigns) {
          await db.update(campaigns).set({ targetGroups: newGroups }).where(eq(campaigns.id, camp.id));
        }
      }

      pendingClientSetups.delete(chatId);
      await sendTelegramMessage(`<b>Groups updated for ${escapeHtml(pending.name!)}</b>\n\nNew groups: ${newGroups.map(g => escapeHtml(g)).join(", ")}`);
      break;
    }
  }

  return true;
}

export function registerTelegramWebhook(app: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set, skipping bot webhook setup");
    return;
  }

  app.post(`/api/telegram/webhook/${token}`, async (req: any, res: any) => {
    try {
      res.sendStatus(200);

      const update = req.body;
      const message = update?.message;
      if (!message) return;

      const chatId = String(message.chat.id);
      if (!ALLOWED_CHAT_ID) {
        console.warn("TELEGRAM_CHAT_ID not set, ignoring incoming message");
        return;
      }
      if (chatId !== ALLOWED_CHAT_ID) return;

      if (message.photo && message.photo.length > 0) {
        await sendTelegramMessage("Reading screenshot...");

        const largestPhoto = message.photo[message.photo.length - 1];
        const photoData = await downloadTelegramPhotoWithMime(largestPhoto.file_id);

        if (!photoData) {
          await sendTelegramMessage("Couldn't download that image. Please try again.");
          return;
        }

        const extracted = await extractTextFromImage(photoData.buffer, photoData.mimeType);
        if (!extracted || extracted.text.length < 5) {
          await sendTelegramMessage("Couldn't read any text from that screenshot. Make sure the post text is clearly visible and try again.");
          return;
        }

        const caption = message.caption || "";
        const captionUrl = extractPostUrl(caption);
        const postUrl = captionUrl || extracted.postUrl;
        const groupName = extracted.groupName || undefined;

        await sendTelegramMessage(`Read from screenshot. Analyzing...\n\n<i>"${escapeHtml(extracted.text.length > 150 ? extracted.text.slice(0, 150) + "..." : extracted.text)}"</i>`);

        const result = await handlePost(extracted.text, groupName, postUrl, extracted.platform);

        const buttons = [];
        if (result.postUrl) {
          const label = result.platform === "reddit" ? "Open Reddit Post" : result.platform === "facebook" ? "Open Facebook Post" : "Open Post";
          buttons.push([{ text: label, url: result.postUrl }]);
        }

        await sendTelegramMessage(result.message, buttons.length > 0 ? { buttons } : undefined);
        return;
      }

      if (!message.text) return;

      const text = message.text.trim();

      if (text === "/start") {
        await sendTelegramMessage(
          `<b>Welcome to Gemin-Eye Bot!</b>\n\nI help you find and respond to leads across social media.\n\n<b>Send me a post:</b>\n- Paste text + URL\n- Or just screenshot the post!\n\n<b>I'll automatically:</b>\n1. Match it to your businesses\n2. Score the lead intent\n3. Craft a human-sounding response\n\n<b>Managing Clients:</b>\n/newclient - Add a new business\n/removeclient - Remove a business\n/keywords - Update keywords for a business\n/groups - Update target groups\n/businesses - List all businesses\n\n<b>Quick tip:</b> Include the post URL and I'll add an "Open Post" button.\n\n<b>Screenshot example:</b> Just take a screenshot of any Facebook/Reddit post and send it here!`
        );
        return;
      }

      if (text === "/help") {
        await sendTelegramMessage(
          `<b>Gemin-Eye Bot - Full Guide</b>\n\n<b>Analyzing Posts:</b>\n\n<b>Option 1 - Text:</b>\nPaste the URL + post text:\n<code>https://reddit.com/r/chicago/comments/abc123\nLooking for a good pizza place near Brookfield</code>\n\n<b>Option 2 - Screenshot:</b>\nJust screenshot the post on your phone and send the image here. I'll read it automatically!\n\nYou can add the URL as a caption on the photo for the "Open Post" button.\n\n<b>Managing Clients:</b>\n/newclient - Step-by-step new business setup\n/removeclient - Remove a business and all its data\n/keywords - Update search keywords\n/groups - Update target groups/subreddits\n/businesses - See all your businesses\n\n<b>Tips:</b>\n- Screenshots work best when the post text is clearly visible\n- Include group names like "Western Suburbs Foodies: post text"\n- I use Gemini Flash for matching and Gemini Pro for responses`
        );
        return;
      }

      if (text === "/businesses") {
        const allBiz = await getAllBusinessesWithCampaigns();
        if (allBiz.length === 0) {
          await sendTelegramMessage("No businesses set up yet. Use /newclient to add one!");
          return;
        }

        let msg = `<b>Your Businesses:</b>\n\n`;
        for (const b of allBiz) {
          const kws = b.campaigns.flatMap((c) => c.keywords).slice(0, 5);
          const groups = b.campaigns.flatMap((c) => c.targetGroups).slice(0, 3);
          msg += `<b>${escapeHtml(b.name)}</b> (${escapeHtml(b.type)})\n`;
          msg += `Groups: ${groups.map((g) => escapeHtml(g)).join(", ")}\n`;
          msg += `Keywords: ${kws.map((k) => escapeHtml(k)).join(", ")}\n\n`;
        }
        msg += `<b>Commands:</b> /newclient | /removeclient | /keywords | /groups`;
        await sendTelegramMessage(msg);
        return;
      }

      const handled = await handleAdminCommand(chatId, text);
      if (handled) return;

      if (text.startsWith("/")) return;

      await sendTelegramMessage("Analyzing post...");

      const postUrl = extractPostUrl(text);
      let postText = postUrl ? stripUrls(text) : text;

      let groupName: string | undefined;
      const colonMatch = postText.match(/^([^:]{3,50}):\s+([\s\S]+)/);
      if (colonMatch) {
        groupName = colonMatch[1].trim();
        postText = colonMatch[2].trim();
      }

      if (!postText || postText.length < 5) {
        await sendTelegramMessage(
          "I need more text to analyze. Please paste the post content along with the URL.\n\n<b>Or just screenshot the post!</b>\n\n<b>Example:</b>\n<code>https://reddit.com/r/pizza/comments/abc123\nDoes anyone know a good pizza place near Brookfield?</code>"
        );
        return;
      }

      const result = await handlePost(postText, groupName, postUrl);

      const buttons = [];
      if (result.postUrl) {
        const label = result.platform === "reddit" ? "Open Reddit Post" : result.platform === "facebook" ? "Open Facebook Post" : "Open Post";
        buttons.push([{ text: label, url: result.postUrl }]);
      }

      await sendTelegramMessage(result.message, buttons.length > 0 ? { buttons } : undefined);
    } catch (error) {
      console.error("Telegram webhook error:", error);
      await sendTelegramMessage("Something went wrong analyzing that post. Please try again.").catch(() => {});
    }
  });

  registerWebhook(token).catch((e) => console.error("Failed to register Telegram webhook:", e));
}

async function registerWebhook(token: string) {
  const replSlug = process.env.REPL_SLUG;
  const replOwner = process.env.REPL_OWNER;
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;

  let webhookUrl: string;
  if (replitDevDomain) {
    webhookUrl = `https://${replitDevDomain}/api/telegram/webhook/${token}`;
  } else if (replSlug && replOwner) {
    webhookUrl = `https://${replSlug}.${replOwner}.repl.co/api/telegram/webhook/${token}`;
  } else {
    console.warn("Could not determine public URL for Telegram webhook");
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });

    const data = await res.json();
    if (data.ok) {
      console.log("Telegram webhook registered successfully");
    } else {
      console.error("Telegram webhook registration failed:", data.description || "unknown error");
    }
  } catch (error) {
    console.error("Error registering Telegram webhook:", error);
  }
}
