import { getUncachableStripeClient } from "../server/stripeClient";

/**
 * Seeds Gemin-Eye's two subscription tiers in Stripe.
 * Idempotent — safe to run multiple times.
 *
 *   Starter — $49/mo  Reddit + Google Alerts monitoring
 *   Pro     — $149/mo Everything + Facebook & LinkedIn Spy Glass bookmarklets
 *
 * Tier is encoded in product.metadata.tier ("starter" | "pro") and read
 * by server/utils/subscription.ts to gate features.
 *
 * Run: npx tsx scripts/seed-products.ts
 */

interface Plan {
  name: string;
  description: string;
  tier: "starter" | "pro";
  monthlyAmount: number; // cents
}

const PLANS: Plan[] = [
  {
    name: "Gemin-Eye Starter",
    description: "Reddit and Google Alerts monitoring with AI-generated replies. Up to 1 business.",
    tier: "starter",
    monthlyAmount: 4900,
  },
  {
    name: "Gemin-Eye Pro",
    description: "Everything in Starter plus Facebook + LinkedIn Spy Glass bookmarklets and Slack alerts.",
    tier: "pro",
    monthlyAmount: 14900,
  },
];

async function ensureProduct(stripe: any, plan: Plan) {
  const existing = await stripe.products.search({
    query: `name:'${plan.name}' AND active:'true'`,
  });

  let product = existing.data[0];
  if (product) {
    console.log(`✓ ${plan.name} already exists (${product.id})`);
    if (product.metadata?.tier !== plan.tier) {
      product = await stripe.products.update(product.id, {
        metadata: { ...product.metadata, tier: plan.tier },
      });
      console.log(`  ↳ updated metadata.tier=${plan.tier}`);
    }
  } else {
    product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { tier: plan.tier },
    });
    console.log(`+ created product ${plan.name} (${product.id})`);
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 50 });
  const monthly = prices.data.find(
    (p: any) => p.recurring?.interval === "month" && p.unit_amount === plan.monthlyAmount,
  );

  if (monthly) {
    console.log(`✓ Monthly price exists (${monthly.id}) — $${plan.monthlyAmount / 100}/mo`);
  } else {
    const created = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.monthlyAmount,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { tier: plan.tier },
    });
    console.log(`+ created price $${plan.monthlyAmount / 100}/mo (${created.id})`);
  }
}

async function main() {
  const stripe = await getUncachableStripeClient();
  console.log("Seeding Gemin-Eye subscription products...\n");
  for (const plan of PLANS) {
    await ensureProduct(stripe, plan);
    console.log("");
  }
  console.log("✓ Done. Webhooks will sync these to the local stripe schema.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
