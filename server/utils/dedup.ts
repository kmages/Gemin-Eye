import { db } from "../db";
import { seenItems } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function hasBeenSeen(dedupKey: string): Promise<boolean> {
  const existing = await db.select({ id: seenItems.id }).from(seenItems).where(eq(seenItems.dedupKey, dedupKey)).limit(1);
  return existing.length > 0;
}

export async function markSeen(dedupKey: string, source: string): Promise<void> {
  try {
    await db.insert(seenItems).values({ dedupKey, source }).onConflictDoNothing();
  } catch {}
}
