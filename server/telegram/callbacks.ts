import { db } from "../db";
import { aiResponses, responseFeedback } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendTelegramMessage, answerCallbackQuery, editMessageReplyMarkup } from "../telegram";
import { postRedditComment, isRedditConfigured } from "../reddit-poster";
import { pendingRedditPosts, REDDIT_POST_TTL } from "./state";

export async function handleCallbackQuery(cbq: any): Promise<void> {
  const data = cbq.data as string;
  const cbqChatId = String(cbq.message?.chat?.id || "");

  if (data.startsWith("fb_") || data.startsWith("li_")) {
    await handleFeedbackCallback(cbq, data, cbqChatId);
  } else if (data.startsWith("reddit_post_")) {
    await handleRedditPostCallback(cbq, data, cbqChatId);
  } else if (data === "noop") {
    await answerCallbackQuery(cbq.id, "Feedback already recorded.");
  } else {
    await answerCallbackQuery(cbq.id);
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
