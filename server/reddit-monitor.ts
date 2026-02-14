import Parser from "rss-parser";
import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { businesses, campaigns, leads, aiResponses, responseFeedback, seenItems } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendTelegramMessage } from "./telegram";

function safeParseJsonFromAI(text: string): any | null {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

const MIN_MONITOR_INTENT_SCORE = 5;
const SALESY_FEEDBACK_THRESHOLD = 0.3;

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const parser = new Parser({
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; Gemin-Eye/1.0; +https://gemin-eye.com)",
    "Accept": "text/xml, application/rss+xml, application/xml",
  },
  timeout: 10000,
});
const SCAN_INTERVAL = 5 * 60 * 1000;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

async function hasBeenSeen(dedupKey: string): Promise<boolean> {
  const existing = await db.select({ id: seenItems.id }).from(seenItems).where(eq(seenItems.dedupKey, dedupKey)).limit(1);
  return existing.length > 0;
}

async function markSeen(dedupKey: string): Promise<void> {
  try {
    await db.insert(seenItems).values({ dedupKey, source: "reddit" }).onConflictDoNothing();
  } catch {}
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface SubredditTarget {
  subreddit: string;
  businessId: number;
  businessName: string;
  businessType: string;
  coreOffering: string;
  preferredTone: string;
  campaignId: number;
  keywords: string[];
}

async function getRedditTargets(): Promise<SubredditTarget[]> {
  const allBiz = await db.select().from(businesses);
  const allCamps = await db.select().from(campaigns);

  const targets: SubredditTarget[] = [];

  for (const biz of allBiz) {
    const bizCamps = allCamps.filter(
      (c) => c.businessId === biz.id && c.status === "active"
    );

    for (const camp of bizCamps) {
      const groups = (camp.targetGroups || []) as string[];
      const keywords = (camp.keywords || []) as string[];

      for (const group of groups) {
        const cleaned = group
          .replace(/^r\//, "")
          .replace(/^\/r\//, "")
          .trim();
        if (!cleaned) continue;
        if (/\s/.test(cleaned)) continue;
        if (cleaned.length > 50) continue;

        targets.push({
          subreddit: cleaned,
          businessId: biz.id,
          businessName: biz.name,
          businessType: biz.type,
          coreOffering: biz.coreOffering,
          preferredTone: biz.preferredTone,
          campaignId: camp.id,
          keywords,
        });
      }
    }
  }

  return targets;
}

function keywordMatch(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

async function processPostForTarget(
  post: { title: string; content: string; link: string },
  target: SubredditTarget
): Promise<void> {
  const title = post.title;
  const content = post.content;
  const fullText = `${title}\n${content}`;

  if (!keywordMatch(fullText, target.keywords)) return;

  console.log(`Reddit monitor: keyword match for "${target.businessName}" in r/${target.subreddit}: "${title.slice(0, 60)}..."`);

  const matchResult = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `You are a lead scout for "${target.businessName}" (${target.businessType}).
They offer: ${target.coreOffering}

Analyze this Reddit post from r/${target.subreddit}:
Title: "${title}"
Content: "${content.slice(0, 400)}"

Is this person asking a question or seeking help/recommendations that "${target.businessName}" could address?
Rate the intent from 1-10 (10 = actively looking for exactly what this business offers).

Return ONLY valid JSON:
{"is_lead": true/false, "intent_score": <1-10>, "reasoning": "<one sentence>"}`,
    config: { maxOutputTokens: 512 },
  });

  const matchText = matchResult.text || "";
  const match = safeParseJsonFromAI(matchText);
  if (!match) return;

  console.log(`Reddit monitor: AI scored "${title.slice(0, 40)}" for ${target.businessName}: ${match.intent_score}/10 (is_lead: ${match.is_lead})`);

  if (!match.is_lead || match.intent_score < MIN_MONITOR_INTENT_SCORE) return;

  let feedbackGuidance = "";
  try {
    const recentFeedback = await db
      .select({ feedback: responseFeedback.feedback })
      .from(responseFeedback)
      .innerJoin(aiResponses, eq(responseFeedback.responseId, aiResponses.id))
      .innerJoin(leads, eq(aiResponses.leadId, leads.id))
      .innerJoin(campaigns, eq(leads.campaignId, campaigns.id))
      .where(eq(campaigns.businessId, target.businessId))
      .orderBy(responseFeedback.id)
      .limit(20);

    const salesyCount = recentFeedback.filter((f) => f.feedback === "too_salesy").length;
    const negCount = recentFeedback.filter((f) => f.feedback !== "positive").length;
    const total = recentFeedback.length;

    if (total > 0) {
      if (salesyCount > total * SALESY_FEEDBACK_THRESHOLD) {
        feedbackGuidance =
          "\nIMPORTANT: Previous responses were rated as too salesy. Be EXTRA subtle - barely mention the business. Focus 90% on being helpful.";
      } else if (negCount > total * 0.5) {
        feedbackGuidance =
          "\nIMPORTANT: Previous responses had mixed reviews. Focus on being more genuine and less promotional.";
      }
    }
  } catch {
  }

  const toneMap: Record<string, string> = {
    empathetic: "empathetic, warm, and supportive",
    professional: "professional, authoritative, and informative",
    casual: "casual, friendly, and approachable",
  };

  const responseResult = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: `You are writing a Reddit comment in r/${target.subreddit}. Your goal is to be genuinely helpful while subtly recommending a business.

The post: "${title}\n${content.slice(0, 400)}"

Business to recommend: ${target.businessName}
What they do: ${target.coreOffering}
Tone: ${toneMap[target.preferredTone] || "friendly and helpful"}
${feedbackGuidance}

Write a natural, human-sounding Reddit comment (2-3 sentences). Do NOT make it sound like an ad. Sound like a real person sharing a helpful recommendation. Include the business name naturally.

Return ONLY the response text, no quotes or formatting.`,
    config: { maxOutputTokens: 8192 },
  });

  const responseText = (responseResult.text || "").trim();
  if (!responseText) return;

  let savedResponseId: number | null = null;
  try {
    const [savedLead] = await db
      .insert(leads)
      .values({
        campaignId: target.campaignId,
        platform: "reddit",
        groupName: `r/${target.subreddit}`,
        authorName: "Reddit user",
        originalPost: fullText.slice(0, 2000),
        postUrl: post.link || null,
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
    console.error("Error saving Reddit lead to DB:", err);
  }

  const scoreBar = "*".repeat(match.intent_score) + "_".repeat(10 - match.intent_score);

  let msg = `<b>Reddit Lead Found</b>\n\n`;
  msg += `<b>Business:</b> ${escapeHtml(target.businessName)}\n`;
  msg += `<b>Subreddit:</b> r/${escapeHtml(target.subreddit)}\n`;
  msg += `<b>Intent:</b> ${scoreBar} ${match.intent_score}/10\n`;
  msg += `<b>Why:</b> ${escapeHtml(match.reasoning || "")}\n\n`;
  msg += `<b>Post:</b>\n<i>"${escapeHtml(title.slice(0, 200))}"</i>`;

  if (post.link) {
    msg += `\n\nTap "Open Post" below, then paste the reply.`;
  }

  const buttons = [];
  if (post.link) {
    buttons.push([{ text: "Open Post", url: post.link }]);
  }
  if (savedResponseId) {
    buttons.push([
      { text: "Used It", callback_data: `fb_good_${savedResponseId}` },
      { text: "Bad Match", callback_data: `fb_bad_${savedResponseId}` },
      { text: "Too Salesy", callback_data: `fb_salesy_${savedResponseId}` },
      { text: "Wrong Client", callback_data: `fb_wrong_${savedResponseId}` },
    ]);
  }

  await sendTelegramMessage(msg, { buttons });
  await sendTelegramMessage(responseText);
}

async function scanSubredditForTargets(subreddit: string, targets: SubredditTarget[]): Promise<void> {
  const url = `https://www.reddit.com/r/${subreddit}/new.rss`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Gemin-Eye/1.0 (RSS Reader)",
        "Accept": "text/xml, application/rss+xml, application/xml",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const xml = await res.text();
    const feed = await parser.parseString(xml);
    const posts = feed.items.slice(0, 5).map((item) => ({
      title: item.title || "",
      content: item.contentSnippet || item.content || "",
      link: item.link || "",
    }));

    for (const post of posts) {
      const postId = post.link || post.title || "";
      if (!postId) continue;

      for (const target of targets) {
        const seenKey = `rd::${postId}::${target.businessId}`;
        if (await hasBeenSeen(seenKey)) continue;
        await markSeen(seenKey);

        try {
          await processPostForTarget(post, target);
        } catch (err: any) {
          console.error(`Error processing post for ${target.businessName}: ${err?.message || err}`);
        }
      }
    }
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes("403") || errMsg.includes("429") || errMsg.includes("Forbidden")) {
      console.log(`Reddit rate-limited on r/${subreddit}, will retry next cycle`);
    } else if (errMsg.includes("404") || errMsg.includes("Not Found")) {
      console.log(`r/${subreddit} not found (invalid subreddit name), skipping`);
    } else {
      console.error(`Error scanning r/${subreddit}: ${errMsg}`);
    }
  }
}

