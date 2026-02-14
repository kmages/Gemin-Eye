import { GoogleGenAI } from "@google/genai";
import crypto from "crypto";
import { db } from "./db";
import { businesses, campaigns, leads, aiResponses, responseFeedback } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendTelegramMessage, sendTelegramMessageToChat, answerCallbackQuery, editMessageReplyMarkup, type TelegramMessageOptions } from "./telegram";
import { storage } from "./storage";
import { postRedditComment, postRedditSubmission, isRedditConfigured } from "./reddit-poster";

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

export function generateScanToken(chatId: string, businessId: number): string {
  const secret = process.env.SESSION_SECRET || "gemin-eye-default";
  return crypto.createHmac("sha256", secret).update(`${chatId}:${businessId}`).digest("hex").slice(0, 32);
}

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

interface PendingContextRequest {
  postText: string;
  postUrl: string | null;
  platform: "reddit" | "facebook" | null;
  timestamp: number;
}

const pendingContextRequests = new Map<string, PendingContextRequest>();

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

interface PostAnalysis {
  message: string;
  responseText: string | null;
  postUrl: string | null;
  platform: "reddit" | "facebook" | null;
  responseId: number | null;
  needsGroupContext: boolean;
}

async function handlePost(postText: string, groupName?: string, postUrl?: string | null, overridePlatform?: "reddit" | "facebook" | null): Promise<PostAnalysis> {
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

  const matchResult = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: matchPrompt,
    config: { maxOutputTokens: 1024 },
  });

  const matchText = matchResult.text || "";
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
    // feedback query failed, proceed without it
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

  const responseResult = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: responsePrompt,
    config: { maxOutputTokens: 8192 },
  });

  const responseText = (responseResult.text || "").trim();

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

const pendingRedditPosts = new Map<number, { responseText: string; postUrl: string; timestamp: number }>();
const REDDIT_POST_TTL = 30 * 60 * 1000;

const pendingClientSetups = new Map<string, { step: string; name?: string; type?: string; audience?: string; offering?: string; tone?: string; keywords?: string[]; groups?: string[] }>();

interface ClientWizardState {
  step: "name" | "offering" | "location" | "keywords" | "done";
  chatId: string;
  name?: string;
  keywords?: string[];
  offering?: string;
  location?: string;
}

const clientWizards = new Map<string, ClientWizardState>();

export function generateLinkedInBookmarkletCode(baseUrl: string, chatId: string, businessId: number, token: string): string {
  const apiUrl = `${baseUrl}/api/li-scan`;
  const code = `javascript:void((function(){if(window.__geminEyeLiActive){alert('Gemin-Eye is already scanning this page. Click X on the banner to stop first.');return}window.__geminEyeLiActive=true;var CID='${chatId}',BID=${businessId},TOK='${token}',API='${apiUrl}';var seenPosts={},scannedCount=0,sentCount=0,autoScrolling=true,scrollsDone=0,maxScrolls=150;var banner=document.createElement('div');banner.id='gemin-eye-li-banner';banner.style.cssText='position:fixed;top:0;left:0;width:100%;background:linear-gradient(135deg,#0077B5,#00A0DC);color:white;text-align:center;padding:10px 20px;z-index:2147483647;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:8px;';var counter=document.createElement('span');counter.style.cssText='font-weight:normal;opacity:0.85;font-size:13px;';counter.textContent='0 posts scanned';var pauseBtn=document.createElement('span');pauseBtn.textContent='Pause';pauseBtn.style.cssText='cursor:pointer;background:rgba(255,255,255,0.2);padding:2px 10px;border-radius:4px;font-size:12px;margin-left:8px;';pauseBtn.onclick=function(){autoScrolling=!autoScrolling;pauseBtn.textContent=autoScrolling?'Pause':'Resume'};var closeBtn=document.createElement('span');closeBtn.textContent='X';closeBtn.style.cssText='position:absolute;right:16px;cursor:pointer;font-size:16px;opacity:0.7;';closeBtn.onclick=function(){banner.remove();window.__geminEyeLiActive=false;autoScrolling=false;clearInterval(si);clearInterval(scrollInterval)};banner.appendChild(document.createTextNode('Gemin-Eye LinkedIn: Scanning... '));banner.appendChild(counter);banner.appendChild(pauseBtn);banner.appendChild(closeBtn);document.body.appendChild(banner);function extractPosts(){var found=[];var els=document.querySelectorAll('.feed-shared-update-v2__description,.feed-shared-inline-show-more-text,.feed-shared-text,.update-components-text,.break-words');els.forEach(function(el){var t=(el.innerText||'').trim();if(t.length<25||t.length>5000||seenPosts[t])return;found.push({text:t,element:el})});var articles=document.querySelectorAll('[data-urn]');articles.forEach(function(el){var t=(el.innerText||'').trim();if(t.length<50||t.length>5000||seenPosts[t])return;var hasDesc=el.querySelector('.feed-shared-update-v2__description,.feed-shared-text,.update-components-text,.break-words');if(!hasDesc){found.push({text:t.slice(0,2000),element:el})}});return found}function getAuthor(el){var c=el.closest('[data-urn]')||el.closest('.feed-shared-update-v2');if(!c)return'LinkedIn user';var a=c.querySelector('.update-components-actor__name span[aria-hidden],.feed-shared-actor__name span');return a?(a.innerText||'').trim():'LinkedIn user'}function sendPost(postText,element){seenPosts[postText]=true;scannedCount++;fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chatId:CID,businessId:BID,token:TOK,postText:postText,authorName:getAuthor(element),pageUrl:window.location.href})}).then(function(r){return r.json()}).then(function(d){if(d.matched){sentCount++;element.style.outline='3px solid #0077B5';element.style.outlineOffset='4px';element.style.borderRadius='4px'}}).catch(function(){});counter.textContent=scannedCount+' scanned, '+sentCount+' leads'}function scan(){var posts=extractPosts();posts.forEach(function(p){sendPost(p.text,p.element)})}scan();var si=setInterval(scan,3000);var scrollInterval=setInterval(function(){if(!autoScrolling)return;scrollsDone++;if(scrollsDone>=maxScrolls){autoScrolling=false;pauseBtn.textContent='Done';clearInterval(scrollInterval);return}window.scrollBy(0,600)},2000)})())`;
  return code;
}

