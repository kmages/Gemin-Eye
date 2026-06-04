import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";

const GOOGLE_ISSUER = "https://accounts.google.com";

function requireGoogleCreds() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
    );
  }
}

const getOidcConfig = memoize(
  async () => {
    requireGoogleCreds();
    return await client.discovery(
      new URL(GOOGLE_ISSUER),
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!
    );
  },
  { maxAge: 3600 * 1000 }
);

// Only allow OAuth callback strategies to be created for hosts we trust. This
// prevents host-header-driven strategy proliferation (memory growth) and keeps
// the auth flow from being influenced by untrusted Host input.
function isAllowedCallbackHost(host: string | undefined): host is string {
  if (!host || host.length === 0) return false;
  const allowed = new Set<string>(["gemin-eye.com", "www.gemin-eye.com"]);
  for (const d of (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    allowed.add(d);
  }
  if (allowed.has(host)) return true;
  // Replit-managed production subdomain (e.g. gemin-eye.replit.app).
  if (host.endsWith(".replit.app")) return true;
  return false;
}

function callbackUrlFor(host: string): string {
  return `https://${host}/api/callback`;
}

export function getSession() {
  const sessionTtlMs = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    // connect-pg-simple expects the TTL in SECONDS (the cookie maxAge below is
    // in milliseconds). Passing ms here would keep session rows alive for years.
    ttl: sessionTtlMs / 1000,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtlMs,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  // Google OIDC standard claims:
  //   sub          → stable Google user ID
  //   email
  //   given_name   → first name
  //   family_name  → last name
  //   picture      → avatar URL
  // We also accept Replit-style fallbacks so legacy sessions still work.
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["given_name"] ?? claims["first_name"] ?? null,
    lastName: claims["family_name"] ?? claims["last_name"] ?? null,
    profileImageUrl: claims["picture"] ?? claims["profile_image_url"] ?? null,
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // We register strategies lazily per host so the callback URL always matches
  // the host the user actually arrived on (production domain vs. preview).
  const registeredStrategies = new Set<string>();

  const ensureStrategy = async (host: string) => {
    const strategyName = `google:${host}`;
    if (registeredStrategies.has(strategyName)) return strategyName;

    const config = await getOidcConfig();
    const verify: VerifyFunction = async (
      tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
      verified: passport.AuthenticateCallback
    ) => {
      try {
        const user: any = {};
        updateUserSession(user, tokens);
        await upsertUser(tokens.claims());
        verified(null, user);
      } catch (err) {
        verified(err as Error);
      }
    };

    const strategy = new Strategy(
      {
        name: strategyName,
        config,
        scope: "openid email profile",
        callbackURL: callbackUrlFor(host),
      },
      verify
    );
    passport.use(strategy);
    registeredStrategies.add(strategyName);
    return strategyName;
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", async (req, res, next) => {
    try {
      const host = req.hostname;
      if (!isAllowedCallbackHost(host)) {
        return res.status(400).send("Invalid host");
      }
      const strategyName = await ensureStrategy(host);
      passport.authenticate(strategyName, {
        prompt: "select_account",
        scope: ["openid", "email", "profile"],
      })(req, res, next);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/callback", async (req, res, next) => {
    try {
      const host = req.hostname;
      if (!isAllowedCallbackHost(host)) {
        return res.status(400).send("Invalid host");
      }
      const strategyName = await ensureStrategy(host);
      passport.authenticate(strategyName, {
        successReturnToOrRedirect: "/dashboard",
        failureRedirect: "/api/login",
      })(req, res, next);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      // Google does not provide a hosted end-session URL we can safely redirect
      // to without re-prompting the user to pick an account, so we just clear
      // our own session and return them to the landing page.
      res.redirect("/");
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // Google is used purely for identity here — we never call Google APIs on the
  // user's behalf after login, so the Express session (1-week TTL) is the source
  // of truth, not the short-lived Google access token. Gating on the Google
  // token's `exp` would force a re-login every ~hour. As long as Passport has a
  // valid authenticated session, the request is authorized.
  const user = req.user as any;

  if (!req.isAuthenticated() || !user?.claims?.sub) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  return next();
};
