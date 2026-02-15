import type { Express } from "express";
import { createServer, type Server } from "http";
import fs from "fs";
import path from "path";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { storage } from "./storage";
import { z } from "zod";
import { insertBusinessSchema } from "@shared/schema";
import { sendTelegramMessage, formatLeadNotification, formatResponseNotification } from "./telegram";
import { registerTelegramWebhook } from "./telegram-bot";
import { startRedditMonitor } from "./reddit-monitor";
import { startGoogleAlertsMonitor } from "./google-alerts-monitor";
import { SOURCE_ARCHIVE_B64 } from "./source-archive";
import { generateContent, safeParseJsonFromAI, parseAIJsonWithRetry, strategySchema, TONE_MAP } from "./utils/ai";
import { createRateLimiter } from "./utils/rate-limit";
import { registerAdminRoutes } from "./routes/admin";
import { registerScanRoutes } from "./routes/scan";

const aiRateLimit = createRateLimiter({
  name: "ai-endpoints",
  maxRequests: 10,
  windowMs: 60 * 1000,
  keyFn: (req: any) => req.user?.claims?.sub || req.ip || "unknown",
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/businesses", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const biz = await storage.getBusinessesByUser(userId);
      res.json(biz);
    } catch (error) {
      console.error("Error fetching businesses:", error);
      res.status(500).json({ error: "Failed to fetch businesses" });
    }
  });

  app.post("/api/businesses", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const bodySchema = insertBusinessSchema.omit({ userId: true }).extend({
        strategy: z.object({
          platforms: z.array(z.object({ name: z.string() })),
          groups: z.array(z.string()),
          keywords: z.array(z.string()),
          sampleResponse: z.string(),
          rationale: z.string(),
        }).optional(),
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      }

      const { name, type, contactEmail, contactPhone, website, targetAudience, coreOffering, preferredTone, strategy } = parsed.data;

      const biz = await storage.createBusiness({
        userId,
        name,
        type,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        website: website || null,
        targetAudience,
        coreOffering,
        preferredTone,
      });

      if (strategy && strategy.platforms) {
        for (const platform of strategy.platforms) {
          await storage.createCampaign({
            businessId: biz.id,
            name: `${platform.name} Campaign`,
            platform: platform.name,
            status: "active",
            strategy: strategy.rationale,
            targetGroups: strategy.groups.filter((_: string, i: number) => i < 5),
            keywords: strategy.keywords,
          });
        }
      }

      res.json(biz);
    } catch (error) {
      console.error("Error creating business:", error);
      res.status(500).json({ error: "Failed to create business" });
    }
  });

  app.post("/api/strategy/generate", isAuthenticated, aiRateLimit, async (req: any, res) => {
    try {
      const strategyInputSchema = z.object({
        name: z.string().min(1),
        type: z.string().min(1),
        contactEmail: z.string().optional().default(""),
        contactPhone: z.string().optional().default(""),
        website: z.string().optional().default(""),
        location: z.string().optional().default(""),
        targetAudience: z.string().min(1),
        coreOffering: z.string().min(10),
        preferredTone: z.string().min(1),
      });

      const parsed = strategyInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      }

      const { name, type, location, targetAudience, coreOffering, preferredTone } = parsed.data;
      const locationLine = location ? `\n- Location: ${location}` : "";

      const prompt = `You are a marketing strategist specializing in social media community engagement.

A business wants to find customers by monitoring social media groups for high-intent questions and responding helpfully.

Business Details:
- Name: ${name}
- Type/Niche: ${type}${locationLine}
- Target Audience: ${targetAudience}
- Core Offering: ${coreOffering}
- Preferred Tone: ${preferredTone}

Generate a customer acquisition strategy. Return ONLY valid JSON with this exact structure:
{
  "platforms": [{"name": "Facebook"}, {"name": "Reddit"}],
  "groups": ["Group Name 1", "Group Name 2", "r/subreddit1", "r/subreddit2", "r/subreddit3"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6", "keyword7", "keyword8"],
  "sampleResponse": "A sample response that the AI would post in one of these groups when someone asks a relevant question. Make it sound natural and helpful, not like an ad. About 2-3 sentences.",
  "rationale": "2-3 sentences explaining why these platforms and groups were chosen and how this strategy will help the business find customers."
}

CRITICAL RULES FOR GROUPS:
- Include at least 3-5 REAL Reddit subreddits that actually exist, prefixed with "r/" (e.g., r/chicago, r/woodworking, r/fitness).
- NEVER use placeholder names like "r/[yourcity]" or "[Your City Name]". Use REAL specific subreddit names.
- If the business has a specific local area, ALWAYS include the local city/region subreddit (e.g., r/chicago, r/austin, r/nyc).
- If the business is national or global/web-based, focus on industry and topic subreddits instead of geographic ones.
- Pick subreddits where the target audience is likely to ask questions or seek recommendations.
- Also include 2-3 real Facebook group names if applicable.
- Make the sample response sound genuinely human and helpful with a subtle recommendation. Match the preferred tone.`;

      const strategyData = await parseAIJsonWithRetry(
        async () => {
          const response = await generateContent({
            model: "gemini-2.5-pro",
            contents: prompt,
            config: { maxOutputTokens: 8192 },
          });
          return response.text;
        },
        strategySchema
      );

      if (!strategyData) {
        throw new Error("Failed to generate strategy after retries");
      }
      res.json(strategyData);
    } catch (error) {
      console.error("Error generating strategy:", error);
      res.status(500).json({ error: "Failed to generate strategy" });
    }
  });

  app.get("/api/campaigns", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const camps = await storage.getCampaignsByUser(userId);
      res.json(camps);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
      res.status(500).json({ error: "Failed to fetch campaigns" });
    }
  });

  app.get("/api/leads", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const data = await storage.getDashboardData(userId);
      res.json({ leads: data.leads, responses: data.responses });
    } catch (error) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ error: "Failed to fetch leads" });
    }
  });

  app.post("/api/leads/:id/generate-response", isAuthenticated, aiRateLimit, async (req: any, res) => {
    try {
      const leadId = parseInt(req.params.id);
      const userId = req.user.claims.sub;

      const camps = await storage.getCampaignsByUser(userId);
      const campaignIds = camps.map((c) => c.id);
      const allLeads = await storage.getLeadsByCampaigns(campaignIds);
      const lead = allLeads.find((l) => l.id === leadId);

      if (!lead) {
        return res.status(404).json({ error: "Lead not found" });
      }

      const campaign = camps.find((c) => c.id === lead.campaignId);
      const bizList = await storage.getBusinessesByUser(userId);
      const business = bizList.find((b) => b.id === campaign?.businessId);

      if (!business) {
        return res.status(404).json({ error: "Business not found" });
      }

      const prompt = `You are writing a response to a social media post in a community group. Your goal is to be genuinely helpful while subtly recommending a business.

The post was in the group "${lead.groupName}" on ${lead.platform}.
The original post: "${lead.originalPost}"
Posted by: ${lead.authorName}

Business to recommend: ${business.name}
What they do: ${business.coreOffering}
Tone: ${TONE_MAP[business.preferredTone] || "friendly and helpful"}

Write a natural, human-sounding response (2-3 sentences). Do NOT make it sound like an ad. Sound like a real person sharing a helpful recommendation based on personal experience or knowledge. Include the business name naturally.

Return ONLY the response text, no quotes or formatting.`;

      const response = await generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
        config: { maxOutputTokens: 8192 },
      });

      const responseText = response.text;

      const aiResp = await storage.createResponse({
        leadId,
        content: responseText.trim(),
        status: "pending",
      });

      sendTelegramMessage(formatResponseNotification(
        lead, business.name, responseText.trim()
      )).catch((e) => console.error("Telegram notification failed:", e));

      res.json(aiResp);
    } catch (error) {
      console.error("Error generating response:", error);
      res.status(500).json({ error: "Failed to generate response" });
    }
  });

  app.post("/api/leads/score", isAuthenticated, aiRateLimit, async (req: any, res) => {
    try {
      const { post, businessType, targetAudience } = req.body;
      if (!post || !businessType) {
        return res.status(400).json({ error: "Missing required fields: post, businessType" });
      }

      const prompt = `You are a lead scoring AI. Analyze this social media post and rate how likely this person is to become a customer for the described business.

Post: "${post}"
Business Type: ${businessType}
Target Audience: ${targetAudience || "general"}

Return ONLY valid JSON with this structure:
{
  "score": <number 1-10>,
  "reasoning": "<one sentence explaining the score>",
  "keywords_matched": ["keyword1", "keyword2"]
}`;

      const response = await generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { maxOutputTokens: 1024 },
      });

      const text = response.text;
      const scored = safeParseJsonFromAI(text);
      if (!scored) {
        throw new Error("No JSON found in response");
      }
      res.json(scored);
    } catch (error) {
      console.error("Error scoring lead:", error);
      res.status(500).json({ error: "Failed to score lead" });
    }
  });

  app.post("/api/responses/:id/approve", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user.claims.sub;

      const camps = await storage.getCampaignsByUser(userId);
      const campaignIds = camps.map((c) => c.id);
      const allLeads = await storage.getLeadsByCampaigns(campaignIds);
      const leadIds = allLeads.map((l) => l.id);
      const allResponses = await storage.getResponsesByLeads(leadIds);
      const owned = allResponses.find((r) => r.id === id);

      if (!owned) {
        return res.status(404).json({ error: "Response not found" });
      }

      const resp = await storage.updateResponseStatus(id, "approved");
      res.json(resp);
    } catch (error) {
      console.error("Error approving response:", error);
      res.status(500).json({ error: "Failed to approve response" });
    }
  });

  registerAdminRoutes(app);
  registerScanRoutes(app);

  registerTelegramWebhook(app);
  startRedditMonitor();
  startGoogleAlertsMonitor();

  app.post("/api/telegram/test", isAuthenticated, async (_req: any, res) => {
    try {
      const success = await sendTelegramMessage(
        "<b>Gemin-Eye Connected!</b>\n\nYour Telegram notifications are working. You'll receive alerts here when new leads are found and AI responses are ready to copy & paste."
      );
      if (success) {
        res.json({ success: true, message: "Test message sent!" });
      } else {
        res.status(500).json({ error: "Failed to send. Check bot token and chat ID." });
      }
    } catch (error) {
      console.error("Telegram test error:", error);
      res.status(500).json({ error: "Failed to send test message" });
    }
  });

  app.post("/api/telegram/notify-lead", isAuthenticated, async (req: any, res) => {
    try {
      const { leadId } = req.body;
      if (!leadId) return res.status(400).json({ error: "leadId required" });

      const userId = req.user.claims.sub;
      const camps = await storage.getCampaignsByUser(userId);
      const campaignIds = camps.map((c) => c.id);
      const allLeads = await storage.getLeadsByCampaigns(campaignIds);
      const lead = allLeads.find((l) => l.id === leadId);

      if (!lead) return res.status(404).json({ error: "Lead not found" });

      const bizList = await storage.getBusinessesByUser(userId);
      const campaign = camps.find((c) => c.id === lead.campaignId);
      const business = bizList.find((b) => b.id === campaign?.businessId);

      const leadResponses = await storage.getResponsesByLeads([lead.id]);
      const latestResponse = leadResponses[0];

      const msg = formatLeadNotification(
        lead,
        business?.name || "Unknown",
        latestResponse?.content
      );

      const success = await sendTelegramMessage(msg);
      res.json({ success });
    } catch (error) {
      console.error("Telegram notify error:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });

  app.get("/api/download/source", isAuthenticated, (_req: any, res) => {
    try {
      const buffer = Buffer.from(SOURCE_ARCHIVE_B64, "base64");
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", "attachment; filename=gemin-eye-source.tar.gz");
      res.setHeader("Content-Length", buffer.length.toString());
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: "Failed to serve archive" });
    }
  });

  app.get("/download", isAuthenticated, (_req: any, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html><head><title>Download Gemin-Eye Source</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:#fff;}
.box{text-align:center;padding:40px;border:1px solid #333;border-radius:12px;background:#1a1a1a;}
a{display:inline-block;margin-top:20px;padding:14px 32px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-size:18px;font-weight:600;}
a:hover{background:#4f46e5;}</style></head>
<body><div class="box"><h1>Gemin-Eye Source Code</h1><p>Click below to download all source files as a .tar.gz archive.</p>
<a href="/api/download/source">Download Source Code</a></div></body></html>`);
  });

  app.get("/api/source", isAuthenticated, (_req: any, res) => {
    const coreFiles = [
      "shared/schema.ts",
      "shared/models/auth.ts",
      "shared/models/chat.ts",
      "server/index.ts",
      "server/routes.ts",
      "server/routes/admin.ts",
      "server/routes/scan.ts",
      "server/storage.ts",
      "server/db.ts",
      "server/telegram.ts",
      "server/telegram-bot.ts",
      "server/reddit-monitor.ts",
      "server/google-alerts-monitor.ts",
      "server/utils/ai.ts",
      "server/utils/html.ts",
      "server/utils/feedback.ts",
      "server/utils/rate-limit.ts",
      "client/src/App.tsx",
      "client/src/pages/landing.tsx",
      "client/src/pages/dashboard.tsx",
      "client/src/pages/onboarding.tsx",
      "client/src/pages/client-guide.tsx",
      "client/src/hooks/use-auth.ts",
      "client/src/lib/queryClient.ts",
      "client/src/components/theme-provider.tsx",
      "client/public/spy-glass.js",
      "client/public/li-spy-glass.js",
      "replit.md",
    ];

    let output = "# GEMIN-EYE — FULL SOURCE CODE\n";
    output += "# AI-Powered Customer Acquisition Platform\n";
    output += "# https://gemin-eye.com\n";
    output += `# Generated: ${new Date().toISOString()}\n`;
    output += "# This file is auto-generated for AI code review.\n";
    output += "#".repeat(60) + "\n\n";

    for (const filePath of coreFiles) {
      const fullPath = path.resolve(process.cwd(), filePath);
      try {
        if (!fs.existsSync(fullPath)) continue;
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n").length;
        output += "=".repeat(60) + "\n";
        output += `FILE: ${filePath} (${lines} lines)\n`;
        output += "=".repeat(60) + "\n";
        output += content + "\n\n";
      } catch {}
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(output);
  });

  app.get("/api/test-telegram", isAuthenticated, async (_req: any, res) => {
    try {
      const success = await sendTelegramMessage(
        `<b>Gemin-Eye Test</b>\n\nThis is a test message from the Gemin-Eye platform.\nTimestamp: ${new Date().toISOString()}\n\nIf you see this, Telegram delivery is working!`
      );
      res.json({ success, message: success ? "Test message sent to Telegram" : "Failed to send" });
    } catch (err: any) {
      res.json({ success: false, error: err?.message || String(err) });
    }
  });

  return httpServer;
}
