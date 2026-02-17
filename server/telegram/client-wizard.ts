import { sendTelegramMessage, sendTelegramMessageToChat } from "../telegram";
import { storage } from "../storage";
import { generateContent, safeParseJsonFromAI } from "../utils/ai";
import { escapeHtml } from "../utils/html";
import { clientWizards, type ClientWizardState } from "./state";
import { generateScanToken, generateBookmarkletCode, generateLinkedInBookmarkletCode, getAppBaseUrl } from "./bookmarklets";

export async function handleClientWizard(chatId: string, text: string): Promise<boolean> {
  const wizard = clientWizards.get(chatId);
  if (!wizard) return false;

  if (text.startsWith("/")) {
    clientWizards.delete(chatId);
    return false;
  }

  wizard.timestamp = Date.now();

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
      wizard.step = "contact";
      await sendTelegramMessageToChat(chatId,
        `Got it.\n\nNow I need your contact info. Please send your <b>email</b>, <b>phone</b>, and <b>website</b> (one per line):\n\n<i>Example:\njoe@mybusiness.com\n(312) 555-1234\nhttps://mybusiness.com</i>\n\n(If no website, just send email and phone on two lines)`
      );
      return true;
    }

    case "contact": {
      const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length < 2) {
        await sendTelegramMessageToChat(chatId, "Please send at least your email and phone number, one per line.");
        return true;
      }
      const emailLine = lines.find(l => l.includes("@")) || lines[0];
      const phoneLine = lines.find(l => /[\d\(\)\-\+]/.test(l) && !l.includes("@") && !l.includes(".com") && !l.includes("http")) || lines[1];
      const websiteLine = lines.find(l => l.includes(".") && !l.includes("@") && l !== phoneLine) || "";

      wizard.contactEmail = emailLine;
      wizard.contactPhone = phoneLine;
      wizard.website = websiteLine;
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
        telegramChatId: chatId,
        name: wizard.name!,
        type: wizard.offering || wizard.name!,
        contactEmail: wizard.contactEmail || null,
        contactPhone: wizard.contactPhone || null,
        website: wizard.website || null,
        targetAudience: locationInfo,
        coreOffering: wizard.offering || wizard.name!,
        preferredTone: "casual",
      });

      let redditSubs: string[] = [];
      try {
        const groupResult = await generateContent({
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
        const groupJson = safeParseJsonFromAI(groupResult.text);
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
        `<b>Email:</b> ${escapeHtml(wizard.contactEmail || "N/A")}\n` +
        `<b>Phone:</b> ${escapeHtml(wizard.contactPhone || "N/A")}\n` +
        `<b>Website:</b> ${escapeHtml(wizard.website || "N/A")}\n` +
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
