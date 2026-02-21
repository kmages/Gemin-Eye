import Parser from "rss-parser";
import { db } from "./db";
import { businesses, campaigns, leads, aiResponses } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendTelegramMessage, sendTelegramMessageToChat } from "./telegram";
import { sendSlackMessage, getSlackWebhook } from "./utils/slack";
import { isRedditConfigured } from "./reddit-poster";
import { generateContent, parseAIJsonWithRetry, leadScoreSchema, TONE_MAP, MIN_MONITOR_INTENT_SCORE, getMentalHealthGuidance } from "./utils/ai";
import { escapeHtml, stripHtml, canonicalizeUrl } from "./utils/html";
import { hasBeenSeen, markSeen, markOwnResponse, isOwnResponse } from "./utils/dedup";
import { getFeedbackGuidance } from "./utils/feedback";
import { keywordMatch } from "./utils/keywords";

const parser = new Parser({
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; Gemin-Eye/1.0; +https://gemin-eye.com)",
    "Accept": "text/xml, application/rss+xml, application/xml, application/atom+xml",
  },
  timeout: 15000,
});

const SCAN_INTERVAL = 120 * 1000;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

interface AlertTarget {
  feedUrl: string;
  businessId: number;
  businessName: string;
  businessType: string;
  coreOffering: string;
  preferredTone: string;
  campaignId: number;
  keywords: string[];
  ownerUserId: string;
  telegramChatId: string | null;
  slackWebhookUrl: string | null;
}

async function getAlertTargets(): Promise<AlertTarget[]> {
  const allBiz = await db.select().from(businesses);
  const allCamps = await db.select().from(campaigns);

  const targets: AlertTarget[] = [];

  for (const biz of allBiz) {
    const bizCamps = allCamps.filter(
      (c) => c.businessId === biz.id && c.status === "active" && c.platform.toLowerCase() === "google_alerts"
    );

    for (const camp of bizCamps) {
      const feedUrls = (camp.targetGroups || []) as string[];
      const keywords = (camp.keywords || []) as string[];

      for (const feedUrl of feedUrls) {
        const trimmed = feedUrl.trim();
        if (!trimmed) continue;
        if (!trimmed.startsWith("http")) continue;

        targets.push({
          feedUrl: trimmed,
          businessId: biz.id,
          businessName: biz.name,
          businessType: biz.type,
          coreOffering: biz.coreOffering,
          preferredTone: biz.preferredTone,
          campaignId: camp.id,
          keywords,
          ownerUserId: biz.userId,
          telegramChatId: biz.telegramChatId || null,
          slackWebhookUrl: camp.slackWebhookUrl || biz.slackWebhookUrl || null,
        });
      }
    }
  }

  return targets;
}

function extractSourceName(link: string): string {
  try {
    const url = new URL(link);
    const host = url.hostname.replace("www.", "");
    if (host.includes("quora.com")) return "Quora";
    if (host.includes("reddit.com")) return "Reddit";
    if (host.includes("stackoverflow.com")) return "Stack Overflow";
    if (host.includes("youtube.com")) return "YouTube";
    if (host.includes("medium.com")) return "Medium";
    return host;
  } catch {
    return "Web";
  }
}

