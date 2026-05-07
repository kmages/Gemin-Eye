import { escapeHtml, truncate } from "./utils/html";

const TELEGRAM_API = "https://api.telegram.org/bot";

function getBotToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN;
}

function getChatId(): string | undefined {
  return process.env.TELEGRAM_CHAT_ID;
}

export interface InlineButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface TelegramMessageOptions {
  buttons?: InlineButton[][];
  disable_web_page_preview?: boolean;
  reply_to_message_id?: number;
}

export async function sendTelegramMessageToChat(
  chatId: string,
  text: string,
  options?: TelegramMessageOptions
): Promise<boolean> {
  const token = getBotToken();

  if (!token) {
    console.warn("Telegram not configured: missing TELEGRAM_BOT_TOKEN");
    return false;
  }

  try {
    const body: Record<string, any> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: options?.disable_web_page_preview !== false,
    };

    if (options?.buttons && options.buttons.length > 0) {
      body.reply_markup = {
        inline_keyboard: options.buttons,
      };
    }

    if (options?.reply_to_message_id) {
      body.reply_to_message_id = options.reply_to_message_id;
      body.allow_sending_without_reply = true;
    }

    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Telegram API error:", err);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Telegram send error:", error);
    return false;
  }
}

export async function sendTelegramMessage(
  text: string,
  options?: TelegramMessageOptions
): Promise<boolean> {
  const chatId = getChatId();

  if (!chatId) {
    console.warn("Telegram not configured: missing TELEGRAM_CHAT_ID");
    return false;
  }

  return sendTelegramMessageToChat(chatId, text, options);
}

export function formatLeadNotification(lead: {
  authorName: string;
  groupName: string;
  platform: string;
  originalPost: string;
  intentScore: number;
}, businessName: string, aiResponse?: string): string {
  const scoreBar = "★".repeat(lead.intentScore) + "☆".repeat(10 - lead.intentScore);
  const postSnippet = truncate(lead.originalPost, 400);

  let msg = `<b>🔔 ${escapeHtml(lead.platform)} Lead</b>\n\n`;
  msg += `<b>Business:</b> ${escapeHtml(businessName)}\n`;
  msg += `<b>Group:</b> ${escapeHtml(lead.groupName)}\n`;
  msg += `<b>Author:</b> ${escapeHtml(lead.authorName)}\n`;
  msg += `<b>Intent:</b> ${scoreBar} ${lead.intentScore}/10\n\n`;
  msg += `<b>📰 Post:</b>\n<i>"${escapeHtml(postSnippet)}"</i>\n`;

  if (aiResponse) {
    msg += `\n<b>💬 Suggested Response:</b>\n<code>${escapeHtml(aiResponse)}</code>`;
  }

  return msg;
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<boolean> {
  const token = getBotToken();
  if (!token) return false;

  try {
    const body: Record<string, any> = { callback_query_id: callbackQueryId };
    if (text) body.text = text;

    const res = await fetch(`${TELEGRAM_API}${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (error) {
    console.error("Telegram answerCallbackQuery error:", error);
    return false;
  }
}

export async function editMessageReplyMarkup(
  chatId: string,
  messageId: number,
  replyMarkup?: { inline_keyboard: InlineButton[][] }
): Promise<boolean> {
  const token = getBotToken();
  if (!token) return false;

  try {
    const body: Record<string, any> = {
      chat_id: chatId,
      message_id: messageId,
    };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    } else {
      body.reply_markup = { inline_keyboard: [] };
    }

    const res = await fetch(`${TELEGRAM_API}${token}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (error) {
    console.error("Telegram editMessageReplyMarkup error:", error);
    return false;
  }
}

