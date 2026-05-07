import { db } from "../db";
import { aiResponses, responseFeedback, businesses, leads } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendTelegramMessage, sendTelegramMessageToChat, answerCallbackQuery, editMessageReplyMarkup } from "../telegram";
import { postRedditComment, isRedditConfigured } from "../reddit-poster";
import { pendingRedditPosts, REDDIT_POST_TTL } from "./state";
import { escapeHtml } from "../utils/html";

const TONE_LABELS: Record<string, string> = {
  casual: "😊 Casual — Friendly & approachable",
  empathetic: "💛 Empathetic — Warm & supportive",
  professional: "💼 Professional — Authoritative & informative",
};

const TONE_SHORT: Record<string, string> = {
  casual: "Casual",
  empathetic: "Empathetic",
  professional: "Professional",
};

export async function handleCallbackQuery(cbq: any): Promise<void> {
  const data = cbq.data as string;
  const cbqChatId = String(cbq.message?.chat?.id || "");

  if (data.startsWith("fb_") || data.startsWith("li_")) {
    await handleFeedbackCallback(cbq, data, cbqChatId);
  } else if (data.startsWith("reddit_post_")) {
    await handleRedditPostCallback(cbq, data, cbqChatId);
  } else if (data.startsWith("tone_biz_")) {
    await handleToneBizCallback(cbq, data, cbqChatId);
  } else if (data.startsWith("tone_")) {
    await handleToneSetCallback(cbq, data, cbqChatId);
  } else if (data.startsWith("show_full_")) {
    await handleShowFullPostCallback(cbq, data, cbqChatId);
  } else if (data === "noop") {
    await answerCallbackQuery(cbq.id, "Feedback already recorded.");
  } else {
    await answerCallbackQuery(cbq.id);
  }
}

async function handleToneBizCallback(cbq: any, data: string, cbqChatId: string): Promise<void> {
  const bizId = parseInt(data.replace("tone_biz_", ""));
  if (isNaN(bizId)) { await answerCallbackQuery(cbq.id); return; }

  const rows = await db.select().from(businesses).where(eq(businesses.id, bizId)).limit(1);
  const biz = rows[0];
  if (!biz) { await answerCallbackQuery(cbq.id, "Business not found."); return; }

  await answerCallbackQuery(cbq.id);
  const current = biz.preferredTone || "empathetic";
  await sendTelegramMessageToChat(
    cbqChatId,
    `<b>Response Tone for ${escapeHtml(biz.name)}</b>\n\nCurrent: <b>${TONE_SHORT[current] || current}</b>\n\nChoose a new tone:`,
    {
      buttons: [[
        { text: "😊 Casual", callback_data: `tone_casual_${bizId}` },
        { text: "💛 Empathetic", callback_data: `tone_empathetic_${bizId}` },
        { text: "💼 Professional", callback_data: `tone_professional_${bizId}` },
      ]],
    }
  );
}

async function handleToneSetCallback(cbq: any, data: string, cbqChatId: string): Promise<void> {
  const parts = data.split("_");
  const tone = parts[1];
  const bizId = parseInt(parts[2]);

  if (!["casual", "empathetic", "professional"].includes(tone) || isNaN(bizId)) {
    await answerCallbackQuery(cbq.id);
    return;
  }

  try {
    await db.update(businesses).set({ preferredTone: tone }).where(eq(businesses.id, bizId));
  } catch (err) {
    console.error("Error updating tone:", err);
    await answerCallbackQuery(cbq.id, "Failed to update tone. Please try again.");
    return;
  }

  await answerCallbackQuery(cbq.id, `Tone set to ${TONE_SHORT[tone]}!`);

  if (cbq.message?.message_id && cbqChatId) {
    await editMessageReplyMarkup(cbqChatId, cbq.message.message_id, {
      inline_keyboard: [[{ text: `✓ ${TONE_LABELS[tone]}`, callback_data: "noop" }]],
    });
  }
}

async function handleFeedbackCallback(cbq: any, data: string, cbqChatId: string): Promise<void> {
  const parts = data.split("_");
  const feedbackType = parts[1];
  const responseId = parseInt(parts[2]);

  if (isNaN(responseId)) {
    await answerCallbackQuery(cbq.id);
    return;
  }

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
}

async function handleShowFullPostCallback(cbq: any, data: string, cbqChatId: string): Promise<void> {
  const leadId = parseInt(data.replace("show_full_", ""));
  if (isNaN(leadId) || !cbqChatId) {
    await answerCallbackQuery(cbq.id);
    return;
  }

  const rows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const lead = rows[0];
  if (!lead || !lead.originalPost) {
    await answerCallbackQuery(cbq.id, "Post content unavailable.");
    return;
  }

  await answerCallbackQuery(cbq.id);

  const TG_LIMIT = 3800; // leave headroom under Telegram's 4096 limit for HTML wrapper
  const fullText = lead.originalPost;
  const replyToId = cbq.message?.message_id;

  // Split into chunks if needed; preserve line breaks where possible.
  const chunks: string[] = [];
  let remaining = fullText;
  while (remaining.length > TG_LIMIT) {
    let cut = remaining.lastIndexOf("\n", TG_LIMIT);
    if (cut < TG_LIMIT * 0.5) cut = TG_LIMIT;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length) chunks.push(remaining);

  for (let i = 0; i < chunks.length; i++) {
    const header = i === 0 ? `<b>📄 Full Post</b>${chunks.length > 1 ? ` (1/${chunks.length})` : ""}\n\n` : `<b>📄 Full Post</b> (${i + 1}/${chunks.length})\n\n`;
    await sendTelegramMessageToChat(cbqChatId, header + escapeHtml(chunks[i]), {
      reply_to_message_id: i === 0 ? replyToId : undefined,
    });
  }

  // Disable the button so it can't be tapped again on this message.
  if (cbq.message?.message_id) {
    const existingButtons = cbq.message?.reply_markup?.inline_keyboard || [];
    const newKeyboard = existingButtons.map((row: any[]) =>
      row.map((b: any) =>
        b.callback_data === data ? { text: "✓ Full Post Sent", callback_data: "noop" } : b
      )
    );
    await editMessageReplyMarkup(cbqChatId, cbq.message.message_id, { inline_keyboard: newKeyboard });
  }
}

async function handleRedditPostCallback(cbq: any, data: string, cbqChatId: string): Promise<void> {
  const responseId = parseInt(data.replace("reddit_post_", ""));
  if (isNaN(responseId)) {
    await answerCallbackQuery(cbq.id);
    return;
  }

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
}
