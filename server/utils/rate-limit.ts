import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { rateLimitBuckets } from "@shared/schema";
import { and, eq, gt, lt, sql } from "drizzle-orm";

setInterval(async () => {
  try {
    await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.resetAt, new Date()));
  } catch {}
}, 5 * 60 * 1000);

export function createRateLimiter(options: {
  name: string;
  maxRequests: number;
  windowMs: number;
  keyFn?: (req: Request) => string;
}) {
  const { name, maxRequests, windowMs } = options;
  const keyFn = options.keyFn || ((req: Request) => req.ip || "unknown");

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = new Date();

    try {
      const existing = await db
        .select()
        .from(rateLimitBuckets)
        .where(
          and(
            eq(rateLimitBuckets.limiterName, name),
            eq(rateLimitBuckets.key, key),
            gt(rateLimitBuckets.resetAt, now),
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const bucket = existing[0];
        if (bucket.count >= maxRequests) {
          res.status(429).json({ error: "Too many requests. Please try again later." });
          return;
        }
        await db
          .update(rateLimitBuckets)
          .set({ count: sql`${rateLimitBuckets.count} + 1` })
          .where(eq(rateLimitBuckets.id, bucket.id));
      } else {
        const resetAt = new Date(now.getTime() + windowMs);
        await db
          .insert(rateLimitBuckets)
          .values({ limiterName: name, key, count: 1, resetAt })
          .onConflictDoUpdate({
            target: [rateLimitBuckets.limiterName, rateLimitBuckets.key],
            set: { count: sql`1`, resetAt },
          });
      }

      next();
    } catch (err) {
      console.error("Rate limiter DB error, allowing request:", err);
      next();
    }
  };
}
