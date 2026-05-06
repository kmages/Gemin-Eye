import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

let cachedSettings: any = null;

async function getStripeCredentials(): Promise<{
  secretKey: string;
  publishableKey: string;
  webhookSecret?: string;
}> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. Ensure the Stripe integration is connected via the Integrations tab.",
    );
  }

  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  const resp = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Replit-Token": xReplitToken,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`,
    );
  }

  const data = await resp.json();
  const settings = data.items?.[0]?.settings;
  cachedSettings = settings;

  if (!settings?.secret || !settings?.publishable) {
    throw new Error(
      `Stripe ${targetEnvironment} connection not found. Connect Stripe via the Integrations tab first.`,
    );
  }

  return {
    secretKey: settings.secret,
    publishableKey: settings.publishable,
    webhookSecret: settings.webhook_secret,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey, { apiVersion: "2025-08-27.basil" as any });
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getStripeCredentials();
  return publishableKey;
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}

export async function isStripeConnected(): Promise<boolean> {
  try {
    await getStripeCredentials();
    return true;
  } catch {
    return false;
  }
}
