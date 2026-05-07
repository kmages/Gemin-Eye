import { db } from "./db";
import { businesses } from "@shared/schema";
import { sendTelegramMessageToChat } from "./telegram";
import { hasBeenSeen, markSeen } from "./utils/dedup";
import { getAppBaseUrl } from "./telegram/bookmarklets";

const REMINDER_HOUR_UTC = 14;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const REMINDER_SOURCE = "daily_reminder";

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

    const today = todayKey();

    for (const biz of eligible) {
      const dedupKey = `${REMINDER_SOURCE}:${biz.id}:${today}`;
      if (await hasBeenSeen(dedupKey)) continue;

      let msg = `<b>👀 Daily Spy Glass Reminder</b>\n\n`;
      msg += `Time to scan <b>Facebook</b> and <b>LinkedIn</b> for <b>${escapeHtml(biz.name)}</b>.\n\n`;
      msg += `<b>How:</b>\n`;
      msg += `1. Open Facebook and/or LinkedIn in your browser\n`;
      msg += `2. Scroll your feed/groups for a minute\n`;
      msg += `3. Click your <b>Gemin-Eye</b> bookmark\n\n`;
      msg += `Any high-intent posts will appear right here in Telegram.`;

      const buttons = [
        [
          { text: "Open Facebook", url: "https://facebook.com" },
          { text: "Open LinkedIn", url: "https://linkedin.com" },
        ],
        [
          { text: "Open Dashboard", url: `${getAppBaseUrl()}/dashboard` },
        ],
      ];

      try {
        await sendTelegramMessageToChat(biz.telegramChatId!, msg, { buttons });
        await markSeen(dedupKey, REMINDER_SOURCE);
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
