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

export async function sendTelegramMessage(
  text: string,
  options?: { buttons?: InlineButton[][] }
): Promise<boolean> {
  const token = getBotToken();
  const chatId = getChatId();

  if (!token || !chatId) {
    console.warn("Telegram not configured: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return false;
  }

  try {
    const body: Record<string, any> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };

    if (options?.buttons && options.buttons.length > 0) {
      body.reply_markup = {
        inline_keyboard: options.buttons,
      };
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

export function formatLeadNotification(lead: {
  authorName: string;
  groupName: string;
  platform: string;
  originalPost: string;
  intentScore: number;
}, businessName: string, aiResponse?: string): string {
  const scoreBar = "█".repeat(lead.intentScore) + "░".repeat(10 - lead.intentScore);

  let msg = `<b>New Lead Found</b>\n`;
  msg += `<b>Business:</b> ${escapeHtml(businessName)}\n`;
  msg += `<b>Platform:</b> ${escapeHtml(lead.platform)} / ${escapeHtml(lead.groupName)}\n`;
  msg += `<b>Author:</b> ${escapeHtml(lead.authorName)}\n`;
  msg += `<b>Intent:</b> ${scoreBar} ${lead.intentScore}/10\n\n`;
  msg += `<b>Post:</b>\n<i>"${escapeHtml(lead.originalPost)}"</i>\n`;

  if (aiResponse) {
    msg += `\n<b>Suggested Response (copy & paste):</b>\n<code>${escapeHtml(aiResponse)}</code>`;
  }

  return msg;
}

export function formatResponseNotification(lead: {
  authorName: string;
  groupName: string;
  platform: string;
  originalPost: string;
}, businessName: string, aiResponse: string): string {
  let msg = `<b>AI Response Ready</b>\n`;
  msg += `<b>Business:</b> ${escapeHtml(businessName)}\n`;
  msg += `<b>For:</b> ${escapeHtml(lead.authorName)} in ${escapeHtml(lead.groupName)}\n\n`;
  msg += `<b>Original post:</b>\n<i>"${escapeHtml(truncate(lead.originalPost, 200))}"</i>\n\n`;
  msg += `<b>Copy & paste this response:</b>\n<code>${escapeHtml(aiResponse)}</code>`;

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}
