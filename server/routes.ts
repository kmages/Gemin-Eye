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
import { sendTelegramMessage, sendTelegramMessageToChat, formatLeadNotification, formatResponseNotification } from "./telegram";
import { registerTelegramWebhook, generateScanToken, generateLinkedInBookmarkletCode } from "./telegram-bot";
import { startRedditMonitor } from "./reddit-monitor";
import { startGoogleAlertsMonitor } from "./google-alerts-monitor";
import { SOURCE_ARCHIVE_B64 } from "./source-archive";
import { businesses as businessesTable, campaigns as campaignsTable, leads as leadsTable, aiResponses as aiResponsesTable, responseFeedback as responseFeedbackTable } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "./db";

function safeParseJsonFromAI(text: string): any | null {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

const MIN_POST_LENGTH = 25;
const MIN_SCAN_INTENT_SCORE = 4;
const MIN_MONITOR_INTENT_SCORE = 5;
const SALESY_FEEDBACK_THRESHOLD = 0.3;

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

  app.post("/api/strategy/generate", isAuthenticated, async (req: any, res) => {
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

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
        config: { maxOutputTokens: 8192 },
      });

      const text = response.text || "";
      const strategyData = safeParseJsonFromAI(text);
      if (!strategyData) {
        throw new Error("No JSON found in response");
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

  const ADMIN_USER_ID = "40011074";

  function isAdmin(req: any, res: any, next: any) {
    if (!req.user || req.user.claims.sub !== ADMIN_USER_ID) {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  }

  app.get("/api/admin/businesses", isAuthenticated, isAdmin, async (_req: any, res) => {
    try {
      const allBiz = await storage.getAllBusinesses();
      const result = [];
      for (const biz of allBiz) {
        const camps = await storage.getCampaignsByBusiness(biz.id);
        const campaignIds = camps.map(c => c.id);
        const bizLeads = campaignIds.length > 0 ? await storage.getLeadsByCampaigns(campaignIds) : [];
        result.push({ ...biz, campaigns: camps, leadCount: bizLeads.length });
      }
      res.json(result);
    } catch (error) {
      console.error("Admin: Error fetching businesses:", error);
      res.status(500).json({ error: "Failed to fetch businesses" });
    }
  });

  app.patch("/api/admin/businesses/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateSchema = z.object({
        name: z.string().min(1).optional(),
        type: z.string().optional(),
        contactEmail: z.string().nullable().optional(),
        contactPhone: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
        targetAudience: z.string().optional(),
        coreOffering: z.string().optional(),
        preferredTone: z.string().optional(),
      });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      }
      const biz = await storage.updateBusiness(id, parsed.data);
      res.json(biz);
    } catch (error) {
      console.error("Admin: Error updating business:", error);
      res.status(500).json({ error: "Failed to update business" });
    }
  });

  app.delete("/api/admin/businesses/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteBusiness(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Admin: Error deleting business:", error);
      res.status(500).json({ error: "Failed to delete business" });
    }
  });

  app.patch("/api/admin/campaigns/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateSchema = z.object({
        name: z.string().min(1).optional(),
        platform: z.string().optional(),
        status: z.string().optional(),
        targetGroups: z.array(z.string()).optional(),
        keywords: z.array(z.string()).optional(),
        strategy: z.string().nullable().optional(),
      });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      }
      const camp = await storage.updateCampaign(id, parsed.data);
      res.json(camp);
    } catch (error) {
      console.error("Admin: Error updating campaign:", error);
      res.status(500).json({ error: "Failed to update campaign" });
    }
  });

  app.post("/api/admin/campaigns", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const createSchema = z.object({
        businessId: z.number(),
        name: z.string().min(1),
        platform: z.string().min(1),
        status: z.string().default("active"),
        targetGroups: z.array(z.string()).default([]),
        keywords: z.array(z.string()).default([]),
        strategy: z.string().nullable().default(null),
      });
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      }
      const camp = await storage.createCampaign(parsed.data);
      res.json(camp);
    } catch (error) {
      console.error("Admin: Error creating campaign:", error);
      res.status(500).json({ error: "Failed to create campaign" });
    }
  });

  app.delete("/api/admin/campaigns/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCampaign(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Admin: Error deleting campaign:", error);
      res.status(500).json({ error: "Failed to delete campaign" });
    }
  });

  app.get("/api/admin/check", isAuthenticated, async (req: any, res) => {
    res.json({ isAdmin: req.user.claims.sub === ADMIN_USER_ID });
  });

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

  const fbScanRateLimit = new Map<string, { count: number; resetAt: number }>();
  const liScanRateLimit = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    fbScanRateLimit.forEach((val, key) => {
      if (now > val.resetAt) fbScanRateLimit.delete(key);
    });
    liScanRateLimit.forEach((val, key) => {
      if (now > val.resetAt) liScanRateLimit.delete(key);
    });
  }, 5 * 60 * 1000);
  app.post("/api/fb-scan", async (req, res) => {
    const rateLimitKey = String(req.body.chatId || req.ip);
    const now = Date.now();
    const bucket = fbScanRateLimit.get(rateLimitKey);
    if (bucket && now < bucket.resetAt) {
      if (bucket.count >= 10) {
        res.json({ matched: false, reason: "rate_limited" });
        return;
      }
      bucket.count++;
    } else {
      fbScanRateLimit.set(rateLimitKey, { count: 1, resetAt: now + 60000 });
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    try {
      const { chatId, businessId, token, postText, groupName, pageUrl } = req.body;

      if (!chatId || !businessId || !postText || typeof postText !== "string" || !token) {
        res.json({ matched: false, reason: "missing_fields" });
        return;
      }

      const expectedToken = generateScanToken(String(chatId), Number(businessId));
      if (token !== expectedToken) {
        res.json({ matched: false, reason: "invalid_token" });
        return;
      }

      if (postText.length < MIN_POST_LENGTH) {
        res.json({ matched: false, reason: "too_short" });
        return;
      }

      const biz = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
      if (biz.length === 0) {
        res.json({ matched: false, reason: "business_not_found" });
        return;
      }

      const business = biz[0];
      const bizCampaigns = await db.select().from(campaignsTable).where(eq(campaignsTable.businessId, businessId));
      const allKeywords = bizCampaigns.flatMap(c => (c.keywords as string[]) || []);

      const lower = postText.toLowerCase();
      const hasKeyword = allKeywords.some(kw => lower.includes(kw.toLowerCase()));
      if (!hasKeyword) {
        res.json({ matched: false, reason: "no_keyword_match" });
        return;
      }

      const matchResult = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `You are a lead scout for "${business.name}" (${business.type}).
They offer: ${business.coreOffering}

Analyze this Facebook post from "${groupName || "a Facebook group"}":
"${postText.slice(0, 500)}"

Is this person asking a question or seeking help/recommendations that "${business.name}" could address?
Rate the intent from 1-10 (10 = actively looking for exactly what this business offers).

Return ONLY valid JSON:
{"is_lead": true/false, "intent_score": <1-10>, "reasoning": "<one sentence>"}`,
        config: { maxOutputTokens: 512 },
      });

      const matchText = matchResult.text || "";
      const match = safeParseJsonFromAI(matchText);
      if (!match) {
        res.json({ matched: false, reason: "ai_parse_error" });
        return;
      }

      if (!match.is_lead || match.intent_score < MIN_SCAN_INTENT_SCORE) {
        res.json({ matched: false, reason: "low_intent", score: match.intent_score });
        return;
      }

      let feedbackGuidance = "";
      try {
        const recentFeedback = await db
          .select({ feedback: responseFeedbackTable.feedback })
          .from(responseFeedbackTable)
          .innerJoin(aiResponsesTable, eq(responseFeedbackTable.responseId, aiResponsesTable.id))
          .innerJoin(leadsTable, eq(aiResponsesTable.leadId, leadsTable.id))
          .innerJoin(campaignsTable, eq(leadsTable.campaignId, campaignsTable.id))
          .where(eq(campaignsTable.businessId, businessId))
          .orderBy(responseFeedbackTable.id)
          .limit(20);

        const salesyCount = recentFeedback.filter(f => f.feedback === "too_salesy").length;
        const negCount = recentFeedback.filter(f => f.feedback !== "positive").length;
        const total = recentFeedback.length;

        if (total > 0) {
          if (salesyCount > total * SALESY_FEEDBACK_THRESHOLD) {
            feedbackGuidance = "\nIMPORTANT: Previous responses were too salesy. Be EXTRA subtle.";
          } else if (negCount > total * 0.5) {
            feedbackGuidance = "\nIMPORTANT: Previous responses had mixed reviews. Be more genuine.";
          }
        }
      } catch {}

      const toneMap: Record<string, string> = {
        empathetic: "empathetic, warm, and supportive",
        professional: "professional, authoritative, and informative",
        casual: "casual, friendly, and approachable",
      };

      const responseResult = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are writing a Facebook comment in a community group. Your goal is to be genuinely helpful while subtly recommending a business.

The post: "${postText.slice(0, 500)}"
Group: "${groupName || "Facebook Group"}"

Business to recommend: ${business.name}
What they do: ${business.coreOffering}
Tone: ${toneMap[business.preferredTone] || "friendly and helpful"}
${feedbackGuidance}

Write a natural, human-sounding comment (2-3 sentences). Do NOT make it sound like an ad. Sound like a real person sharing a helpful recommendation. Include the business name naturally.

Return ONLY the response text, no quotes or formatting.`,
        config: { maxOutputTokens: 8192 },
      });

      const responseText = (responseResult.text || "").trim();
      if (!responseText) {
        res.json({ matched: true, score: match.intent_score, reason: "no_response_generated" });
        return;
      }

      let savedResponseId: number | null = null;
      const activeCampaign = bizCampaigns[0];
      if (activeCampaign) {
        try {
          const [savedLead] = await db.insert(leadsTable).values({
            campaignId: activeCampaign.id,
            platform: "facebook",
            groupName: groupName || "Facebook Group",
            authorName: "FB user",
            originalPost: postText.slice(0, 2000),
            postUrl: pageUrl || null,
            intentScore: match.intent_score,
            status: "matched",
          }).returning();

          if (savedLead) {
            const [savedResponse] = await db.insert(aiResponsesTable).values({
              leadId: savedLead.id,
              content: responseText,
              status: "pending",
            }).returning();
            savedResponseId = savedResponse?.id || null;
          }
        } catch (err) {
          console.error("Error saving FB scan lead:", err);
        }
      }

      const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const scoreBar = "*".repeat(match.intent_score) + "_".repeat(10 - match.intent_score);
      let msg = `<b>Facebook Lead Found</b>\n\n`;
      msg += `<b>Business:</b> ${escHtml(business.name)}\n`;
      msg += `<b>Group:</b> ${escHtml(groupName || "Facebook Group")}\n`;
      msg += `<b>Intent:</b> ${scoreBar} ${match.intent_score}/10\n`;
      msg += `<b>Why:</b> ${escHtml(match.reasoning || "")}\n\n`;
      msg += `<b>Post:</b>\n<i>"${escHtml(postText.slice(0, 200))}"</i>`;

      if (pageUrl) {
        msg += `\n\nTap "Open Facebook Post" below, then paste the reply.`;
      }

      const buttons: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
      if (pageUrl) {
        buttons.push([{ text: "Open Facebook Post", url: pageUrl }]);
      }
      if (savedResponseId) {
        buttons.push([
          { text: "Used It", callback_data: `fb_good_${savedResponseId}` },
          { text: "Bad Match", callback_data: `fb_bad_${savedResponseId}` },
          { text: "Too Salesy", callback_data: `fb_salesy_${savedResponseId}` },
          { text: "Wrong Client", callback_data: `fb_wrong_${savedResponseId}` },
        ]);
      }

      await sendTelegramMessageToChat(chatId, msg, buttons.length > 0 ? { buttons } : undefined);
      await sendTelegramMessageToChat(chatId, responseText);

      res.json({ matched: true, score: match.intent_score });
    } catch (error) {
      console.error("FB scan error:", error);
      res.json({ matched: false, reason: "server_error" });
    }
  });

  app.options("/api/fb-scan", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
  });

  app.post("/api/li-scan", async (req, res) => {
    const rateLimitKey = String(req.body.chatId || req.ip);
    const now = Date.now();
    const bucket = liScanRateLimit.get(rateLimitKey);
    if (bucket && now < bucket.resetAt) {
      if (bucket.count >= 10) {
        res.json({ matched: false, reason: "rate_limited" });
        return;
      }
      bucket.count++;
    } else {
      liScanRateLimit.set(rateLimitKey, { count: 1, resetAt: now + 60000 });
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    try {
      const { chatId, businessId, token, postText, authorName, pageUrl } = req.body;

      if (!chatId || !businessId || !postText || typeof postText !== "string" || !token) {
        res.json({ matched: false, reason: "missing_fields" });
        return;
      }

      const expectedToken = generateScanToken(String(chatId), Number(businessId));
      if (token !== expectedToken) {
        res.json({ matched: false, reason: "invalid_token" });
        return;
      }

      if (postText.length < MIN_POST_LENGTH) {
        res.json({ matched: false, reason: "too_short" });
        return;
      }

      const biz = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
      if (biz.length === 0) {
        res.json({ matched: false, reason: "business_not_found" });
        return;
      }

      const business = biz[0];
      const bizCampaigns = await db.select().from(campaignsTable).where(eq(campaignsTable.businessId, businessId));
      const allKeywords = bizCampaigns.flatMap(c => (c.keywords as string[]) || []);

      const lower = postText.toLowerCase();
      const hasKeyword = allKeywords.some(kw => lower.includes(kw.toLowerCase()));
      if (!hasKeyword) {
        res.json({ matched: false, reason: "no_keyword_match" });
        return;
      }

      const matchResult = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `You are a lead scout for "${business.name}" (${business.type}).
They offer: ${business.coreOffering}

Analyze this LinkedIn post by "${authorName || "someone"}":
"${postText.slice(0, 500)}"

Is this person asking a question or seeking help/recommendations that "${business.name}" could address?
Rate the intent from 1-10 (10 = actively looking for exactly what this business offers).

Return ONLY valid JSON:
{"is_lead": true/false, "intent_score": <1-10>, "reasoning": "<one sentence>"}`,
        config: { maxOutputTokens: 512 },
      });

      const matchText = matchResult.text || "";
      const match = safeParseJsonFromAI(matchText);
      if (!match) {
        res.json({ matched: false, reason: "ai_parse_error" });
        return;
      }

      if (!match.is_lead || match.intent_score < MIN_SCAN_INTENT_SCORE) {
        res.json({ matched: false, reason: "low_intent", score: match.intent_score });
        return;
      }

      let feedbackGuidance = "";
      try {
        const recentFeedback = await db
          .select({ feedback: responseFeedbackTable.feedback })
          .from(responseFeedbackTable)
          .innerJoin(aiResponsesTable, eq(responseFeedbackTable.responseId, aiResponsesTable.id))
          .innerJoin(leadsTable, eq(aiResponsesTable.leadId, leadsTable.id))
          .innerJoin(campaignsTable, eq(leadsTable.campaignId, campaignsTable.id))
          .where(eq(campaignsTable.businessId, businessId))
          .orderBy(responseFeedbackTable.id)
          .limit(20);

        const salesyCount = recentFeedback.filter(f => f.feedback === "too_salesy").length;
        const negCount = recentFeedback.filter(f => f.feedback !== "positive").length;
        const total = recentFeedback.length;

        if (total > 0) {
          if (salesyCount > total * SALESY_FEEDBACK_THRESHOLD) {
            feedbackGuidance = "\nIMPORTANT: Previous responses were too salesy. Be EXTRA subtle.";
          } else if (negCount > total * 0.5) {
            feedbackGuidance = "\nIMPORTANT: Previous responses had mixed reviews. Be more genuine.";
          }
        }
      } catch {}

      const toneMap: Record<string, string> = {
        empathetic: "empathetic, warm, and supportive",
        professional: "professional, authoritative, and informative",
        casual: "casual, friendly, and approachable",
        helpful: "helpful, knowledgeable, and conversational",
      };

      const responseResult = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are writing a LinkedIn comment on a professional post. Your goal is to be genuinely helpful while subtly recommending a business.

The post by ${authorName || "someone"}: "${postText.slice(0, 500)}"

Business to recommend: ${business.name}
What they do: ${business.coreOffering}
Tone: ${toneMap[business.preferredTone] || "professional and helpful"}
${feedbackGuidance}

Write a natural, professional LinkedIn comment (2-3 sentences). Sound like a real professional sharing knowledge or a recommendation. Keep it conversational but polished for LinkedIn. Include the business name naturally.

Return ONLY the response text, no quotes or formatting.`,
        config: { maxOutputTokens: 8192 },
      });

      const responseText = (responseResult.text || "").trim();
      if (!responseText) {
        res.json({ matched: true, score: match.intent_score, reason: "no_response_generated" });
        return;
      }

      let savedResponseId: number | null = null;
      const liCampaign = bizCampaigns.find(c => c.platform === "LinkedIn") || bizCampaigns[0];
      if (liCampaign) {
        try {
          const [savedLead] = await db.insert(leadsTable).values({
            campaignId: liCampaign.id,
            platform: "linkedin",
            groupName: "LinkedIn Feed",
            authorName: authorName || "LinkedIn user",
            originalPost: postText.slice(0, 2000),
            postUrl: pageUrl || null,
            intentScore: match.intent_score,
            status: "matched",
          }).returning();

          if (savedLead) {
            const [savedResponse] = await db.insert(aiResponsesTable).values({
              leadId: savedLead.id,
              content: responseText,
              status: "pending",
            }).returning();
            savedResponseId = savedResponse?.id || null;
          }
        } catch (err) {
          console.error("Error saving LinkedIn scan lead:", err);
        }
      }

      const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const scoreBar = "*".repeat(match.intent_score) + "_".repeat(10 - match.intent_score);
      let msg = `<b>LinkedIn Lead Found</b>\n\n`;
      msg += `<b>Business:</b> ${escHtml(business.name)}\n`;
      msg += `<b>Author:</b> ${escHtml(authorName || "LinkedIn user")}\n`;
      msg += `<b>Intent:</b> ${scoreBar} ${match.intent_score}/10\n`;
      msg += `<b>Why:</b> ${escHtml(match.reasoning || "")}\n\n`;
      msg += `<b>Post:</b>\n<i>"${escHtml(postText.slice(0, 200))}"</i>`;

      if (pageUrl) {
        msg += `\n\nTap "Open LinkedIn Post" below, then paste the reply.`;
      }

      const buttons: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
      if (pageUrl) {
        buttons.push([{ text: "Open LinkedIn Post", url: pageUrl }]);
      }
      if (savedResponseId) {
        buttons.push([
          { text: "Used It", callback_data: `li_good_${savedResponseId}` },
          { text: "Bad Match", callback_data: `li_bad_${savedResponseId}` },
          { text: "Too Salesy", callback_data: `li_salesy_${savedResponseId}` },
          { text: "Wrong Client", callback_data: `li_wrong_${savedResponseId}` },
        ]);
      }

      await sendTelegramMessageToChat(chatId, msg, buttons.length > 0 ? { buttons } : undefined);
      await sendTelegramMessageToChat(chatId, responseText);

      res.json({ matched: true, score: match.intent_score });
    } catch (error) {
      console.error("LinkedIn scan error:", error);
      res.json({ matched: false, reason: "server_error" });
    }
  });

  app.options("/api/li-scan", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
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
      "server/storage.ts",
      "server/db.ts",
      "server/telegram.ts",
      "server/telegram-bot.ts",
      "server/reddit-monitor.ts",
      "server/google-alerts-monitor.ts",
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
