import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const requiredEnvVars = ["DATABASE_URL", "SESSION_SECRET"];
const optionalEnvVars = ["TELEGRAM_BOT_TOKEN", "AI_INTEGRATIONS_GEMINI_API_KEY"];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

for (const envVar of optionalEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`WARNING: Missing optional environment variable: ${envVar} — some features will be disabled`);
  }
}

const app = express();
const httpServer = createServer(app);

// ── CORS ──────────────────────────────────────────────────────────────────────
// Allow the production domain + Replit preview domains in dev.
// The Telegram webhook path is excluded — it's a server-to-server call with
// its own SHA-256 signature verification and has no need for CORS handling.
const PRODUCTION_ORIGINS = [
  "https://gemin-eye.com",
  "https://www.gemin-eye.com",
];

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin requests have no Origin header
  if (PRODUCTION_ORIGINS.includes(origin)) return true;
  if (process.env.NODE_ENV !== "production") {
    // Allow any Replit preview domain and localhost during development
    if (
      origin.endsWith(".replit.dev") ||
      origin.endsWith(".repl.co") ||
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1")
    ) {
      return true;
    }
  }
  return false;
}

const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS: blocked request from origin "${origin}"`);
      const err = Object.assign(new Error("Not allowed by CORS"), { status: 403 });
      callback(err);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Apply CORS to all /api routes except the Telegram webhook (server-to-server)
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/telegram/webhook")) return next();
  corsMiddleware(req, res, next);
});
// ──────────────────────────────────────────────────────────────────────────────

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const body = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${body.length > 200 ? body.slice(0, 200) + "..." : body}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  const { seedDatabase } = await import("./seed");
  await seedDatabase().catch((e) => console.error("Seed error:", e));

  const { syncKeywords } = await import("./sync-keywords");
  await syncKeywords().catch((e) => console.error("Keyword sync error:", e));

  const { startSeenItemsPruner } = await import("./utils/dedup");
  startSeenItemsPruner();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