async function runScan(): Promise<void> {
  const targets = await getRedditTargets();

  if (targets.length === 0) {
    return;
  }

  const subMap = new Map<string, SubredditTarget[]>();
  for (const t of targets) {
    const key = t.subreddit.toLowerCase();
    if (!subMap.has(key)) subMap.set(key, []);
    subMap.get(key)!.push(t);
  }

  console.log(`Reddit monitor: scanning ${subMap.size} subreddits for ${targets.length} business targets...`);

  const entries = Array.from(subMap.values());
  let scannedCount = 0;
  for (const subTargets of entries) {
    await scanSubredditForTargets(subTargets[0].subreddit, subTargets);
    scannedCount++;
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`Reddit monitor: scan complete (${scannedCount}/${subMap.size} subreddits)`);
}

export function startRedditMonitor(): void {
  if (monitorInterval) return;

  console.log("Reddit monitor: starting (scans every 5 minutes)");

  setTimeout(() => {
    runScan().catch((err) => console.error("Reddit monitor scan error:", err));
  }, 10000);

  monitorInterval = setInterval(() => {
    runScan().catch((err) => console.error("Reddit monitor scan error:", err));
  }, SCAN_INTERVAL);
}

export function stopRedditMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("Reddit monitor: stopped");
  }
}

