import type Stripe from "stripe";
import { getUncachableStripeClient, isStripeConnected } from "../stripeClient";
import { storage } from "../storage";

export type Tier = "starter" | "pro" | null;

interface CacheEntry {
  tier: Tier;
  exp: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * Returns the active subscription tier for a user, or null if none.
 * Cached for 60 seconds to avoid hammering Stripe on each monitor tick.
 *
 * Tier is read from the product's metadata.tier field, set by the seed script.
 */
export async function getUserTier(userId: string): Promise<Tier> {
  const cached = cache.get(userId);
  if (cached && cached.exp > Date.now()) return cached.tier;

  const result = await fetchTierFromStripe(userId);
  cache.set(userId, { tier: result, exp: Date.now() + CACHE_TTL_MS });
  return result;
}

async function fetchTierFromStripe(userId: string): Promise<Tier> {
  // If Stripe isn't connected yet, fail open in dev to keep the platform usable.
  if (!(await isStripeConnected())) {
    return process.env.NODE_ENV === "production" ? null : "pro";
  }

  const user = await storage.getUserById(userId);
  if (!user?.stripeCustomerId) return null;

  try {
    const stripe = await getUncachableStripeClient();
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      limit: 5,
      expand: ["data.items.data.price.product"],
    });

    const active = subs.data.find(
      (s) => s.status === "active" || s.status === "trialing",
    );
    if (!active) return null;

    const item = active.items.data[0];
    const product = item?.price?.product as Stripe.Product | undefined;
    const tier = (product?.metadata?.tier as Tier) || null;
    return tier;
  } catch (err) {
    console.error("getUserTier error:", err);
    return null;
  }
}

export async function hasActiveSubscription(userId: string): Promise<boolean> {
  return (await getUserTier(userId)) !== null;
}

export async function hasProTier(userId: string): Promise<boolean> {
  return (await getUserTier(userId)) === "pro";
}

export function invalidateTierCache(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}