export function generateBookmarkletCode(baseUrl: string, chatId: string, businessId: number, token: string): string {
  const apiUrl = `${baseUrl}/api/fb-scan`;
  const code = `javascript:void((function(){if(window.__geminEyeActive){alert('Gemin-Eye is already scanning this page. Click X on the banner to stop first.');return}window.__geminEyeActive=true;var CID='${chatId}',BID=${businessId},TOK='${token}',API='${apiUrl}';var seenPosts={},scannedCount=0,sentCount=0,autoScrolling=true,scrollsDone=0,maxScrolls=150;var banner=document.createElement('div');banner.id='gemin-eye-banner';banner.style.cssText='position:fixed;top:0;left:0;width:100%;background:linear-gradient(135deg,#4338ca,#6d28d9);color:white;text-align:center;padding:10px 20px;z-index:2147483647;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;gap:8px;';var counter=document.createElement('span');counter.style.cssText='font-weight:normal;opacity:0.85;font-size:13px;';counter.textContent='0 posts scanned';var pauseBtn=document.createElement('span');pauseBtn.textContent='Pause';pauseBtn.style.cssText='cursor:pointer;background:rgba(255,255,255,0.2);padding:2px 10px;border-radius:4px;font-size:12px;margin-left:8px;';pauseBtn.onclick=function(){autoScrolling=!autoScrolling;pauseBtn.textContent=autoScrolling?'Pause':'Resume'};var closeBtn=document.createElement('span');closeBtn.textContent='X';closeBtn.style.cssText='position:absolute;right:16px;cursor:pointer;font-size:16px;opacity:0.7;';closeBtn.onclick=function(){banner.remove();window.__geminEyeActive=false;autoScrolling=false;clearInterval(si);clearInterval(scrollInterval)};banner.appendChild(document.createTextNode('Gemin-Eye: Auto-scanning... '));banner.appendChild(counter);banner.appendChild(pauseBtn);banner.appendChild(closeBtn);document.body.appendChild(banner);function extractPosts(){var found=[];var els=document.querySelectorAll('div[dir=\"auto\"]');els.forEach(function(el){var t=(el.innerText||'').trim();if(t.length<25||t.length>5000||seenPosts[t])return;var a=el.closest('a');if(a&&a.href&&a.href.indexOf('/comment')===-1)return;found.push({text:t,element:el})});return found}function sendPost(postText,element){seenPosts[postText]=true;scannedCount++;var gn='';var h1=document.querySelector('h1');if(h1)gn=h1.innerText||'';if(!gn){var te=document.querySelector('[role=\"banner\"] a[href*=\"/groups/\"]');if(te)gn=te.innerText||''}fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chatId:CID,businessId:BID,token:TOK,postText:postText,groupName:gn||document.title||'Facebook Group',pageUrl:window.location.href})}).then(function(r){return r.json()}).then(function(d){if(d.matched){sentCount++;element.style.outline='3px solid #6d28d9';element.style.outlineOffset='4px';element.style.borderRadius='4px'}}).catch(function(){});counter.textContent=scannedCount+' scanned, '+sentCount+' leads'}function scan(){var posts=extractPosts();posts.forEach(function(p){sendPost(p.text,p.element)})}scan();var si=setInterval(scan,3000);var scrollInterval=setInterval(function(){if(!autoScrolling)return;scrollsDone++;if(scrollsDone>=maxScrolls){autoScrolling=false;pauseBtn.textContent='Done';clearInterval(scrollInterval);return}window.scrollBy(0,600)},2000)})())`;
  return code;
}

function getAppBaseUrl(): string {
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
  if (replitDevDomain) return `https://${replitDevDomain}`;
  const replSlug = process.env.REPL_SLUG;
  const replOwner = process.env.REPL_OWNER;
  if (replSlug && replOwner) return `https://${replSlug}.${replOwner}.repl.co`;
  return "https://gemin-eye.com";
}

