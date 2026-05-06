import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated } from "../replit_integrations/auth";
import { getUncachableStripeClient, isStripeConnected } from "../stripeClient";
import { getUserTier, invalidateTierCache } from "../utils/subscription";

function getReturnBaseUrl(req: any): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.get("host");
  return `${proto}://${host}`;
}

export function registerBillingRoutes(app: Express) {
  // List products + prices for the pricing page
  app.get("/api/billing/products", async (_req, res) => {
    try {
      if (!(await isStripeConnected())) {
        return res.json({ data: [], stripeConnected: false });
      }

      const result = await db.execute(sql`
        SELECT
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.metadata as price_metadata
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY pr.unit_amount ASC NULLS LAST
      `);

      const productsMap = new Map<string, any>();
      for (const row of result.rows as any[]) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            metadata: row.product_metadata || {},
            prices: [],
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring,
            metadata: row.price_metadata || {},
          });
        }
      }

      res.json({ data: Array.from(productsMap.values()), stripeConnected: true });
    } catch (err: any) {
      console.error("billing/products error:", err);
      res.status(500).json({ error: "Failed to load products" });
    }
  });

  // Current user's subscription status + tier
  app.get("/api/billing/subscription", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUserById(userId);
      const tier = await getUserTier(userId);
      res.json({
        tier,
        stripeCustomerId: user?.stripeCustomerId || null,
        stripeSubscriptionId: user?.stripeSubscriptionId || null,
      });
    } catch (err: any) {
      console.error("billing/subscription error:", err);
      res.status(500).json({ error: "Failed to load subscription" });
    }
  });

  // Create a Stripe Checkout session for the chosen price
  app.post("/api/billing/checkout", isAuthenticated, async (req: any, res) => {
    try {
      const { priceId } = req.body || {};
      if (!priceId || typeof priceId !== "string") {
        return res.status(400).json({ error: "priceId required" });
      }
      if (!(await isStripeConnected())) {
        return res.status(503).json({ error: "Stripe is not connected yet" });
      }

      const userId = req.user.claims.sub;
      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      const stripe = await getUncachableStripeClient();

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { userId: user.id },
        });
        customerId = customer.id;
        await storage.updateUserStripeInfo(user.id, { stripeCustomerId: customerId });
      }

      const baseUrl = getReturnBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/billing?status=success`,
        cancel_url: `${baseUrl}/billing?status=cancelled`,
        allow_promotion_codes: true,
      });

      invalidateTierCache(userId);
      res.json({ url: session.url });
    } catch (err: any) {
      console.error("billing/checkout error:", err);
      res.status(500).json({ error: err.message || "Failed to create checkout" });
    }
  });

  // Stripe Billing Portal — for customers to manage / cancel their subscription
  app.post("/api/billing/portal", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isStripeConnected())) {
        return res.status(503).json({ error: "Stripe is not connected yet" });
      }

      const userId = req.user.claims.sub;
      const user = await storage.getUserById(userId);
      if (!user?.stripeCustomerId) {
        return res.status(400).json({ error: "No Stripe customer for this user" });
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${getReturnBaseUrl(req)}/billing`,
      });

      invalidateTierCache(userId);
      res.json({ url: session.url });
    } catch (err: any) {
      console.error("billing/portal error:", err);
      res.status(500).json({ error: err.message || "Failed to open billing portal" });
    }
  });
}
