import { db } from "../db";
import { businesses, campaigns, leads, aiResponses } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendTelegramMessage } from "../telegram";
import { storage } from "../storage";
import { generateContent, safeParseJsonFromAI } from "../utils/ai";
import { escapeHtml } from "../utils/html";
import { buildGoogleAlertFeeds } from "../utils/keywords";
import { postRedditSubmission, isRedditConfigured } from "../reddit-poster";
import { pendingClientSetups, type AdminSetupState } from "./state";
import { getAllBusinessesWithCampaigns } from "./analysis";

export async function handleAdminCommand(chatId: string, text: string): Promise<boolean> {
  const pending = pendingClientSetups.get(chatId);

  if (pending && !text.startsWith("/")) {
    return await handleClientSetupFlow(chatId, text, pending);
  }

  if (pending && text.startsWith("/")) {
    pendingClientSetups.delete(chatId);
  }

  if (text === "/newclient") {
    pendingClientSetups.set(chatId, { step: "name", timestamp: Date.now() });
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

    pendingClientSetups.set(chatId, { step: "remove_select", timestamp: Date.now() });
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

    pendingClientSetups.set(chatId, { step: "keywords_select", timestamp: Date.now() });
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

    pendingClientSetups.set(chatId, { step: "groups_select", timestamp: Date.now() });
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

    pendingClientSetups.set(chatId, { step: "alert_select", timestamp: Date.now() });
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

    pendingClientSetups.set(chatId, { step: "alert_remove", timestamp: Date.now(), groups: feedIndex.map(fi => `${fi.campaignId}::${fi.feedUrl}`) });
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

export async function handleClientSetupFlow(chatId: string, text: string, pending: AdminSetupState): Promise<boolean> {
  if (text === "/cancel") {
    pendingClientSetups.delete(chatId);
    await sendTelegramMessage("Client setup cancelled.");
    return true;
  }

  pending.timestamp = Date.now();

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
        const groupResult = await generateContent({
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
        const groupJson = safeParseJsonFromAI(groupResult.text) as Record<string, any>;
        if (groupJson) {
          aiGroups = [
            ...((groupJson.subreddits as string[]) || []),
            ...((groupJson.facebook_groups as string[]) || []),
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

      const gaFeeds = buildGoogleAlertFeeds(pending.keywords || [], pending.type!);
      if (gaFeeds.length > 0) {
        await storage.createCampaign({
          businessId: biz.id,
          name: `${pending.name} - Google Alerts`,
          platform: "google_alerts",
          status: "active",
          strategy: `Monitor Google News for ${pending.type} discussions`,
          targetGroups: gaFeeds,
          keywords: (pending.keywords || []).slice(0, 15),
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
