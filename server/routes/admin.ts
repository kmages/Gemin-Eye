import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { startRedditMonitor, stopRedditMonitor } from "../reddit-monitor";
import { startGoogleAlertsMonitor, stopGoogleAlertsMonitor } from "../google-alerts-monitor";
import { generateScanToken, generateBookmarkletCode, generateLinkedInBookmarkletCode, getAppBaseUrl } from "../telegram/bookmarklets";

let monitoringEnabled = process.env.MONITORING_DISABLED !== "true"; // defaults to ON

export function isMonitoringEnabled() {
  return monitoringEnabled;
}

const SUPER_ADMIN_ID = "40011074";

export async function isAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.user as { claims: { sub: string } } | undefined;
  if (!user) {
    return res.status(403).json({ error: "Admin access required" });
  }
  if (user.claims.sub === SUPER_ADMIN_ID) {
    return next();
  }
  try {
    const dbUser = await storage.getUserById(user.claims.sub);
    if (dbUser && dbUser.role === "admin") {
      return next();
    }
  } catch (e) {
    console.error("Error checking admin role:", e);
  }
  return res.status(403).json({ error: "Admin access required" });
}

export function registerAdminRoutes(app: Express) {
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
        telegramChatId: z.string().nullable().optional(),
        slackWebhookUrl: z.string().nullable().optional(),
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

  app.get("/api/admin/leads/:businessId", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const businessId = parseInt(req.params.id || req.params.businessId);
      const camps = await storage.getCampaignsByBusiness(businessId);
      const campaignIds = camps.map(c => c.id);
      if (campaignIds.length === 0) return res.json({ leads: [], responses: [], campaigns: [] });
      const bizLeads = await storage.getLeadsByCampaigns(campaignIds);
      const leadIds = bizLeads.map(l => l.id);
      const responses = leadIds.length > 0 ? await storage.getResponsesByLeads(leadIds) : [];
      res.json({ leads: bizLeads, responses, campaigns: camps.map(c => ({ id: c.id, name: c.name, platform: c.platform })) });
    } catch (error) {
      console.error("Admin: Error fetching leads:", error);
      res.status(500).json({ error: "Failed to fetch leads" });
    }
  });

  app.get("/api/admin/all-leads", isAuthenticated, isAdmin, async (_req: any, res) => {
    try {
      const allBiz = await storage.getAllBusinesses();
      const result = [];
      for (const biz of allBiz) {
        const camps = await storage.getCampaignsByBusiness(biz.id);
        const campaignIds = camps.map(c => c.id);
        if (campaignIds.length === 0) continue;
        const bizLeads = await storage.getLeadsByCampaigns(campaignIds);
        if (bizLeads.length === 0) continue;
        const leadIds = bizLeads.map(l => l.id);
        const responses = leadIds.length > 0 ? await storage.getResponsesByLeads(leadIds) : [];
        result.push({
          business: { id: biz.id, name: biz.name },
          campaigns: camps.map(c => ({ id: c.id, name: c.name, platform: c.platform })),
          leads: bizLeads,
          responses,
        });
      }
      res.json(result);
    } catch (error) {
      console.error("Admin: Error fetching all leads:", error);
      res.status(500).json({ error: "Failed to fetch all leads" });
    }
  });

  app.get("/api/admin/check", isAuthenticated, async (req: any, res) => {
    const userId = req.user.claims.sub;
    if (userId === SUPER_ADMIN_ID) {
      return res.json({ isAdmin: true, isSuperAdmin: true });
    }
    try {
      const dbUser = await storage.getUserById(userId);
      return res.json({ isAdmin: dbUser?.role === "admin", isSuperAdmin: false });
    } catch {
      return res.json({ isAdmin: false, isSuperAdmin: false });
    }
  });

  app.get("/api/admin/monitoring", isAuthenticated, isAdmin, async (_req: any, res) => {
    res.json({ enabled: monitoringEnabled });
  });

  app.post("/api/admin/monitoring", isAuthenticated, isAdmin, async (req: any, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    monitoringEnabled = enabled;

    if (enabled) {
      process.env.MONITORING_DISABLED = "false";
      startRedditMonitor();
      startGoogleAlertsMonitor();
      console.log("Admin: Monitoring ENABLED via admin panel");
    } else {
      process.env.MONITORING_DISABLED = "true";
      stopRedditMonitor();
      stopGoogleAlertsMonitor();
      console.log("Admin: Monitoring DISABLED via admin panel");
    }

    res.json({ enabled: monitoringEnabled });
  });

  app.get("/api/admin/users", isAuthenticated, isAdmin, async (_req: any, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json(allUsers);
    } catch (error) {
      console.error("Admin: Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.patch("/api/admin/businesses/:id/owner", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { userId } = req.body;
      if (!userId || typeof userId !== "string") {
        return res.status(400).json({ error: "userId is required" });
      }
      const targetUser = await storage.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      const biz = await storage.getBusinessById(id);
      if (!biz) {
        return res.status(404).json({ error: "Business not found" });
      }
      const updated = await storage.updateBusiness(id, { userId });
      res.json(updated);
    } catch (error) {
      console.error("Admin: Error assigning business owner:", error);
      res.status(500).json({ error: "Failed to assign owner" });
    }
  });

  app.patch("/api/admin/users/:userId/role", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const requesterId = req.user.claims.sub;
      if (requesterId !== SUPER_ADMIN_ID) {
        return res.status(403).json({ error: "Only the super admin can change user roles" });
      }
      const { userId } = req.params;
      const { role } = req.body;
      if (!role || !["admin", "user"].includes(role)) {
        return res.status(400).json({ error: "Role must be 'admin' or 'user'" });
      }
      if (userId === SUPER_ADMIN_ID) {
        return res.status(400).json({ error: "Cannot change the super admin's role" });
      }
      const updated = await storage.updateUserRole(userId, role);
      res.json(updated);
    } catch (error) {
      console.error("Admin: Error updating user role:", error);
      res.status(500).json({ error: "Failed to update user role" });
    }
  });

  app.get("/api/admin/businesses/:id/bookmarklets", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const businessId = Number(req.params.id);
      const biz = await storage.getBusinessById(businessId);
      if (!biz) {
        return res.status(404).json({ error: "Business not found" });
      }
      const chatId = biz.telegramChatId || process.env.TELEGRAM_CHAT_ID;
      if (!chatId) {
        return res.json({ error: "no_telegram", message: "This business has no Telegram chat connected and no default admin chat ID configured." });
      }
      const baseUrl = getAppBaseUrl();
      const token = generateScanToken(chatId, businessId);
      const facebook = generateBookmarkletCode(baseUrl, chatId, businessId, token);
      const linkedin = generateLinkedInBookmarkletCode(baseUrl, chatId, businessId, token);
      res.json({ facebook, linkedin, businessName: biz.name, chatId });
    } catch (error) {
      console.error("Admin: Error generating bookmarklets:", error);
      res.status(500).json({ error: "Failed to generate bookmarklets" });
    }
  });
}
