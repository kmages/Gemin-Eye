import { db } from "../db";
import { responseFeedback, aiResponses, leads, campaigns } from "@shared/schema";
import { eq } from "drizzle-orm";
import { SALESY_FEEDBACK_THRESHOLD } from "./ai";

export async function getFeedbackGuidance(businessId: number): Promise<string> {
  try {
    const recentFeedback = await db
      .select({ feedback: responseFeedback.feedback })
      .from(responseFeedback)
      .innerJoin(aiResponses, eq(responseFeedback.responseId, aiResponses.id))
      .innerJoin(leads, eq(aiResponses.leadId, leads.id))
      .innerJoin(campaigns, eq(leads.campaignId, campaigns.id))
      .where(eq(campaigns.businessId, businessId))
      .orderBy(responseFeedback.id)
      .limit(20);

    const salesyCount = recentFeedback.filter((f) => f.feedback === "too_salesy").length;
    const negCount = recentFeedback.filter((f) => f.feedback !== "positive").length;
    const total = recentFeedback.length;

    if (total > 0) {
      if (salesyCount > total * SALESY_FEEDBACK_THRESHOLD) {
        return "\nIMPORTANT: Previous responses were rated as too salesy. Be EXTRA subtle - barely mention the business. Focus 90% on being helpful.";
      } else if (negCount > total * 0.5) {
        return "\nIMPORTANT: Previous responses had mixed reviews. Focus on being more genuine and less promotional.";
      }
    }
  } catch {}
  return "";
}
