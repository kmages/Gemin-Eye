import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";

const ADMIN_USER_ID = "40011074";

export function isAdmin(req: any, res: any, next: any) {
  if (!req.user || req.user.claims.sub !== ADMIN_USER_ID) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
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
}
