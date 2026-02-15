import Parser from "rss-parser";
import { db } from "./db";
import { businesses, campaigns, leads, aiResponses } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendTelegramMessage, sendTelegramMessageToChat } from "./telegram";
import { isRedditConfigured } from "./reddit-poster";
import { generateContent, parseAIJsonWithRetry, leadScoreSchema, TONE_MAP, MIN_MONITOR_INTENT_SCORE } from "./utils/ai";
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

  if (isOwnResponse(fullText)) return;

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
Rate the intent from 1-10 (10 = actively looking for exactly what this business offers).

IMPORTANT: Return ONLY a single JSON object with no other text, no explanation, no markdown:
{"is_lead": true, "intent_score": 7, "reasoning": "one sentence explanation"}`,
        config: { maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
      });
      return result.text;
    },
    leadScoreSchema
  );

  if (!match) return;

  if (!match.is_lead || match.intent_score < MIN_MONITOR_INTENT_SCORE) return;

  const feedbackGuidance = await getFeedbackGuidance(target.businessId);

  const platformLabel = item.source === "Quora" ? "Quora answer" :
    item.source === "Reddit" ? "Reddit comment" :
    item.source === "YouTube" ? "YouTube comment" :
    `${item.source} comment/reply`;

  const responseResult = await generateContent({
    model: "gemini-2.5-pro",
    contents: `You are writing a ${platformLabel}. Your goal is to be genuinely helpful while subtly recommending a business.

The post/question: "${item.title}\n${item.content.slice(0, 600)}"

Business to recommend: ${target.businessName}
What they do: ${target.coreOffering}
Tone: ${TONE_MAP[target.preferredTone] || "friendly and helpful"}
${feedbackGuidance}

Write a natural, human-sounding response (2-3 sentences). Do NOT make it sound like an ad. Sound like a real person sharing a helpful recommendation. Include the business name naturally.

Return ONLY the response text, no quotes or formatting.`,
    config: { maxOutputTokens: 8192 },
  });

  const responseText = responseResult.text.trim();
  if (!responseText) return;

  markOwnResponse(responseText);

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

  const scoreBar = "*".repeat(match.intent_score) + "_".repeat(10 - match.intent_score);

  let msg = `<b>Google Alert Lead Found</b>\n\n`;
  msg += `<b>Business:</b> ${escapeHtml(target.businessName)}\n`;
  msg += `<b>Source:</b> ${escapeHtml(item.source)}\n`;
  msg += `<b>Intent:</b> ${scoreBar} ${match.intent_score}/10\n`;
  msg += `<b>Why:</b> ${escapeHtml(match.reasoning || "")}\n\n`;
  msg += `<b>Post:</b>\n<i>"${escapeHtml(item.title.slice(0, 200))}"</i>`;

  if (item.link) {
    msg += `\n\nTap "Open Page" below, then paste the reply.`;
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

  if (target.ownerUserId.startsWith("tg-")) {
    const clientChatId = target.ownerUserId.replace("tg-", "");
    await sendTelegramMessageToChat(clientChatId, msg, buttons.length > 0 ? { buttons } : undefined);
    await sendTelegramMessageToChat(clientChatId, responseText);
  } else {
    await sendTelegramMessage(msg, buttons.length > 0 ? { buttons } : undefined);
    await sendTelegramMessage(responseText);
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