async function handleClientWizard(chatId: string, text: string): Promise<boolean> {
  const wizard = clientWizards.get(chatId);
  if (!wizard) return false;

  if (text.startsWith("/")) {
    clientWizards.delete(chatId);
    return false;
  }

  switch (wizard.step) {
    case "name": {
      const name = text.trim();
      if (name.length < 2 || name.length > 100) {
        await sendTelegramMessageToChat(chatId, "Please enter a valid business name (2-100 characters).");
        return true;
      }
      wizard.name = name;
      wizard.step = "offering";
      await sendTelegramMessageToChat(chatId,
        `Got it: <b>${escapeHtml(wizard.name)}</b>\n\nIn one sentence, what does ${escapeHtml(wizard.name)} do or sell?\n<i>(e.g., "Classic American diner with all-day breakfast and comfort food")</i>`
      );
      return true;
    }

    case "offering": {
      const offering = text.trim();
      if (offering.length < 5) {
        await sendTelegramMessageToChat(chatId, "Please describe what the business does in at least a few words.");
        return true;
      }
      wizard.offering = offering;
      wizard.step = "location";
      await sendTelegramMessageToChat(chatId,
        `Got it.\n\nWhat's the reach of ${escapeHtml(wizard.name!)}? This helps me find the right communities to monitor.\n<i>(e.g., "Chicago IL", "National", "Global / web-based")</i>`
      );
      return true;
    }

    case "location": {
      const location = text.trim();
      if (location.length < 2) {
        await sendTelegramMessageToChat(chatId, "Please enter a location (city/state, or 'online' if not location-specific).");
        return true;
      }
      wizard.location = location;
      wizard.step = "keywords";
      await sendTelegramMessageToChat(chatId,
        `Perfect.\n\nNow give me 3-5 keywords to watch for, separated by commas.\n<i>(e.g., estate planning, trust attorney, wills and trusts, probate lawyer)</i>`
      );
      return true;
    }

    case "keywords": {
      wizard.keywords = text.split(",").map(k => k.trim()).filter(k => k.length > 0);
      if (wizard.keywords.length < 1) {
        await sendTelegramMessageToChat(chatId, "Please enter at least one keyword, separated by commas.");
        return true;
      }

      await sendTelegramMessageToChat(chatId, `Got it! Setting up your monitor now...`);

      const locationInfo = wizard.location || "Online";
      const biz = await storage.createBusiness({
        userId: `tg-${chatId}`,
        name: wizard.name!,
        type: wizard.offering || wizard.name!,
        targetAudience: locationInfo,
        coreOffering: wizard.offering || wizard.name!,
        preferredTone: "casual",
      });

      let redditSubs: string[] = [];
      try {
        const groupResult = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `A business needs REAL Reddit subreddits to monitor for customer leads.

Business: ${wizard.name}
Offering: ${wizard.offering}
Location: ${locationInfo}
Keywords: ${wizard.keywords.join(", ")}

Return ONLY valid JSON: {"subreddits": ["r/example1", "r/example2"]}

RULES:
- List 5-8 REAL Reddit subreddits that actually exist.
- NEVER use placeholders like "r/[yourcity]". Use specific real names.
- If the business has a specific local area, include the local city/region subreddit (e.g., r/chicago, r/austin, r/nyc).
- If the business is national or global/web-based, focus on industry and topic subreddits instead of geographic ones.
- Focus on communities where people ask for recommendations related to this business.`,
          config: { maxOutputTokens: 256 },
        });
        const groupJson = safeParseJsonFromAI(groupResult.text || "");
        if (groupJson?.subreddits?.length > 0) {
          redditSubs = groupJson.subreddits;
        }
      } catch (e) {
        console.error("Client wizard AI group gen failed:", e);
      }
      if (redditSubs.length === 0) {
        redditSubs = ["r/smallbusiness", "r/Entrepreneur"];
      }

      await storage.createCampaign({
        businessId: biz.id,
        name: `${wizard.name} - Facebook`,
        platform: "Facebook",
        status: "active",
        strategy: `Monitor Facebook groups for leads matching ${wizard.name}`,
        targetGroups: [],
        keywords: wizard.keywords,
      });

      await storage.createCampaign({
        businessId: biz.id,
        name: `${wizard.name} - LinkedIn`,
        platform: "LinkedIn",
        status: "active",
        strategy: `Monitor LinkedIn feed for leads matching ${wizard.name}`,
        targetGroups: [],
        keywords: wizard.keywords,
      });

      await storage.createCampaign({
        businessId: biz.id,
        name: `${wizard.name} - Reddit`,
        platform: "Reddit",
        status: "active",
        strategy: `Monitor Reddit communities for leads matching ${wizard.name}`,
        targetGroups: redditSubs,
        keywords: wizard.keywords,
      });

      clientWizards.delete(chatId);

      const baseUrl = getAppBaseUrl();
      const token = generateScanToken(chatId, biz.id);
      const fbBookmarkletCode = generateBookmarkletCode(baseUrl, chatId, biz.id, token);
      const liBookmarkletCode = generateLinkedInBookmarkletCode(baseUrl, chatId, biz.id, token);

      await sendTelegramMessageToChat(chatId,
        `<b>Setup Complete!</b>\n\n` +
        `<b>Location:</b> ${escapeHtml(locationInfo)}\n` +
        `I am now watching for: <b>${wizard.keywords.map(k => escapeHtml(k)).join(", ")}</b>\n\n` +
        `<b>Reddit Monitoring:</b> ${redditSubs.map(s => escapeHtml(s)).join(", ")}\n\n` +
        `<b>Facebook Spy Glass</b>\n` +
        `To scan Facebook Groups, create a browser bookmark with this code as the URL:\n\n` +
        `1. Right-click your bookmarks bar\n` +
        `2. Click "Add bookmark"\n` +
        `3. Name it: <b>Scan FB Group</b>\n` +
        `4. Paste this as the URL:`
      );

      await sendTelegramMessageToChat(chatId, `<code>${escapeHtml(fbBookmarkletCode)}</code>`);

      await sendTelegramMessageToChat(chatId,
        `<b>LinkedIn Spy Glass</b>\n` +
        `Same idea for LinkedIn! Create a second bookmark:\n\n` +
        `1. Right-click your bookmarks bar\n` +
        `2. Click "Add bookmark"\n` +
        `3. Name it: <b>Scan LinkedIn</b>\n` +
        `4. Paste this as the URL:`
      );

      await sendTelegramMessageToChat(chatId, `<code>${escapeHtml(liBookmarkletCode)}</code>`);

      await sendTelegramMessageToChat(chatId,
        `<b>How to use the bookmarklets:</b>\n` +
        `1. Go to any Facebook Group or LinkedIn feed/search\n` +
        `2. Click the matching bookmark\n` +
        `3. It auto-scrolls and scans posts\n` +
        `4. I'll message you here instantly when I spot a lead!`
      );

      await sendTelegramMessageToChat(chatId,
        `<b>What happens automatically:</b>\n` +
        `- Reddit is scanned every 5 minutes for posts matching your keywords\n` +
        `- When a lead is found, I'll send you an AI-written response here\n` +
        `- Tap the response buttons to give feedback and improve future responses\n\n` +
        `<b>Manual scanning:</b>\n` +
        `- Send me any post URL + text and I'll analyze it instantly\n` +
        `- Or just screenshot a post and send the image - I can read it!\n\n` +
        `<b>Commands:</b>\n` +
        `/help - Full usage guide\n` +
        `/setup - Run this wizard again\n\n` +
        `You're all set! I'll message you the moment I find a lead.`
      );

      await sendTelegramMessage(
        `<b>New Client Onboarded via Wizard</b>\n\n` +
        `<b>Business:</b> ${escapeHtml(biz.name)}\n` +
        `<b>Location:</b> ${escapeHtml(locationInfo)}\n` +
        `<b>Telegram ID:</b> ${chatId}\n` +
        `<b>Keywords:</b> ${wizard.keywords.map(k => escapeHtml(k)).join(", ")}\n` +
        `<b>Reddit:</b> ${redditSubs.map(s => escapeHtml(s)).join(", ")}`
      );

      return true;
    }
  }

  return false;
}

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

  if (text === "/addalert") {
    const allBiz = await getAllBusinessesWithCampaigns();
    if (allBiz.length === 0) {
      await sendTelegramMessage("No businesses set up. Use /newclient first.");
      return true;
    }

    let msg = `<b>Add Google Alert Feed</b>\n\nWhich business should this alert feed be attached to?\n\n`;
    allBiz.forEach((b, i) => {
      msg += `<b>${i + 1}.</b> ${escapeHtml(b.name)}\n`;
    });
    msg += `\nReply with the number, or /cancel.`;

    pendingClientSetups.set(chatId, { step: "alert_select" });
    await sendTelegramMessage(msg);
    return true;
  }

  if (text === "/alerts") {
    const allBiz = await getAllBusinessesWithCampaigns();
    const allCamps = await db.select().from(campaigns);

    const alertCamps = allCamps.filter(c => c.platform.toLowerCase() === "google_alerts" && c.status === "active");
    if (alertCamps.length === 0) {
      await sendTelegramMessage(
        `<b>No Google Alert feeds configured.</b>\n\n` +
        `To add one:\n` +
        `1. Go to <a href="https://google.com/alerts">google.com/alerts</a>\n` +
        `2. Enter your search query (e.g., <code>site:quora.com "best pizza"</code>)\n` +
        `3. Click "Show Options" and set Deliver to: <b>RSS Feed</b>\n` +
        `4. Copy the RSS feed URL\n` +
        `5. Use /addalert to add it here`
      );
      return true;
    }

    let msg = `<b>Your Google Alert Feeds:</b>\n\n`;
    for (const camp of alertCamps) {
      const biz = allBiz.find(b => b.id === camp.businessId);
      const feeds = (camp.targetGroups as string[]) || [];
      msg += `<b>${escapeHtml(biz?.name || "Unknown")}</b>\n`;
      feeds.forEach((f, i) => {
        const shortUrl = f.length > 60 ? f.slice(0, 57) + "..." : f;
        msg += `  ${i + 1}. ${escapeHtml(shortUrl)}\n`;
      });
      msg += `\n`;
    }
    msg += `Use /addalert to add more feeds.\nUse /removealert to remove a feed.`;
    await sendTelegramMessage(msg);
    return true;
  }

  if (text === "/removealert") {
    const allCamps = await db.select().from(campaigns);
    const allBiz = await db.select().from(businesses);
    const alertCamps = allCamps.filter(c => c.platform.toLowerCase() === "google_alerts" && c.status === "active");

    if (alertCamps.length === 0) {
      await sendTelegramMessage("No Google Alert feeds to remove.");
      return true;
    }

    let msg = `<b>Remove a Google Alert Feed</b>\n\nReply with the number:\n\n`;
    let idx = 1;
    const feedIndex: Array<{ campaignId: number; feedUrl: string }> = [];
    for (const camp of alertCamps) {
      const biz = allBiz.find(b => b.id === camp.businessId);
      const feeds = (camp.targetGroups as string[]) || [];
      for (const f of feeds) {
        const shortUrl = f.length > 60 ? f.slice(0, 57) + "..." : f;
        msg += `<b>${idx}.</b> ${escapeHtml(biz?.name || "?")} - ${escapeHtml(shortUrl)}\n`;
        feedIndex.push({ campaignId: camp.id, feedUrl: f });
        idx++;
      }
    }
    msg += `\nOr /cancel.`;

    pendingClientSetups.set(chatId, { step: "alert_remove", groups: feedIndex.map(fi => `${fi.campaignId}::${fi.feedUrl}`) });
    await sendTelegramMessage(msg);
    return true;
  }

  if (text.startsWith("/post ")) {
    if (!isRedditConfigured()) {
      await sendTelegramMessage("Reddit credentials not configured. Add REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, and REDDIT_PASSWORD to your secrets.");
      return true;
    }

    const postArgs = text.slice(6).trim();
    const subredditMatch = postArgs.match(/^(r\/\w+)\s+([\s\S]+)/);

    if (!subredditMatch) {
      await sendTelegramMessage(
        `<b>Usage:</b>\n\n` +
        `<b>New post:</b>\n<code>/post r/subreddit Title here | Body text here</code>\n\n` +
        `<b>Reply to a post:</b>\nPaste a Reddit URL into the chat and I'll generate a response. Then tap "Post to Reddit" to comment.\n\n` +
        `<b>Example:</b>\n<code>/post r/startups Check out my AI tool | We built an AI that monitors communities for leads.</code>`
      );
      return true;
    }

    const subreddit = subredditMatch[1];
    const rest = subredditMatch[2].trim();

    const pipeIndex = rest.indexOf("|");
    let title: string;
    let body: string;

    if (pipeIndex > 0) {
      title = rest.slice(0, pipeIndex).trim();
      body = rest.slice(pipeIndex + 1).trim();
    } else {
      title = rest;
      body = "";
    }

    await sendTelegramMessage(`Posting to <b>${escapeHtml(subreddit)}</b>...\n\nTitle: <i>${escapeHtml(title)}</i>`);

    const result = await postRedditSubmission(subreddit, title, body);

    if (result.success) {
      let msg = "Posted to Reddit!";
      if (result.postUrl) {
        msg += `\n\n<a href="${result.postUrl}">View your post</a>`;
      }
      await sendTelegramMessage(msg);
    } else {
      await sendTelegramMessage(`Failed to post: ${result.error}`);
    }

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

      await sendTelegramMessage(`Keywords: ${pending.keywords.map(k => `<b>${escapeHtml(k)}</b>`).join(", ")}\n\nGenerating target communities with AI...`);

      let aiGroups: string[] = [];
      try {
        const groupResult = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `You are a social media expert. A business needs REAL Reddit subreddits and Facebook groups to monitor for customer acquisition leads.

Business: ${pending.name} (${pending.type})
Target audience: ${pending.audience}
Offering: ${pending.offering}
Keywords: ${(pending.keywords || []).join(", ")}

Return ONLY valid JSON with this structure:
{"subreddits": ["r/example1", "r/example2"], "facebook_groups": ["Example Group Name"]}

RULES:
- List 5-8 REAL Reddit subreddits that actually exist where the target audience asks questions or seeks recommendations.
- NEVER use placeholders like "r/[yourcity]". Use REAL specific names like "r/chicago", "r/fitness", "r/smallbusiness".
- List 2-3 relevant Facebook group names.
- Focus on communities where people actively ask for recommendations related to this business.`,
          config: { maxOutputTokens: 512 },
        });
        const groupJson = safeParseJsonFromAI(groupResult.text || "");
        if (groupJson) {
          aiGroups = [
            ...(groupJson.subreddits || []),
            ...(groupJson.facebook_groups || []),
          ];
        }
      } catch (e) {
        console.error("AI group generation failed:", e);
      }

      if (aiGroups.length === 0) {
        aiGroups = ["r/smallbusiness", "r/Entrepreneur"];
      }

      pending.groups = aiGroups;

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
          platform: "Reddit",
          status: "active",
          strategy: `Monitor communities for ${pending.type} leads`,
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
      msg += `<b>Auto-Generated Groups:</b> ${(pending.groups || []).map(g => escapeHtml(g)).join(", ")}\n\n`;
      msg += `I'm now watching for leads for <b>${escapeHtml(biz.name)}</b>. Send me posts to analyze!\n`;
      msg += `\n<i>Use /groups to view or change target communities.</i>`;

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

    case "alert_select": {
      const allBiz = await getAllBusinessesWithCampaigns();
      const idx = parseInt(text) - 1;
      if (isNaN(idx) || idx < 0 || idx >= allBiz.length) {
        await sendTelegramMessage("Invalid number. Try again or /cancel.");
        return true;
      }

      pending.name = allBiz[idx].name;
      pending.step = "alert_url";
      await sendTelegramMessage(
        `<b>Adding alert feed for ${escapeHtml(allBiz[idx].name)}</b>\n\n` +
        `Paste the Google Alert RSS feed URL:\n\n` +
        `<i>How to get it:</i>\n` +
        `1. Go to <a href="https://google.com/alerts">google.com/alerts</a>\n` +
        `2. Enter your search (e.g., <code>site:quora.com "best pizza"</code>)\n` +
        `3. Click "Show Options" and set Deliver to: <b>RSS Feed</b>\n` +
        `4. Copy the RSS URL and paste it here`,
        { disable_web_page_preview: true }
      );
      break;
    }

    case "alert_url": {
      const feedUrl = text.trim();
      if (!feedUrl.startsWith("http")) {
        await sendTelegramMessage("That doesn't look like a URL. Please paste the RSS feed URL starting with http:// or https://");
        return true;
      }

      const allBiz = await getAllBusinessesWithCampaigns();
      const biz = allBiz.find(b => b.name === pending.name);
      if (!biz) {
        pendingClientSetups.delete(chatId);
        await sendTelegramMessage("Business not found. Try again with /addalert.");
        return true;
      }

      const allCamps = await db.select().from(campaigns);
      let alertCamp = allCamps.find(c => c.businessId === biz.id && c.platform.toLowerCase() === "google_alerts" && c.status === "active");

      if (alertCamp) {
        const existingFeeds = (alertCamp.targetGroups as string[]) || [];
        if (existingFeeds.includes(feedUrl)) {
          pendingClientSetups.delete(chatId);
          await sendTelegramMessage("This feed URL is already added for this business.");
          return true;
        }
        await db.update(campaigns).set({ targetGroups: [...existingFeeds, feedUrl] }).where(eq(campaigns.id, alertCamp.id));
      } else {
        const bizKeywords = biz.campaigns.flatMap(c => c.keywords);
        await storage.createCampaign({
          businessId: biz.id,
          name: `${biz.name} - Google Alerts`,
          platform: "google_alerts",
          status: "active",
          strategy: `Monitor Google Alerts RSS feeds for ${biz.type} leads`,
          targetGroups: [feedUrl],
          keywords: bizKeywords,
        });
      }

      pendingClientSetups.delete(chatId);
      await sendTelegramMessage(
        `<b>Google Alert feed added!</b>\n\n` +
        `<b>Business:</b> ${escapeHtml(biz.name)}\n` +
        `<b>Feed:</b> ${escapeHtml(feedUrl.length > 60 ? feedUrl.slice(0, 57) + "..." : feedUrl)}\n\n` +
        `The monitor will check this feed every 2 minutes and alert you when it finds leads.\n\n` +
        `Use /alerts to see all feeds, or /addalert to add more.`
      );
      break;
    }

    case "alert_remove": {
      const idx = parseInt(text) - 1;
      const feedEntries = (pending.groups || []);
      if (isNaN(idx) || idx < 0 || idx >= feedEntries.length) {
        await sendTelegramMessage("Invalid number. Try again or /cancel.");
        return true;
      }

      const entry = feedEntries[idx];
      const [campId, ...feedUrlParts] = entry.split("::");
      const feedUrl = feedUrlParts.join("::");
      const campaignId = parseInt(campId);

      const camp = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
      if (camp.length > 0) {
        const existingFeeds = (camp[0].targetGroups as string[]) || [];
        const newFeeds = existingFeeds.filter(f => f !== feedUrl);
        if (newFeeds.length === 0) {
          await db.update(campaigns).set({ status: "inactive" }).where(eq(campaigns.id, campaignId));
        } else {
          await db.update(campaigns).set({ targetGroups: newFeeds }).where(eq(campaigns.id, campaignId));
        }
      }

      pendingClientSetups.delete(chatId);
      await sendTelegramMessage(`<b>Alert feed removed.</b>\n\nUse /alerts to see remaining feeds.`);
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

  async function sendResultWithButtons(result: PostAnalysis, chatId?: string) {
    const send = chatId ? (text: string, opts?: TelegramMessageOptions) => sendTelegramMessageToChat(chatId, text, opts) : (text: string, opts?: TelegramMessageOptions) => sendTelegramMessage(text, opts);

    const buttons: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];

    if (result.postUrl) {
      const label = result.platform === "reddit" ? "Open Reddit Post" : result.platform === "facebook" ? "Open Facebook Post" : "Open Post";
      buttons.push([{ text: label, url: result.postUrl }]);
    }

    if (result.responseId && result.platform === "reddit" && result.postUrl && result.responseText && isRedditConfigured()) {
      pendingRedditPosts.set(result.responseId, {
        responseText: result.responseText,
        postUrl: result.postUrl,
        timestamp: Date.now(),
      });
      buttons.push([{ text: "Post to Reddit", callback_data: `reddit_post_${result.responseId}` }]);
    }

    if (result.responseId) {
      buttons.push([
        { text: "Used It", callback_data: `fb_good_${result.responseId}` },
        { text: "Bad Match", callback_data: `fb_bad_${result.responseId}` },
        { text: "Too Salesy", callback_data: `fb_salesy_${result.responseId}` },
        { text: "Wrong Client", callback_data: `fb_wrong_${result.responseId}` },
      ]);
    }

    await send(result.message, buttons.length > 0 ? { buttons } : undefined);

    if (result.responseText) {
      await send(result.responseText);
    }
  }

  app.post(`/api/telegram/webhook/${token}`, async (req: any, res: any) => {
    try {
      res.sendStatus(200);

      const update = req.body;

      if (update?.callback_query) {
        const cbq = update.callback_query;
        const data = cbq.data as string;
        const cbqChatId = String(cbq.message?.chat?.id || "");

        if (data.startsWith("fb_")) {
          const parts = data.split("_");
          const feedbackType = parts[1];
          const responseId = parseInt(parts[2]);

          if (!isNaN(responseId)) {
            const feedbackMap: Record<string, string> = {
              good: "positive",
              bad: "bad_match",
              salesy: "too_salesy",
              wrong: "wrong_client",
            };

            const feedbackValue = feedbackMap[feedbackType] || feedbackType;

            try {
              const existing = await db.select().from(responseFeedback).where(eq(responseFeedback.responseId, responseId)).limit(1);
              if (existing.length > 0) {
                await answerCallbackQuery(cbq.id, "Feedback already recorded for this response.");
                return;
              }

              await db.insert(responseFeedback).values({
                responseId,
                feedback: feedbackValue,
              });

              if (feedbackValue === "positive") {
                await db.update(aiResponses).set({ status: "approved", approvedAt: new Date() }).where(eq(aiResponses.id, responseId));
              }
            } catch (err) {
              console.error("Error saving feedback:", err);
            }

            const feedbackLabels: Record<string, string> = {
              positive: "Marked as used - great!",
              bad_match: "Noted: bad match. I'll learn from this.",
              too_salesy: "Noted: too salesy. I'll adjust the tone.",
              wrong_client: "Noted: wrong client matched.",
            };

            await answerCallbackQuery(cbq.id, feedbackLabels[feedbackValue] || "Feedback saved!");

            if (cbq.message?.message_id && cbqChatId) {
              const existingButtons = cbq.message?.reply_markup?.inline_keyboard || [];
              const urlButtons = existingButtons.filter((row: any[]) => row.some((b: any) => b.url));
              const selectedLabel = feedbackType === "good" ? "Used It" : feedbackType === "salesy" ? "Too Salesy" : feedbackType === "wrong" ? "Wrong Client" : "Bad Match";
              const confirmRow = [{ text: `[${selectedLabel}]`, callback_data: "noop" }];
              const newKeyboard = [...urlButtons, confirmRow];
              await editMessageReplyMarkup(cbqChatId, cbq.message.message_id, { inline_keyboard: newKeyboard });
            }
          } else {
            await answerCallbackQuery(cbq.id);
          }
        } else if (data.startsWith("li_")) {
          const parts = data.split("_");
          const feedbackType = parts[1];
          const responseId = parseInt(parts[2]);

          if (!isNaN(responseId)) {
            const feedbackMap: Record<string, string> = {
              good: "positive",
              bad: "bad_match",
              salesy: "too_salesy",
              wrong: "wrong_client",
            };

            const feedbackValue = feedbackMap[feedbackType] || feedbackType;

            try {
              const existing = await db.select().from(responseFeedback).where(eq(responseFeedback.responseId, responseId)).limit(1);
              if (existing.length > 0) {
                await answerCallbackQuery(cbq.id, "Feedback already recorded for this response.");
                return;
              }

              await db.insert(responseFeedback).values({
                responseId,
                feedback: feedbackValue,
              });

              if (feedbackValue === "positive") {
                await db.update(aiResponses).set({ status: "approved", approvedAt: new Date() }).where(eq(aiResponses.id, responseId));
              }
            } catch (err) {
              console.error("Error saving LinkedIn feedback:", err);
            }

            const feedbackLabels: Record<string, string> = {
              positive: "Marked as used - great!",
              bad_match: "Noted: bad match. I'll learn from this.",
              too_salesy: "Noted: too salesy. I'll adjust the tone.",
              wrong_client: "Noted: wrong client matched.",
            };

            await answerCallbackQuery(cbq.id, feedbackLabels[feedbackValue] || "Feedback saved!");

            if (cbq.message?.message_id && cbqChatId) {
              const existingButtons = cbq.message?.reply_markup?.inline_keyboard || [];
              const urlButtons = existingButtons.filter((row: any[]) => row.some((b: any) => b.url));
              const selectedLabel = feedbackType === "good" ? "Used It" : feedbackType === "salesy" ? "Too Salesy" : feedbackType === "wrong" ? "Wrong Client" : "Bad Match";
              const confirmRow = [{ text: `[${selectedLabel}]`, callback_data: "noop" }];
              const newKeyboard = [...urlButtons, confirmRow];
              await editMessageReplyMarkup(cbqChatId, cbq.message.message_id, { inline_keyboard: newKeyboard });
            }
          } else {
            await answerCallbackQuery(cbq.id);
          }
        } else if (data.startsWith("reddit_post_")) {
          const responseId = parseInt(data.replace("reddit_post_", ""));
          if (!isNaN(responseId)) {
            const pending = pendingRedditPosts.get(responseId);
            if (!pending || (Date.now() - pending.timestamp) > REDDIT_POST_TTL) {
              pendingRedditPosts.delete(responseId);
              await answerCallbackQuery(cbq.id, "This post link has expired. Trigger a new analysis.");
              return;
            }

            await answerCallbackQuery(cbq.id, "Posting to Reddit...");
            const result = await postRedditComment(pending.postUrl, pending.responseText);
            pendingRedditPosts.delete(responseId);

            if (result.success) {
              await db.insert(responseFeedback).values({ responseId, feedback: "positive" }).catch(() => {});
              await db.update(aiResponses).set({ status: "approved", approvedAt: new Date() }).where(eq(aiResponses.id, responseId)).catch(() => {});

              let confirmMsg = "Posted to Reddit!";
              if (result.commentUrl) {
                confirmMsg += `\n\n<a href="${result.commentUrl}">View your comment</a>`;
              }
              await sendTelegramMessage(confirmMsg);

              if (cbq.message?.message_id && cbqChatId) {
                const existingButtons = cbq.message?.reply_markup?.inline_keyboard || [];
                const urlButtons = existingButtons.filter((row: any[]) => row.some((b: any) => b.url));
                const newKeyboard = [...urlButtons, [{ text: "[Posted to Reddit]", callback_data: "noop" }]];
                await editMessageReplyMarkup(cbqChatId, cbq.message.message_id, { inline_keyboard: newKeyboard });
              }
            } else {
              await sendTelegramMessage(`Failed to post: ${result.error}`);
            }
          } else {
            await answerCallbackQuery(cbq.id);
          }
        } else if (data === "noop") {
          await answerCallbackQuery(cbq.id, "Feedback already recorded.");
        } else {
          await answerCallbackQuery(cbq.id);
        }
        return;
      }

      const message = update?.message;
      if (!message) return;

      const chatId = String(message.chat.id);
      const messageText = (message.text || "").trim();

      if (messageText === "/start setup" || messageText === "/setup") {
        clientWizards.set(chatId, { step: "name", chatId });
        await sendTelegramMessageToChat(chatId,
          `<b>Welcome to Gemin-Eye!</b>\n\n` +
          `I'm going to set up your business monitor in 4 quick steps.\n\n` +
          `<b>Step 1:</b> What is the name of your business?\n<i>(e.g., Mario's Tacos)</i>`
        );
        return;
      }

      const wizardHandled = await handleClientWizard(chatId, messageText);
      if (wizardHandled) return;

      if (!ALLOWED_CHAT_ID) {
        console.warn("TELEGRAM_CHAT_ID not set, ignoring incoming message");
        return;
      }
      if (chatId !== ALLOWED_CHAT_ID) return;

      if (message.photo && message.photo.length > 0) {
        pendingContextRequests.delete(chatId);
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

        if (result.needsGroupContext) {
          pendingContextRequests.set(chatId, {
            postText: extracted.text,
            postUrl: postUrl || null,
            platform: extracted.platform,
            timestamp: Date.now(),
          });
          await sendTelegramMessage(
            `I can see the post, but I'm not sure which group it's from. This helps me pick the right business.\n\n<b>Which group/subreddit is this from?</b>\n<i>(e.g., "Chicago Foodies" or "r/mentalhealth")</i>\n\nOr type <b>skip</b> to analyze without group context.`
          );
          return;
        }

        await sendResultWithButtons(result);
        return;
      }

      if (!message.text) return;

      const text = message.text.trim();

      if (text === "/start") {
        pendingContextRequests.delete(chatId);
        await sendTelegramMessage(
          `<b>Welcome to Gemin-Eye Bot!</b>\n\nI help you find and respond to leads across social media.\n\n<b>Send me a post:</b>\n- Paste text + URL\n- Or just screenshot the post!\n\n<b>I'll automatically:</b>\n1. Match it to your businesses\n2. Score the lead intent\n3. Craft a human-sounding response\n4. Let you rate the response or post it directly\n\n<b>Reddit Commander:</b>\n/post r/subreddit Title | Body text\n\n<b>Managing Clients:</b>\n/newclient - Add a new business\n/removeclient - Remove a business\n/keywords - Update keywords for a business\n/groups - Update target groups\n/businesses - List all businesses\n\n<b>Google Alerts (Web-Wide Monitoring):</b>\n/addalert - Add a Google Alert RSS feed\n/alerts - View all alert feeds\n/removealert - Remove an alert feed\n\n<b>Quick tip:</b> Include the post URL and I'll add an "Open Post" button. For Reddit leads, tap "Post to Reddit" to comment directly!`
        );
        return;
      }

      if (text === "/help") {
        pendingContextRequests.delete(chatId);
        await sendTelegramMessage(
          `<b>Gemin-Eye Bot - Full Guide</b>\n\n<b>Analyzing Posts:</b>\n\n<b>Option 1 - Text:</b>\nPaste the URL + post text:\n<code>https://reddit.com/r/chicago/comments/abc123\nLooking for a good pizza place near Brookfield</code>\n\n<b>Option 2 - Screenshot:</b>\nJust screenshot the post on your phone and send the image here. I'll read it automatically!\n\nYou can add the URL as a caption on the photo for the "Open Post" button.\n\n<b>Feedback:</b>\nEvery AI response comes with buttons:\n- <b>Used It</b> - You posted the response (helps me learn what works)\n- <b>Bad Match</b> - The post wasn't relevant to that business\n- <b>Too Salesy</b> - The response sounded too much like an ad\n- <b>Wrong Client</b> - Matched to the wrong business\n\n<b>Context:</b>\nIf I can't tell which group a post is from, I'll ask you. This helps me pick the right business and write a better response.\n\n<b>Managing Clients:</b>\n/newclient - Step-by-step new business setup\n/removeclient - Remove a business and all its data\n/keywords - Update search keywords\n/groups - Update target groups/subreddits\n/businesses - See all your businesses\n\n<b>Google Alerts (Web-Wide Monitoring):</b>\n/addalert - Add a Google Alert RSS feed\n/alerts - View all alert feeds\n/removealert - Remove an alert feed`
        );
        return;
      }

      if (text === "/businesses") {
        pendingContextRequests.delete(chatId);
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

      const pendingContext = pendingContextRequests.get(chatId);
      const CONTEXT_TTL = 5 * 60 * 1000;
      if (pendingContext && (Date.now() - pendingContext.timestamp) >= CONTEXT_TTL) {
        pendingContextRequests.delete(chatId);
      }
      if (pendingContext && !text.startsWith("/") && (Date.now() - pendingContext.timestamp) < CONTEXT_TTL) {
        pendingContextRequests.delete(chatId);

        const groupName = text.toLowerCase() === "skip" ? undefined : text.trim();

        await sendTelegramMessage(groupName ? `Got it - analyzing for <b>${escapeHtml(groupName)}</b>...` : "Analyzing without group context...");

        const result = await handlePost(pendingContext.postText, groupName, pendingContext.postUrl, pendingContext.platform);
        await sendResultWithButtons(result);
        return;
      }

      if (text.startsWith("/")) {
        pendingContextRequests.delete(chatId);
      }

      const handled = await handleAdminCommand(chatId, text);
      if (handled) return;

      if (text.startsWith("/")) return;

      pendingContextRequests.delete(chatId);
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

      if (result.needsGroupContext) {
        pendingContextRequests.set(chatId, {
          postText,
          postUrl: postUrl || null,
          platform: result.platform,
          timestamp: Date.now(),
        });
        await sendTelegramMessage(
          `I can see the post, but I'm not sure which group it's from. This helps me pick the right business.\n\n<b>Which group/subreddit is this from?</b>\n<i>(e.g., "Chicago Foodies" or "r/mentalhealth")</i>\n\nOr type <b>skip</b> to analyze without group context.`
        );
        return;
      }

      await sendResultWithButtons(result);
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
