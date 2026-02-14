import type { Express } from "express";
import { createServer, type Server } from "http";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { storage } from "./storage";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { insertBusinessSchema } from "@shared/schema";
import { sendTelegramMessage, formatLeadNotification, formatResponseNotification } from "./telegram";
import { registerTelegramWebhook } from "./telegram-bot";
import { startRedditMonitor } from "./reddit-monitor";
import { SOURCE_ARCHIVE_B64 } from "./source-archive";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

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

      const { name, type, targetAudience, coreOffering, preferredTone, strategy } = parsed.data;

      const biz = await storage.createBusiness({
        userId,
        name,
        type,
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

  app.post("/api/strategy/generate", isAuthenticated, async (req: any, res) => {
    try {
      const strategyInputSchema = z.object({
        name: z.string().min(1),
        type: z.string().min(1),
        targetAudience: z.string().min(1),
        coreOffering: z.string().min(10),
        preferredTone: z.string().min(1),
      });

      const parsed = strategyInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      }

      const { name, type, targetAudience, coreOffering, preferredTone } = parsed.data;

      const prompt = `You are a marketing strategist specializing in social media community engagement.

A business wants to find customers by monitoring social media groups for high-intent questions and responding helpfully.

Business Details:
- Name: ${name}
- Type/Niche: ${type}
- Target Audience: ${targetAudience}
- Core Offering: ${coreOffering}
- Preferred Tone: ${preferredTone}

Generate a customer acquisition strategy. Return ONLY valid JSON with this exact structure:
{
  "platforms": [{"name": "Facebook"}, {"name": "Reddit"}],
  "groups": ["Group Name 1", "Group Name 2", "Group Name 3", "Group Name 4", "Group Name 5"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6", "keyword7", "keyword8"],
  "sampleResponse": "A sample response that the AI would post in one of these groups when someone asks a relevant question. Make it sound natural and helpful, not like an ad. About 2-3 sentences.",
  "rationale": "2-3 sentences explaining why these platforms and groups were chosen and how this strategy will help the business find customers."
}

Be specific with real group names that exist on these platforms. Make the sample response sound genuinely human and helpful with a subtle recommendation. Match the preferred tone.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
        config: { maxOutputTokens: 8192 },
      });

      const text = response.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const strategyData = JSON.parse(jsonMatch[0]);
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
      const camps = await storage.getCampaignsByUser(userId);
      const campaignIds = camps.map((c) => c.id);
      const allLeads = await storage.getLeadsByCampaigns(campaignIds);
      const leadIds = allLeads.map((l) => l.id);
      const responses = await storage.getResponsesByLeads(leadIds);
      res.json({ leads: allLeads, responses });
    } catch (error) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ error: "Failed to fetch leads" });
    }
  });

  app.post("/api/leads/:id/generate-response", isAuthenticated, async (req: any, res) => {
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

      const toneMap: Record<string, string> = {
        empathetic: "empathetic, warm, and supportive",
        professional: "professional, authoritative, and informative",
        casual: "casual, friendly, and approachable",
      };

      const prompt = `You are writing a response to a social media post in a community group. Your goal is to be genuinely helpful while subtly recommending a business.

The post was in the group "${lead.groupName}" on ${lead.platform}.
The original post: "${lead.originalPost}"
Posted by: ${lead.authorName}

Business to recommend: ${business.name}
What they do: ${business.coreOffering}
Tone: ${toneMap[business.preferredTone] || "friendly and helpful"}

Write a natural, human-sounding response (2-3 sentences). Do NOT make it sound like an ad. Sound like a real person sharing a helpful recommendation based on personal experience or knowledge. Include the business name naturally.

Return ONLY the response text, no quotes or formatting.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
        config: { maxOutputTokens: 8192 },
      });

      const responseText = response.text || "";

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

  app.post("/api/leads/score", isAuthenticated, async (req: any, res) => {
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

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { maxOutputTokens: 1024 },
      });

      const text = response.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      res.json(JSON.parse(jsonMatch[0]));
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

  registerTelegramWebhook(app);
  startRedditMonitor();

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

  app.get("/api/download/source", (_req, res) => {
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

  app.get("/download", (_req, res) => {
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

  return httpServer;
}
