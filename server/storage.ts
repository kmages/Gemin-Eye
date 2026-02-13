import {
  businesses, campaigns, leads, aiResponses,
  type Business, type InsertBusiness,
  type Campaign, type InsertCampaign,
  type Lead, type InsertLead,
  type AiResponse, type InsertAiResponse,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getBusinessesByUser(userId: string): Promise<Business[]>;
  createBusiness(data: InsertBusiness): Promise<Business>;
  getCampaignsByBusiness(businessId: number): Promise<Campaign[]>;
  getCampaignsByUser(userId: string): Promise<Campaign[]>;
  createCampaign(data: InsertCampaign): Promise<Campaign>;
  getLeadsByCampaigns(campaignIds: number[]): Promise<Lead[]>;
  createLead(data: InsertLead): Promise<Lead>;
  getResponsesByLeads(leadIds: number[]): Promise<AiResponse[]>;
  createResponse(data: InsertAiResponse): Promise<AiResponse>;
  updateResponseStatus(id: number, status: string): Promise<AiResponse>;
}

export class DatabaseStorage implements IStorage {
  async getBusinessesByUser(userId: string): Promise<Business[]> {
    return db.select().from(businesses).where(eq(businesses.userId, userId)).orderBy(desc(businesses.createdAt));
  }

  async createBusiness(data: InsertBusiness): Promise<Business> {
    const [biz] = await db.insert(businesses).values(data).returning();
    return biz;
  }

  async getCampaignsByBusiness(businessId: number): Promise<Campaign[]> {
    return db.select().from(campaigns).where(eq(campaigns.businessId, businessId)).orderBy(desc(campaigns.createdAt));
  }

  async getCampaignsByUser(userId: string): Promise<Campaign[]> {
    const userBiz = await this.getBusinessesByUser(userId);
    if (userBiz.length === 0) return [];
    const bizIds = userBiz.map((b) => b.id);
    const allCampaigns: Campaign[] = [];
    for (const bizId of bizIds) {
      const c = await this.getCampaignsByBusiness(bizId);
      allCampaigns.push(...c);
    }
    return allCampaigns;
  }

  async createCampaign(data: InsertCampaign): Promise<Campaign> {
    const [camp] = await db.insert(campaigns).values(data).returning();
    return camp;
  }

  async getLeadsByCampaigns(campaignIds: number[]): Promise<Lead[]> {
    if (campaignIds.length === 0) return [];
    const allLeads: Lead[] = [];
    for (const cid of campaignIds) {
      const l = await db.select().from(leads).where(eq(leads.campaignId, cid)).orderBy(desc(leads.createdAt));
      allLeads.push(...l);
    }
    return allLeads;
  }

  async createLead(data: InsertLead): Promise<Lead> {
    const [lead] = await db.insert(leads).values(data).returning();
    return lead;
  }

  async getResponsesByLeads(leadIds: number[]): Promise<AiResponse[]> {
    if (leadIds.length === 0) return [];
    const allResponses: AiResponse[] = [];
    for (const lid of leadIds) {
      const r = await db.select().from(aiResponses).where(eq(aiResponses.leadId, lid)).orderBy(desc(aiResponses.createdAt));
      allResponses.push(...r);
    }
    return allResponses;
  }

  async createResponse(data: InsertAiResponse): Promise<AiResponse> {
    const [resp] = await db.insert(aiResponses).values(data).returning();
    return resp;
  }

  async updateResponseStatus(id: number, status: string): Promise<AiResponse> {
    const [resp] = await db.update(aiResponses).set({ status, approvedAt: status === "approved" ? new Date() : null }).where(eq(aiResponses.id, id)).returning();
    return resp;
  }
}

export const storage = new DatabaseStorage();
