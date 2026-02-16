import Parser from "rss-parser";
import { db } from "./db";
import { businesses, campaigns, leads, aiResponses } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendTelegramMessage, sendTelegramMessageToChat } from "./telegram";
import { isRedditConfigured } from "./reddit-poster";
import { generateContent, parseAIJsonWithRetry, leadScoreSchema, TONE_MAP, MIN_MONITOR_INTENT_SCORE } from "./utils/ai";
import { escapeHtml } from "./utils/html";
import { hasBeenSeen, markSeen, markOwnResponse, isOwnResponse } from "./utils/dedup";
import { getFeedbackGuidance } from "./utils/feedback";
import { keywordMatch } from "./utils/keywords";

const parser = new Parser({
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; Gemin-Eye/1.0; +https://gemin-eye.com)",
    "Accept": "text/xml, application/rss+xml, application/xml",
  },
  timeout: 10000,
});
const SCAN_INTERVAL = 5 * 60 * 1000;
let monitorInterval: ReturnType<typeof setInterval> | null = null;

interface SubredditTarget {
  subreddit: string;
  businessId: number;
  businessName: string;
  businessType: string;
  coreOffering: string;
  preferredTone: string;
  campaignId: number;
  keywords: string[];
  ownerUserId: string;
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
          ownerUserId: biz.userId,
        });
      }
    }
  }

  return targets;
}

async function processPostForTarget(
  post: { title: string; content: string; link: string },
  target: SubredditTarget
): Promise<void> {
  const title = post.title;
  const content = post.content;
  const fullText = `${title}\n${content}`;

  if (await isOwnResponse(fullText)) return;

  if (target.keywords.length > 0 && !keywordMatch(fullText, target.keywords)) return;

  const match = await parseAIJsonWithRetry(
    async () => {
      const result = await generateContent({
        model: "gemini-2.5-flash",
        contents: `You are a lead scout for "${target.businessName}" (${target.businessType}).
They offer: ${target.coreOffering}

Analyze this Reddit post from r/${target.subreddit}:
Title: "${title}"
Content: "${content.slice(0, 400)}"

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

  const responseResult = await generateContent({
    model: "gemini-2.5-pro",
    contents: `You are writing a Reddit comment in r/${target.subreddit}. Your ONLY goal is to be genuinely helpful. This must comply with Reddit's rules against self-promotion and spam.

The post: "${title}\n${content.slice(0, 400)}"

Your expertise area: ${target.coreOffering}
Tone: ${TONE_MAP[target.preferredTone] || "friendly and helpful"}
${feedbackGuidance}

STRICT RULES FOR REDDIT COMPLIANCE:
- Do NOT mention any business name, brand, website, or link
- Do NOT say "I recommend" or "check out" or "you should try"
- Do NOT hint that you represent or work for any company
- Write as a knowledgeable community member sharing genuine advice
- Answer their question directly with useful, specific information
- Sound like a real Redditor — casual, helpful, maybe slightly opinionated
- Keep it 2-4 sentences, natural and conversational

The response should be PURELY helpful advice based on your expertise. The value is in demonstrating knowledge, not promoting anything.

Return ONLY the response text, no quotes or formatting.`,
    config: { maxOutputTokens: 8192 },
  });

  const responseText = responseResult.text.trim();
  if (!responseText) return;

  await markOwnResponse(responseText);

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

  const buttons = [];
  if (post.link) {
    buttons.push([{ text: "Open Post", url: post.link }]);
  }
  if (savedResponseId && post.link && isRedditConfigured()) {
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
    await sendTelegramMessageToChat(clientChatId, msg, { buttons });
    await sendTelegramMessageToChat(clientChatId, responseText);
  } else {
    await sendTelegramMessage(msg, { buttons });
    await sendTelegramMessage(responseText);
  }
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

    let newPosts = 0;
    let kwMatches = 0;
    for (const post of posts) {
      const postId = post.link || post.title || "";
      if (!postId) continue;

      for (const target of targets) {
        const seenKey = `rd::${postId}::${target.businessId}`;
        if (await hasBeenSeen(seenKey)) continue;
        await markSeen(seenKey, "reddit");
        newPosts++;

        try {
          await processPostForTarget(post, target);
        } catch (err: any) {
          console.error(`Error processing post for ${target.businessName}: ${err?.message || err}`);
        }
      }
    }
    if (newPosts > 0) {
      console.log(`Reddit monitor: r/${subreddit} - ${posts.length} posts, ${newPosts} new evaluations`);
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
  if (process.env.MONITORING_DISABLED === "true") {
    console.log("Reddit monitor: DISABLED via MONITORING_DISABLED env var");
    return;
  }

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
