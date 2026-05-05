import { db } from "./db";
import { businesses, campaigns } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { sendTelegramMessageToChat } from "./telegram";

const REMINDER_HOUR_UTC = 14;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const lastSentByBusiness = new Map<number, string>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendDailyReminders(): Promise<void> {
  try {
    const allBiz = await db.select().from(businesses);
    const eligible = allBiz.filter((b) => !!b.telegramChatId);
    if (eligible.length === 0) return;

    const bizIds = eligible.map((b) => b.id);
    const allCamps = await db
      .select()
      .from(campaigns)
      .where(and(inArray(campaigns.businessId, bizIds), eq(campaigns.status, "active")));

    const today = todayKey();
    for (const biz of eligible) {
      if (lastSentByBusiness.get(biz.id) === today) continue;

      const bizCamps = allCamps.filter((c) => c.businessId === biz.id);
      const hasFacebook = bizCamps.some((c) => c.platform.toLowerCase() === "facebook");
      const hasLinkedIn = bizCamps.some((c) => c.platform.toLowerCase() === "linkedin");
      if (!hasFacebook && !hasLinkedIn) continue;

      const platformList: string[] = [];
      if (hasFacebook) platformList.push("Facebook");
      if (hasLinkedIn) platformList.push("LinkedIn");
      const platforms = platformList.join(" + ");

      let msg = `<b>👀 Daily Spy Glass Reminder</b>\n\n`;
      msg += `Time to scan <b>${platforms}</b> for <b>${escapeHtml(biz.name)}</b>.\n\n`;
      msg += `<b>How:</b>\n`;
      msg += `1. Open ${platforms} in your browser\n`;
      msg += `2. Scroll your feed/groups for a minute\n`;
      msg += `3. Click your <b>Gemin-Eye</b> bookmark\n\n`;
      msg += `Any high-intent posts will appear right here in Telegram.`;

      const buttons = [[
        { text: "Open Dashboard", url: "https://gemin-eye.com/dashboard" },
      ]];

      try {
        await sendTelegramMessageToChat(biz.telegramChatId!, msg, { buttons });
        lastSentByBusiness.set(biz.id, today);
        console.log(`Daily reminder sent for business ${biz.id} (${biz.name})`);
      } catch (err) {
        console.error(`Daily reminder failed for business ${biz.id}:`, err);
      }
    }
  } catch (err) {
    console.error("Daily reminders job error:", err);
  }
}

function tick(): void {
  const nowUtcHour = new Date().getUTCHours();
  if (nowUtcHour === REMINDER_HOUR_UTC) {
    sendDailyReminders().catch((e) => console.error("sendDailyReminders threw:", e));
  }
}

export function startDailyReminders(): void {
  console.log(`Daily Spy Glass reminders: scheduled (fires at ${REMINDER_HOUR_UTC}:00 UTC daily)`);
  tick();
  setInterval(tick, CHECK_INTERVAL_MS);
}
