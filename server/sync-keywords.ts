import { db } from "./db";
import { campaigns } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const TONYS_KEYWORDS = [
  "breakfast spot", "all day breakfast", "24 hour restaurant", "late night food",
  "diner", "pancakes", "family restaurant", "comfort food",
  "where to eat breakfast", "brunch", "open late", "early breakfast",
  "steak and eggs", "Brookfield", "western suburbs food", "best breakfast",
  "late night diner", "24/7 food", "carry out food", "good diner", "where to eat late",
];

const DORO_MIND_KEYWORDS = [
  "schizophrenia", "schizoaffective", "psychosis", "hallucinations",
  "voices", "delusions", "antipsychotic", "medication", "treatment options",
  "psychiatrist", "therapist", "diagnosis", "caregiver support",
  "looking for help", "recommendations", "anyone know", "new diagnosis",
  "where to find", "mental health", "support group", "family member",
  "loved one", "advice", "what helps", "coping",
  "feel alone", "feeling alone", "lonely", "need someone to talk to",
  "someone to talk", "overwhelmed", "struggling", "cant cope",
  "need help", "reaching out", "desperate", "not okay",
  "falling apart", "losing my mind", "universe in my head",
  "cant take it", "breaking down", "feel lost",
  "isolating", "isolation", "nobody understands",
  "scared", "paranoid", "hearing things", "seeing things", "not real",
];

export async function syncKeywords() {
  const doroFbCampaigns = await db.select().from(campaigns)
    .where(and(eq(campaigns.businessId, 1), eq(campaigns.platform, "Facebook")));

  for (const camp of doroFbCampaigns) {
    const currentKeywords = (camp.keywords as string[]) || [];
    if (currentKeywords.length < DORO_MIND_KEYWORDS.length) {
      await db.update(campaigns)
        .set({ keywords: DORO_MIND_KEYWORDS })
        .where(eq(campaigns.id, camp.id));
      console.log(`Synced keywords for campaign ${camp.id} (${camp.name}): ${currentKeywords.length} → ${DORO_MIND_KEYWORDS.length}`);
    }
  }

  const doroRedditCampaigns = await db.select().from(campaigns)
    .where(and(eq(campaigns.businessId, 1), eq(campaigns.platform, "Reddit")));

  for (const camp of doroRedditCampaigns) {
    const currentKeywords = (camp.keywords as string[]) || [];
    if (currentKeywords.length < DORO_MIND_KEYWORDS.length) {
      await db.update(campaigns)
        .set({ keywords: DORO_MIND_KEYWORDS })
        .where(eq(campaigns.id, camp.id));
      console.log(`Synced keywords for campaign ${camp.id} (${camp.name}): ${currentKeywords.length} → ${DORO_MIND_KEYWORDS.length}`);
    }
  }

  const tonysCampaigns = await db.select().from(campaigns)
    .where(eq(campaigns.businessId, 5));

  for (const camp of tonysCampaigns) {
    const currentKeywords = (camp.keywords as string[]) || [];
    const needsUpdate = currentKeywords.length !== TONYS_KEYWORDS.length ||
      currentKeywords.some(k => k === "Italian food" || k === "best pizza" || k === "good pasta");
    if (needsUpdate) {
      await db.update(campaigns)
        .set({ keywords: TONYS_KEYWORDS })
        .where(eq(campaigns.id, camp.id));
      console.log(`Synced keywords for campaign ${camp.id} (${camp.name}): ${currentKeywords.length} → ${TONYS_KEYWORDS.length}`);
    }
  }
}
