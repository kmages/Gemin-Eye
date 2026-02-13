import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
export * from "./models/chat";

export const businesses = pgTable("businesses", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  targetAudience: text("target_audience").notNull(),
  coreOffering: text("core_offering").notNull(),
  preferredTone: text("preferred_tone").notNull().default("empathetic"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const businessesRelations = relations(businesses, ({ many }) => ({
  campaigns: many(campaigns),
}));

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  status: text("status").notNull().default("active"),
  strategy: text("strategy"),
  targetGroups: jsonb("target_groups").$type<string[]>().default([]),
  keywords: jsonb("keywords").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  business: one(businesses, {
    fields: [campaigns.businessId],
    references: [businesses.id],
  }),
  leads: many(leads),
}));

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  platform: text("platform").notNull(),
  groupName: text("group_name").notNull(),
  authorName: text("author_name").notNull(),
  originalPost: text("original_post").notNull(),
  postUrl: text("post_url"),
  intentScore: integer("intent_score").notNull().default(0),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leadsRelations = relations(leads, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [leads.campaignId],
    references: [campaigns.id],
  }),
  responses: many(aiResponses),
}));

export const aiResponses = pgTable("ai_responses", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("pending"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiResponsesRelations = relations(aiResponses, ({ one }) => ({
  lead: one(leads, {
    fields: [aiResponses.leadId],
    references: [leads.id],
  }),
}));

export const insertBusinessSchema = createInsertSchema(businesses).omit({
  id: true,
  createdAt: true,
});

export const insertCampaignSchema = createInsertSchema(campaigns).omit({
  id: true,
  createdAt: true,
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
});

export const insertAiResponseSchema = createInsertSchema(aiResponses).omit({
  id: true,
  createdAt: true,
  approvedAt: true,
});

export type Business = typeof businesses.$inferSelect;
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type AiResponse = typeof aiResponses.$inferSelect;
export type InsertAiResponse = z.infer<typeof insertAiResponseSchema>;
