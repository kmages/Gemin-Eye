import type { Request, Response, NextFunction } from "express";

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Map<string, RateLimitBucket>>();

setInterval(() => {
  const now = Date.now();
  buckets.forEach((limiterMap) => {
    limiterMap.forEach((bucket, key) => {
      if (now > bucket.resetAt) limiterMap.delete(key);
    });
  });
}, 60 * 1000);

export function createRateLimiter(options: {
  name: string;
  maxRequests: number;
  windowMs: number;
  keyFn?: (req: Request) => string;
}) {
  const { name, maxRequests, windowMs } = options;
  const keyFn = options.keyFn || ((req: Request) => req.ip || "unknown");

  if (!buckets.has(name)) {
    buckets.set(name, new Map());
  }
  const limiterMap = buckets.get(name)!;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = Date.now();
    const bucket = limiterMap.get(key);

    if (bucket && now < bucket.resetAt) {
      if (bucket.count >= maxRequests) {
        res.status(429).json({ error: "Too many requests. Please try again later." });
        return;
      }
      bucket.count++;
    } else {
      limiterMap.set(key, { count: 1, resetAt: now + windowMs });
    }

    next();
  };
}
