import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { businesses, campaigns } from "@shared/schema";
import { sendTelegramMessage } from "./telegram";

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

async function handlePost(postText: string, groupName?: string): Promise<string> {
  const allBiz = await getAllBusinessesWithCampaigns();

  if (allBiz.length === 0) {
    return "No businesses set up yet. Add a business through the Gemin-Eye dashboard first.";
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
    return "Could not analyze this post. Try again.";
  }

  const match = JSON.parse(matchJson[0]);

  if (!match.matched_business || match.matched_business === "null") {
    return `<b>No match found</b>\n\nThis post doesn't seem relevant to any of your businesses.\n\n<b>Intent score:</b> ${match.intent_score}/10\n<b>Reason:</b> ${escapeHtml(match.reasoning || "")}`;
  }

  const biz = allBiz.find((b) => b.name.toLowerCase() === match.matched_business.toLowerCase());
  if (!biz) {
    return `<b>No match found</b>\n\nCouldn't match to a specific business.\n\n<b>Reason:</b> ${escapeHtml(match.reasoning || "")}`;
  }

  if (match.intent_score < 4) {
    return `<b>Low intent detected</b>\n\n<b>Business:</b> ${escapeHtml(biz.name)}\n<b>Intent:</b> ${"█".repeat(match.intent_score)}${"░".repeat(10 - match.intent_score)} ${match.intent_score}/10\n<b>Reason:</b> ${escapeHtml(match.reasoning || "")}\n\nIntent too low to generate a response. Keep monitoring!`;
  }

  const toneMap: Record<string, string> = {
    empathetic: "empathetic, warm, and supportive",
    professional: "professional, authoritative, and informative",
    casual: "casual, friendly, and approachable",
  };

  const responsePrompt = `You are writing a response to a social media post in a community group. Your goal is to be genuinely helpful while subtly recommending a business.

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

  const scoreBar = "█".repeat(match.intent_score) + "░".repeat(10 - match.intent_score);

  let msg = `<b>Lead Matched!</b>\n\n`;
  msg += `<b>Business:</b> ${escapeHtml(biz.name)}\n`;
  msg += `<b>Intent:</b> ${scoreBar} ${match.intent_score}/10\n`;
  msg += `<b>Why:</b> ${escapeHtml(match.reasoning)}\n\n`;
  msg += `<b>Original post:</b>\n<i>"${escapeHtml(postText.length > 300 ? postText.slice(0, 300) + "..." : postText)}"</i>\n\n`;
  msg += `<b>Copy & paste this response:</b>\n<code>${escapeHtml(responseText)}</code>`;

  return msg;
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
      if (!update?.message?.text) return;

      const chatId = String(update.message.chat.id);
      if (!ALLOWED_CHAT_ID) {
        console.warn("TELEGRAM_CHAT_ID not set, ignoring incoming message");
        return;
      }
      if (chatId !== ALLOWED_CHAT_ID) return;

      const text = update.message.text.trim();

      if (text === "/start") {
        await sendTelegramMessage(
          `<b>Welcome to Gemin-Eye Bot!</b>\n\nPaste any Facebook group post here and I'll:\n\n1. Match it to your businesses\n2. Score the lead intent\n3. Craft a human-sounding response\n\nJust paste the post text and I'll handle the rest!\n\n<b>Commands:</b>\n/businesses - List your businesses\n/help - Show this message`
        );
        return;
      }

      if (text === "/help") {
        await sendTelegramMessage(
          `<b>How to use Gemin-Eye Bot:</b>\n\n<b>1.</b> Browse your target Facebook groups\n<b>2.</b> When you see a promising post, copy the text\n<b>3.</b> Paste it here\n<b>4.</b> Get an AI response back in seconds\n<b>5.</b> Copy the response and paste it on Facebook\n\nYou can also prefix with the group name:\n<code>Western Suburbs Foodies: Looking for a good Italian place...</code>\n\n<b>Commands:</b>\n/businesses - List your businesses\n/help - Show this message`
        );
        return;
      }

      if (text === "/businesses") {
        const allBiz = await getAllBusinessesWithCampaigns();
        if (allBiz.length === 0) {
          await sendTelegramMessage("No businesses set up yet. Add one through the Gemin-Eye dashboard.");
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
        await sendTelegramMessage(msg);
        return;
      }

      if (text.startsWith("/")) return;

      await sendTelegramMessage("Analyzing post...");

      let groupName: string | undefined;
      let postText = text;

      const colonMatch = text.match(/^([^:]{3,50}):\s+(.+)/s);
      if (colonMatch) {
        groupName = colonMatch[1].trim();
        postText = colonMatch[2].trim();
      }

      const result = await handlePost(postText, groupName);
      await sendTelegramMessage(result);
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
