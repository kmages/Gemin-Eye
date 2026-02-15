import { sendTelegramMessage, sendTelegramMessageToChat, type TelegramMessageOptions } from "./telegram";
import { isRedditConfigured } from "./reddit-poster";
import { escapeHtml } from "./utils/html";
import { createRateLimiter } from "./utils/rate-limit";
import { storage } from "./storage";
import type { Business } from "@shared/schema";
import {
  handlePost, extractPostUrl, stripUrls, downloadTelegramPhotoWithMime, extractTextFromImage,
  getAllBusinessesWithCampaigns, type PostAnalysis,
} from "./telegram/analysis";
import { handleClientWizard } from "./telegram/client-wizard";
import { handleAdminCommand } from "./telegram/admin-commands";
import { handleCallbackQuery } from "./telegram/callbacks";
import { pendingContextRequests, pendingRedditPosts, clientWizards, CONTEXT_TTL } from "./telegram/state";

export { generateScanToken, generateBookmarkletCode, generateLinkedInBookmarkletCode } from "./telegram/bookmarklets";

const webhookRateLimit = createRateLimiter({
  name: "telegram-webhook",
  maxRequests: 60,
  windowMs: 60 * 1000,
  keyFn: (req) => req.ip || "unknown",
});

const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendResultWithButtons(result: PostAnalysis, chatId?: string) {
  const send = chatId
    ? (text: string, opts?: TelegramMessageOptions) => sendTelegramMessageToChat(chatId, text, opts)
    : (text: string, opts?: TelegramMessageOptions) => sendTelegramMessage(text, opts);

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

export function registerTelegramWebhook(app: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set, skipping bot webhook setup");
    return;
  }

  app.post(`/api/telegram/webhook/${token}`, webhookRateLimit, async (req: any, res: any) => {
    try {
      res.sendStatus(200);

      const update = req.body;

      if (update?.callback_query) {
        await handleCallbackQuery(update.callback_query);
        return;
      }

      const message = update?.message;
      if (!message) return;

      const chatId = String(message.chat.id);
      const messageText = (message.text || "").trim();

      if (messageText === "/start setup" || messageText === "/setup") {
        clientWizards.set(chatId, { step: "name", chatId, timestamp: Date.now() });
        await sendTelegramMessageToChat(chatId,
          `<b>Welcome to Gemin-Eye!</b>\n\n` +
          `I'm going to set up your business monitor in 5 quick steps.\n\n` +
          `<b>Step 1:</b> What is the name of your business?\n<i>(e.g., Mario's Tacos)</i>`
        );
        return;
      }

      const wizardHandled = await handleClientWizard(chatId, messageText);
      if (wizardHandled) return;

      const isAdmin = ALLOWED_CHAT_ID && chatId === ALLOWED_CHAT_ID;

      if (messageText === "/start") {
        if (isAdmin) {
          pendingContextRequests.delete(chatId);
          await sendTelegramMessage(
            `<b>Welcome to Gemin-Eye Bot!</b>\n\nI help you find and respond to leads across social media.\n\n<b>Send me a post:</b>\n- Paste text + URL\n- Or just screenshot the post!\n\n<b>I'll automatically:</b>\n1. Match it to your businesses\n2. Score the lead intent\n3. Craft a human-sounding response\n4. Let you rate the response or post it directly\n\n<b>Reddit Commander:</b>\n/post r/subreddit Title | Body text\n\n<b>Managing Clients:</b>\n/newclient - Add a new business\n/removeclient - Remove a business\n/keywords - Update keywords for a business\n/groups - Update target groups\n/businesses - List all businesses\n\n<b>Google Alerts (Web-Wide Monitoring):</b>\n/addalert - Add a Google Alert RSS feed\n/alerts - View all alert feeds\n/removealert - Remove an alert feed\n\n<b>Quick tip:</b> Include the post URL and I'll add an "Open Post" button. For Reddit leads, tap "Post to Reddit" to comment directly!`
          );
        } else {
          const existingBiz: Business[] = await storage.getBusinessesByUser(`tg-${chatId}`);
          if (existingBiz.length > 0) {
            const bizNames = existingBiz.map(b => `- <b>${escapeHtml(b.name)}</b>`).join("\n");
            await sendTelegramMessageToChat(chatId,
              `<b>Welcome back!</b>\n\n` +
              `Your businesses:\n${bizNames}\n\n` +
              `<b>What you can do:</b>\n` +
              `- Send me a post URL + text to analyze\n` +
              `- Screenshot a post and send the image\n` +
              `- Use your bookmarklets to scan Facebook/LinkedIn groups\n\n` +
              `<b>Commands:</b>\n` +
              `/setup - Add another business\n` +
              `/help - Full usage guide`
            );
          } else {
            clientWizards.set(chatId, { step: "name", chatId, timestamp: Date.now() });
            await sendTelegramMessageToChat(chatId,
              `<b>Welcome to Gemin-Eye!</b>\n\n` +
              `I help businesses find customers by monitoring social media for people asking about what you offer.\n\n` +
              `Let's get you set up! I just need a few details about your business.\n\n` +
              `<b>Step 1:</b> What is the name of your business?\n<i>(e.g., Mario's Tacos)</i>`
            );
          }
        }
        return;
      }

      if (messageText === "/help" && !isAdmin) {
        await sendTelegramMessageToChat(chatId,
          `<b>Gemin-Eye - Your Lead Finder</b>\n\n` +
          `<b>How it works:</b>\n` +
          `- I automatically scan Reddit for posts matching your keywords\n` +
          `- When I find a lead, I'll message you with an AI-written response\n` +
          `- Use your bookmarklets to manually scan Facebook/LinkedIn groups\n\n` +
          `<b>Manual scanning:</b>\n` +
          `- Send me any post text + URL and I'll analyze it\n` +
          `- Or screenshot a post and send the image\n\n` +
          `<b>Commands:</b>\n` +
          `/setup - Add a new business\n` +
          `/help - This guide`
        );
        return;
      }

      const isClient = !isAdmin && (await storage.getBusinessesByUser(`tg-${chatId}`)).length > 0;
      const isAuthorized = isAdmin || isClient;

      if (!isAuthorized) {
        if (messageText && !messageText.startsWith("/")) {
          await sendTelegramMessageToChat(chatId,
            `You don't have a business set up yet. Send /start to get started!`
          );
        }
        return;
      }

      const send = isAdmin
        ? (text: string, opts?: TelegramMessageOptions) => sendTelegramMessage(text, opts)
        : (text: string, opts?: TelegramMessageOptions) => sendTelegramMessageToChat(chatId, text, opts);

      if (message.photo && message.photo.length > 0) {
        pendingContextRequests.delete(chatId);
        await send("Reading screenshot...");

        const largestPhoto = message.photo[message.photo.length - 1];
        const photoData = await downloadTelegramPhotoWithMime(largestPhoto.file_id);

        if (!photoData) {
          await send("Couldn't download that image. Please try again.");
          return;
        }

        const extracted = await extractTextFromImage(photoData.buffer, photoData.mimeType);
        if (!extracted || extracted.text.length < 5) {
          await send("Couldn't read any text from that screenshot. Make sure the post text is clearly visible and try again.");
          return;
        }

        const caption = message.caption || "";
        const captionUrl = extractPostUrl(caption);
        const postUrl = captionUrl || extracted.postUrl;
        const groupName = extracted.groupName || undefined;

        await send(`Read from screenshot. Analyzing...\n\n<i>"${escapeHtml(extracted.text.length > 150 ? extracted.text.slice(0, 150) + "..." : extracted.text)}"</i>`);

        const result = await handlePost(extracted.text, groupName, postUrl, extracted.platform);

        if (result.needsGroupContext) {
          pendingContextRequests.set(chatId, {
            postText: extracted.text,
            postUrl: postUrl || null,
            platform: extracted.platform,
            timestamp: Date.now(),
          });
          await send(
            `I can see the post, but I'm not sure which group it's from. This helps me pick the right business.\n\n<b>Which group/subreddit is this from?</b>\n<i>(e.g., "Chicago Foodies" or "r/mentalhealth")</i>\n\nOr type <b>skip</b> to analyze without group context.`
          );
          return;
        }

        await sendResultWithButtons(result, isClient ? chatId : undefined);
        return;
      }

      if (!message.text) return;

      const text = message.text.trim();

      if (text === "/businesses" && isAdmin) {
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
      if (pendingContext && (Date.now() - pendingContext.timestamp) >= CONTEXT_TTL) {
        pendingContextRequests.delete(chatId);
      }
      if (pendingContext && !text.startsWith("/") && (Date.now() - pendingContext.timestamp) < CONTEXT_TTL) {
        pendingContextRequests.delete(chatId);

        const groupName = text.toLowerCase() === "skip" ? undefined : text.trim();

        await send(groupName ? `Got it - analyzing for <b>${escapeHtml(groupName)}</b>...` : "Analyzing without group context...");

        const result = await handlePost(pendingContext.postText, groupName, pendingContext.postUrl, pendingContext.platform);
        await sendResultWithButtons(result, isClient ? chatId : undefined);
        return;
      }

      if (text.startsWith("/")) {
        pendingContextRequests.delete(chatId);
      }

      if (isAdmin) {
        const handled = await handleAdminCommand(chatId, text);
        if (handled) return;
      }

      if (text.startsWith("/")) {
        if (isClient) {
          await sendTelegramMessageToChat(chatId,
            `That command isn't available. You can:\n- Send me a post URL + text to analyze\n- Screenshot a post and send the image\n- /setup to add another business\n- /help for more info`
          );
        }
        return;
      }

      pendingContextRequests.delete(chatId);
      await send("Analyzing post...");

      const postUrl = extractPostUrl(text);
      let postText = postUrl ? stripUrls(text) : text;

      let groupName: string | undefined;
      const colonMatch = postText.match(/^([^:]{3,50}):\s+([\s\S]+)/);
      if (colonMatch) {
        groupName = colonMatch[1].trim();
        postText = colonMatch[2].trim();
      }

      if (!postText || postText.length < 5) {
        await send(
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
        await send(
          `I can see the post, but I'm not sure which group it's from. This helps me pick the right business.\n\n<b>Which group/subreddit is this from?</b>\n<i>(e.g., "Chicago Foodies" or "r/mentalhealth")</i>\n\nOr type <b>skip</b> to analyze without group context.`
        );
        return;
      }

      await sendResultWithButtons(result, isClient ? chatId : undefined);
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
