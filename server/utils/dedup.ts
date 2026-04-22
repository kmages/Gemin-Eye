import { db } from "../db";
import { seenItems } from "@shared/schema";
import { eq, inArray, lt, and, ne } from "drizzle-orm";

const THIRTY_DAYS_MS  = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS  = 90 * 24 * 60 * 60 * 1000;

export async function pruneSeenItems(): Promise<void> {
  const now = Date.now();
  const thirtyDaysAgo = new Date(now - THIRTY_DAYS_MS);
  const ninetyDaysAgo  = new Date(now - NINETY_DAYS_MS);

  try {
    const regularResult = await db
      .delete(seenItems)
      .where(
        and(
          ne(seenItems.source, "own_response"),
          lt(seenItems.createdAt, thirtyDaysAgo),
        ),
      );

    const responseResult = await db
      .delete(seenItems)
      .where(
        and(
          eq(seenItems.source, "own_response"),
          lt(seenItems.createdAt, ninetyDaysAgo),
        ),
      );

    console.log(
      `seen_items pruned: ${(regularResult as any).rowCount ?? 0} post keys (>30d), ` +
      `${(responseResult as any).rowCount ?? 0} response fingerprints (>90d)`,
    );
  } catch (err) {
    console.error("seen_items pruning failed:", err);
  }
}

export function startSeenItemsPruner(): void {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  pruneSeenItems();
  setInterval(pruneSeenItems, TWENTY_FOUR_HOURS);
  console.log("seen_items pruner: scheduled (runs every 24 hours)");
}

export async function hasBeenSeen(dedupKey: string): Promise<boolean> {
  const existing = await db.select({ id: seenItems.id }).from(seenItems).where(eq(seenItems.dedupKey, dedupKey)).limit(1);
  return existing.length > 0;
}

export async function markSeen(dedupKey: string, source: string): Promise<void> {
  try {
    await db.insert(seenItems).values({ dedupKey, source }).onConflictDoNothing();
  } catch {}
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function extractChunks(text: string, chunkLen: number = 40): string[] {
  const norm = normalize(text);
  const words = norm.split(" ");
  const chunks: string[] = [];
  for (let i = 0; i <= words.length - 5; i += 3) {
    chunks.push(words.slice(i, i + 5).join(" "));
  }
  if (norm.length >= chunkLen) {
    chunks.push(norm.slice(0, chunkLen));
    chunks.push(norm.slice(-chunkLen));
  }
  return chunks;
}

const RESPONSE_FINGERPRINT_SOURCE = "own_response";

export async function markOwnResponse(responseText: string): Promise<void> {
  const chunks = extractChunks(responseText);
  for (const chunk of chunks) {
    const key = `resp:${chunk}`;
    try {
      await db.insert(seenItems).values({ dedupKey: key, source: RESPONSE_FINGERPRINT_SOURCE }).onConflictDoNothing();
    } catch {}
  }
}

export async function isOwnResponse(postText: string): Promise<boolean> {
  const chunks = extractChunks(postText);
  if (chunks.length === 0) return false;

  const keys = chunks.map(c => `resp:${c}`);
  try {
    const matches = await db
      .select({ id: seenItems.id })
      .from(seenItems)
      .where(inArray(seenItems.dedupKey, keys));
    return matches.length >= 2;
  } catch {
    return false;
  }
}
