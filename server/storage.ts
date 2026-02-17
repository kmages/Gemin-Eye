import {
  businesses, campaigns, leads, aiResponses, users,
  type Business, type InsertBusiness,
  type Campaign, type InsertCampaign,
  type Lead, type InsertLead,
  type AiResponse, type InsertAiResponse,
  type User,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, inArray, ne } from "drizzle-orm";

export interface DashboardData {
  businesses: Business[];
  campaigns: Campaign[];
  leads: Lead[];
  responses: AiResponse[];
}

export interface IStorage {
  getBusinessesByUser(userId: string): Promise<Business[]>;
  getBusinessesByTelegramChatId(chatId: string): Promise<Business[]>;
  createBusiness(data: InsertBusiness): Promise<Business>;
  getCampaignsByBusiness(businessId: number): Promise<Campaign[]>;
  getCampaignsByUser(userId: string): Promise<Campaign[]>;
  createCampaign(data: InsertCampaign): Promise<Campaign>;
  getLeadsByCampaigns(campaignIds: number[]): Promise<Lead[]>;
  createLead(data: InsertLead): Promise<Lead>;
  getResponsesByLeads(leadIds: number[]): Promise<AiResponse[]>;
  createResponse(data: InsertAiResponse): Promise<AiResponse>;
  updateResponseStatus(id: number, status: string): Promise<AiResponse>;
  getAllBusinesses(): Promise<Business[]>;
  getBusinessById(id: number): Promise<Business | undefined>;
  updateBusiness(id: number, data: Partial<InsertBusiness>): Promise<Business>;
  updateCampaign(id: number, data: Partial<InsertCampaign>): Promise<Campaign>;
  deleteCampaign(id: number): Promise<void>;
  deleteBusiness(id: number): Promise<void>;
  getDashboardData(userId: string): Promise<DashboardData>;
  getUserById(id: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User>;
}

export class DatabaseStorage implements IStorage {
  async getBusinessesByUser(userId: string): Promise<Business[]> {
    return db.select().from(businesses).where(eq(businesses.userId, userId)).orderBy(desc(businesses.createdAt));
  }

  async getBusinessesByTelegramChatId(chatId: string): Promise<Business[]> {
    return db.select().from(businesses).where(eq(businesses.telegramChatId, chatId)).orderBy(desc(businesses.createdAt));
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
    return db.select().from(campaigns).where(inArray(campaigns.businessId, bizIds)).orderBy(desc(campaigns.createdAt));
  }

  async createCampaign(data: InsertCampaign): Promise<Campaign> {
    const [camp] = await db.insert(campaigns).values(data).returning();
    return camp;
  }

  async getLeadsByCampaigns(campaignIds: number[]): Promise<Lead[]> {
    if (campaignIds.length === 0) return [];
    return db.select().from(leads).where(inArray(leads.campaignId, campaignIds)).orderBy(desc(leads.createdAt));
  }

  async createLead(data: InsertLead): Promise<Lead> {
    const [lead] = await db.insert(leads).values(data).returning();
    return lead;
  }

  async getResponsesByLeads(leadIds: number[]): Promise<AiResponse[]> {
    if (leadIds.length === 0) return [];
    return db.select().from(aiResponses).where(inArray(aiResponses.leadId, leadIds)).orderBy(desc(aiResponses.createdAt));
  }

  async createResponse(data: InsertAiResponse): Promise<AiResponse> {
    const [resp] = await db.insert(aiResponses).values(data).returning();
    return resp;
  }

  async updateResponseStatus(id: number, status: string): Promise<AiResponse> {
    const [resp] = await db.update(aiResponses).set({ status, approvedAt: status === "approved" ? new Date() : null }).where(eq(aiResponses.id, id)).returning();
    return resp;
  }

  async getAllBusinesses(): Promise<Business[]> {
    return db.select().from(businesses).orderBy(desc(businesses.createdAt));
  }

  async getBusinessById(id: number): Promise<Business | undefined> {
    const [biz] = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
    return biz;
  }

  async updateBusiness(id: number, data: Partial<InsertBusiness>): Promise<Business> {
    const [biz] = await db.update(businesses).set(data).where(eq(businesses.id, id)).returning();
    return biz;
  }

  async updateCampaign(id: number, data: Partial<InsertCampaign>): Promise<Campaign> {
    const [camp] = await db.update(campaigns).set(data).where(eq(campaigns.id, id)).returning();
    return camp;
  }

  async deleteCampaign(id: number): Promise<void> {
    await db.delete(campaigns).where(eq(campaigns.id, id));
  }

  async deleteBusiness(id: number): Promise<void> {
    await db.delete(businesses).where(eq(businesses.id, id));
  }

  async getDashboardData(userId: string): Promise<DashboardData> {
    const userBiz = await db.select().from(businesses).where(eq(businesses.userId, userId)).orderBy(desc(businesses.createdAt));
    if (userBiz.length === 0) return { businesses: userBiz, campaigns: [], leads: [], responses: [] };

    const bizIds = userBiz.map((b) => b.id);
    const userCamps = await db.select().from(campaigns).where(inArray(campaigns.businessId, bizIds)).orderBy(desc(campaigns.createdAt));
    if (userCamps.length === 0) return { businesses: userBiz, campaigns: userCamps, leads: [], responses: [] };

    const campIds = userCamps.map((c) => c.id);
    const userLeads = await db.select().from(leads).where(inArray(leads.campaignId, campIds)).orderBy(desc(leads.createdAt));
    if (userLeads.length === 0) return { businesses: userBiz, campaigns: userCamps, leads: userLeads, responses: [] };

    const leadIds = userLeads.map((l) => l.id);
    const userResponses = await db.select().from(aiResponses).where(inArray(aiResponses.leadId, leadIds)).orderBy(desc(aiResponses.createdAt));

    return { businesses: userBiz, campaigns: userCamps, leads: userLeads, responses: userResponses };
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUserRole(id: string, role: string): Promise<User> {
    const [user] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    return user;
  }
}

export const storage = new DatabaseStorage();
