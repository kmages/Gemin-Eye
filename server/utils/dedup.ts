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

const MAX_RESPONSE_FINGERPRINTS = 500;
const responseFingerprints: Set<string> = new Set();

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

export function markOwnResponse(responseText: string): void {
  const chunks = extractChunks(responseText);
  for (const chunk of chunks) {
    responseFingerprints.add(chunk);
    if (responseFingerprints.size > MAX_RESPONSE_FINGERPRINTS) {
      const first = responseFingerprints.values().next().value;
      if (first) responseFingerprints.delete(first);
    }
  }
}

export function isOwnResponse(postText: string): boolean {
  if (responseFingerprints.size === 0) return false;
  const chunks = extractChunks(postText);
  let matchCount = 0;
  for (const chunk of chunks) {
    if (responseFingerprints.has(chunk)) matchCount++;
  }
  return matchCount >= 2;
}