async function processAlertItem(
  item: { title: string; content: string; link: string; source: string },
  target: AlertTarget
): Promise<void> {
  const fullText = `${item.title}\n${item.content}`;

  if (await isOwnResponse(fullText)) return;

  if (!keywordMatch(fullText, target.keywords)) return;

  const match = await parseAIJsonWithRetry(
    async () => {
      const result = await generateContent({
        model: "gemini-2.5-flash",
        contents: `You are a lead scout for "${target.businessName}" (${target.businessType}).
They offer: ${target.coreOffering}

Analyze this web content found via Google Alerts:
Source: ${item.source}
Title: "${item.title}"
Content: "${item.content.slice(0, 600)}"

Is this person asking a question or seeking help/recommendations that "${target.businessName}" could address?

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
      return result.text;
    },
    leadScoreSchema
  );

  if (!match) return;

  if (!match.is_lead || match.intent_score < MIN_MONITOR_INTENT_SCORE) return;

  const feedbackGuidance = await getFeedbackGuidance(target.businessId);

  const communitySources = ["Quora", "Reddit", "Stack Overflow"];
  const isCommunitySource = communitySources.includes(item.source);
  const isHighIntentHelpSeeking = match.intent_score >= 7;
  const isRedditPlatform = item.source === "Reddit";
  const postContent = `${item.title}\n${item.content.slice(0, 600)}`;
  const mentalHealthGuidance = getMentalHealthGuidance(target.coreOffering, postContent, isRedditPlatform);

  let responsePrompt: string;

  if (isCommunitySource || isHighIntentHelpSeeking) {
    const platformLabel = item.source === "Quora" ? "Quora answer" :
      item.source === "Reddit" ? "Reddit comment" :
      `${item.source} reply`;

    responsePrompt = `You are writing a ${platformLabel}. Your goal is to be genuinely helpful while subtly mentioning a business.

The post/question: "${postContent}"

Business to recommend: ${target.businessName}
What they do: ${target.coreOffering}
Tone: ${TONE_MAP[target.preferredTone] || "friendly and helpful"}
${feedbackGuidance}
${isRedditPlatform ? `
REDDIT RULES:
- Do NOT mention any business name, brand, website, or link
- Write as a knowledgeable community member sharing genuine advice
- Sound like a real Redditor — casual, helpful, conversational` : `
- Write a natural, human-sounding response (2-3 sentences)
- Do NOT make it sound like an ad
- Sound like a real person sharing a helpful recommendation
- Include the business name naturally`}
${mentalHealthGuidance}
Return ONLY the response text, no quotes or formatting.`;
  } else {
    responsePrompt = `You are writing a thoughtful comment on a news article or blog post. Your goal is to add genuine value to the conversation.

SOURCE: ${item.source}
ARTICLE TITLE: "${item.title}"
ARTICLE CONTENT: "${item.content.slice(0, 600)}"

Business context (for your knowledge — weave in naturally, not as a sales pitch):
Name: ${target.businessName}
What they do: ${target.coreOffering}
Tone: ${TONE_MAP[target.preferredTone] || "friendly and helpful"}
${feedbackGuidance}

CRITICAL RULES:
- This is a NEWS ARTICLE or blog post, NOT a person directly asking you for help
- Write a thoughtful comment that engages with the article's topic
- Share a relevant personal perspective, insight, or experience related to the topic
- You may mention ${target.businessName} ONCE, naturally, as part of sharing your experience — NOT as a recommendation or endorsement
- Do NOT say "I recommend", "check out", "you should try", or any direct sales language
- Do NOT pretend someone is asking for help when they are not
- Sound like a real person who read the article and has something thoughtful to add
- Keep it 2-3 sentences, conversational and authentic
${mentalHealthGuidance}
Return ONLY the response text, no quotes or formatting.`;
  }

  const responseResult = await generateContent({
    model: "gemini-2.5-pro",
    contents: responsePrompt,
    config: { maxOutputTokens: 8192 },
  });

  let responseText = responseResult.text.trim();
  if (!responseText) return;

  const TEAM_DANIEL_URL = "https://www.teamdanielrunningforrecovery.org";
  if (mentalHealthGuidance && !responseText.includes(TEAM_DANIEL_URL)) {
    responseText += `\n\nFor psychosis education and family support resources, check out Team Daniel: ${TEAM_DANIEL_URL}`;
  }

  await markOwnResponse(responseText);

  let savedResponseId: number | null = null;
  try {
    const [savedLead] = await db
      .insert(leads)
      .values({
        campaignId: target.campaignId,
        platform: "google_alerts",
        groupName: item.source,
        authorName: "Web user",
        originalPost: fullText.slice(0, 2000),
        postUrl: item.link || null,
        intentScore: match.intent_score,
        status: "matched",
      })
      .returning();

    if (savedLead) {
      const [savedResponse] = await db
        .insert(aiResponses)
        .values({
          leadId: savedLead.id,
          content: responseText,
          status: "pending",
        })
        .returning();
      savedResponseId = savedResponse?.id || null;
    }
  } catch (err) {
    console.error("Error saving Google Alert lead to DB:", err);
  }

  const scoreBar = "★".repeat(match.intent_score) + "☆".repeat(10 - match.intent_score);
  const contentSnippet = item.content.slice(0, 400).trim();

  let baseMsg = `<b>🔔 Google Alert Lead</b>\n\n`;
  baseMsg += `<b>Business:</b> ${escapeHtml(target.businessName)}\n`;
  baseMsg += `<b>Source:</b> ${escapeHtml(item.source)}\n`;
  baseMsg += `<b>Intent:</b> ${scoreBar} ${match.intent_score}/10\n`;
  baseMsg += `<b>Why:</b> ${escapeHtml(match.reasoning || "")}\n\n`;
  baseMsg += `<b>📰 Title:</b>\n<i>"${escapeHtml(item.title.slice(0, 200))}"</i>\n\n`;
  if (contentSnippet) {
    baseMsg += `<b>📝 Content:</b>\n${escapeHtml(contentSnippet)}\n\n`;
  }

  let telegramMsg = baseMsg;
  telegramMsg += `<b>💬 Suggested Response:</b>\n<code>${escapeHtml(responseText)}</code>`;
  if (item.link) {
    telegramMsg += `\n\n👆 Tap "Open Page" below, then paste the reply.`;
  }

  const buttons: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
  if (item.link) {
    buttons.push([{ text: "Open Page", url: item.link }]);
  }
  const isRedditSource = item.link && /reddit\.com\/r\/\w+\/comments\//i.test(item.link);
  if (savedResponseId && isRedditSource && isRedditConfigured()) {
    buttons.push([{ text: "Post to Reddit", callback_data: `reddit_post_${savedResponseId}` }]);
  }
  if (savedResponseId) {
    buttons.push([
      { text: "Used It", callback_data: `fb_good_${savedResponseId}` },
      { text: "Bad Match", callback_data: `fb_bad_${savedResponseId}` },
      { text: "Too Salesy", callback_data: `fb_salesy_${savedResponseId}` },
      { text: "Wrong Client", callback_data: `fb_wrong_${savedResponseId}` },
    ]);
  }

  if (target.telegramChatId) {
    await sendTelegramMessageToChat(target.telegramChatId, telegramMsg, buttons.length > 0 ? { buttons } : undefined);
  } else {
    await sendTelegramMessage(telegramMsg, buttons.length > 0 ? { buttons } : undefined);
  }

  const slackUrl = getSlackWebhook(target.slackWebhookUrl);
  if (slackUrl) {
    console.log(`Sending Slack notification for ${target.businessName} lead to webhook`);
    const slackOk = await sendSlackMessage(slackUrl, baseMsg, responseText, item.link || null);
    if (!slackOk) {
      console.error(`Slack send failed for ${target.businessName}`);
    }
  } else {
    console.log(`No Slack webhook configured for ${target.businessName}`);
  }
}

async function scanFeedForTargets(feedUrl: string, targets: AlertTarget[]): Promise<void> {
  try {
    const res = await fetch(feedUrl, {
      headers: {
        "User-Agent": "Gemin-Eye/1.0 (RSS Reader)",
        "Accept": "text/xml, application/rss+xml, application/xml, application/atom+xml",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const xml = await res.text();
    const feed = await parser.parseString(xml);
    const items = feed.items.slice(0, 8).map((item) => ({
      title: item.title ? stripHtml(item.title) : "",
      content: stripHtml(item.contentSnippet || item.content || item.summary || ""),
      link: item.link || "",
      source: item.link ? extractSourceName(item.link) : "Web",
    }));

    for (const item of items) {
      const itemId = item.link ? canonicalizeUrl(item.link) : (item.title || "");
      if (!itemId) continue;

      for (const target of targets) {
        const seenKey = `ga::${itemId}::${target.businessId}`;
        if (await hasBeenSeen(seenKey)) continue;
        await markSeen(seenKey, "google_alerts");

        try {
          await processAlertItem(item, target);
        } catch (err: any) {
          console.error(`Error processing alert for ${target.businessName}: ${err?.message || err}`);
        }
      }
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes("403") || errMsg.includes("429")) {
      console.log(`Google Alerts rate-limited for feed, will retry next cycle`);
    } else {
      console.error(`Error scanning Google Alert feed: ${errMsg}`);
    }
  }
}

async function runScan(): Promise<void> {
  const targets = await getAlertTargets();

  if (targets.length === 0) {
    return;
  }

  const feedMap = new Map<string, AlertTarget[]>();
  for (const t of targets) {
    const key = t.feedUrl;
    if (!feedMap.has(key)) feedMap.set(key, []);
    feedMap.get(key)!.push(t);
  }

  console.log(`Google Alerts monitor: scanning ${feedMap.size} feeds for ${targets.length} business targets...`);

  const entries = Array.from(feedMap.values());
  for (const feedTargets of entries) {
    await scanFeedForTargets(feedTargets[0].feedUrl, feedTargets);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export function startGoogleAlertsMonitor(): void {
  if (monitorInterval) return;
  if (process.env.MONITORING_DISABLED === "true") {
    console.log("Google Alerts monitor: DISABLED via MONITORING_DISABLED env var");
    return;
  }

  console.log("Google Alerts monitor: starting (scans every 2 minutes)");

  setTimeout(() => {
    runScan().catch((err) => console.error("Google Alerts monitor scan error:", err));
  }, 15000);

  monitorInterval = setInterval(() => {
    runScan().catch((err) => console.error("Google Alerts monitor scan error:", err));
  }, SCAN_INTERVAL);
}

export function stopGoogleAlertsMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("Google Alerts monitor: stopped");
  }
}
