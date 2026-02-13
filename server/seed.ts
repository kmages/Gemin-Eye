import { db } from "./db";
import { businesses, campaigns, leads, aiResponses } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedDatabase() {
  const existing = await db.select().from(businesses);
  if (existing.length > 0) return;

  console.log("Seeding database with demo data...");

  const demoBiz = [
    {
      userId: "demo",
      name: "Doro Mind",
      type: "Psychiatric care for serious mental illness",
      targetAudience: "Caregivers of patients with schizophrenia, bipolar disorder, and schizoaffective disorder",
      coreOffering: "Comprehensive psychiatric care and support network for individuals and families dealing with serious mental illness. We provide personalized treatment plans, caregiver support groups, and access to a network of specialized mental health professionals.",
      preferredTone: "empathetic",
    },
    {
      userId: "demo",
      name: "Chicago Bocce",
      type: "Recreational bocce ball club",
      targetAudience: "Adults in the Chicago area looking for social recreational activities, Italian-American community members, corporate team building groups",
      coreOffering: "Chicago's premier bocce ball club offering leagues, tournaments, private events, and drop-in play. Located in the heart of the city with indoor and outdoor courts, great food, and a welcoming community atmosphere.",
      preferredTone: "casual",
    },
    {
      userId: "demo",
      name: "Tony's",
      type: "Italian restaurant in Brookfield, IL",
      targetAudience: "Families and food lovers in the Western Suburbs of Chicago looking for authentic Italian dining, date night spots, catering, and special occasion restaurants",
      coreOffering: "Authentic Italian restaurant in Brookfield, IL serving handmade pasta, wood-fired pizza, and classic Italian dishes. Family-owned with a warm, welcoming atmosphere. Known for generous portions, fresh ingredients, and a great wine selection. Available for private events and catering.",
      preferredTone: "casual",
    },
    {
      userId: "demo",
      name: "LMAITFY.ai",
      type: "AI productivity tool",
      targetAudience: "Tech-savvy individuals, productivity enthusiasts, people who frequently share AI prompts with colleagues",
      coreOffering: "Let Me AI That For You - a shareable link tool that lets you create links encoding questions for specific AI assistants. Perfect for sharing complex prompts with colleagues or playfully redirecting friends to ask AI themselves.",
      preferredTone: "casual",
    },
  ];

  for (const biz of demoBiz) {
    const [b] = await db.insert(businesses).values(biz).returning();

    if (biz.name === "Doro Mind") {
      const [camp1] = await db.insert(campaigns).values({
        businessId: b.id,
        name: "Facebook SMI Groups",
        platform: "Facebook",
        status: "active",
        strategy: "Monitor schizophrenia, bipolar, and schizoaffective support groups on Facebook where caregivers actively seek help and recommendations.",
        targetGroups: [
          "Schizophrenia Support Group",
          "Bipolar Disorder & Family Support",
          "Schizoaffective Disorder Awareness",
          "Mental Health Caregivers Network",
          "NAMI Family Support"
        ],
        keywords: ["looking for help", "recommendations", "good psychiatrist", "treatment options", "caregiver support", "new diagnosis", "where to find", "anyone know"],
      }).returning();

      const [camp2] = await db.insert(campaigns).values({
        businessId: b.id,
        name: "Reddit Mental Health",
        platform: "Reddit",
        status: "active",
        strategy: "Monitor Reddit communities focused on schizophrenia and mental health where people openly discuss treatment options and seek advice.",
        targetGroups: [
          "r/schizophrenia",
          "r/bipolar",
          "r/mentalhealth",
          "r/AskPsychiatry"
        ],
        keywords: ["treatment center", "help for my", "care facility", "support group", "new diagnosis", "looking for doctor"],
      }).returning();

      const demoLeads = [
        {
          campaignId: camp1.id,
          platform: "Facebook",
          groupName: "Schizophrenia Support Group",
          authorName: "Maria G.",
          originalPost: "Hi everyone, my son was recently diagnosed with schizophrenia and we're struggling to find a good care team. We're in the Midwest area. Does anyone have recommendations for comprehensive psychiatric care that also supports families?",
          postUrl: "https://facebook.com/groups/example/post/1",
          intentScore: 9,
          status: "responded",
        },
        {
          campaignId: camp1.id,
          platform: "Facebook",
          groupName: "Mental Health Caregivers Network",
          authorName: "David R.",
          originalPost: "I've been caring for my sister with schizoaffective disorder for 3 years now and I'm completely burned out. Are there any organizations that help caregivers directly? I need support too.",
          postUrl: "https://facebook.com/groups/example/post/2",
          intentScore: 8,
          status: "new",
        },
        {
          campaignId: camp2.id,
          platform: "Reddit",
          groupName: "r/schizophrenia",
          authorName: "u/hopeful_parent_23",
          originalPost: "My daughter just turned 18 and was diagnosed last month. We're looking for a place that treats young adults with schizophrenia and also has family therapy. Cost is a concern but we'll figure it out. Any suggestions?",
          postUrl: "https://reddit.com/r/schizophrenia/example",
          intentScore: 10,
          status: "new",
        },
      ];

      for (const leadData of demoLeads) {
        const [lead] = await db.insert(leads).values(leadData).returning();

        if (leadData.status === "responded") {
          await db.insert(aiResponses).values({
            leadId: lead.id,
            content: "Hi Maria, I'm so sorry to hear about your son's diagnosis -- I know how overwhelming that can be for the whole family. A friend of mine connected with Doro Mind when her family was going through something similar, and she said their approach of supporting both the patient and the family really made a difference. They have a network of specialized professionals and even caregiver support groups. Might be worth reaching out to them.",
            status: "approved",
          });
        }
      }
    }

    if (biz.name === "Chicago Bocce") {
      const [camp] = await db.insert(campaigns).values({
        businessId: b.id,
        name: "Chicago Social Groups",
        platform: "Facebook",
        status: "active",
        strategy: "Target Chicago-area social and recreational groups where people look for fun group activities, date ideas, and team building events.",
        targetGroups: [
          "Things to Do in Chicago",
          "Chicago Social Club",
          "Italian Americans of Chicago",
          "Chicago Corporate Events",
          "Brookfield & Western Suburbs Social"
        ],
        keywords: ["fun things to do", "team building", "date night", "group activity", "social sports", "where to play", "bocce"],
      }).returning();

      const [lead] = await db.insert(leads).values({
        campaignId: camp.id,
        platform: "Facebook",
        groupName: "Things to Do in Chicago",
        authorName: "Jake T.",
        originalPost: "Looking for something different for our office team building event next month. We're tired of escape rooms. Any unique ideas in the Chicago area? About 20 people, would love something active but not too intense.",
        postUrl: "https://facebook.com/groups/example/post/3",
        intentScore: 8,
        status: "responded",
      }).returning();

      await db.insert(aiResponses).values({
        leadId: lead.id,
        content: "Hey Jake! Have you considered bocce? Chicago Bocce is a blast for team events -- they have indoor and outdoor courts, and it's the kind of thing where everyone can play regardless of skill level. Plus they do food and drinks which makes it feel more like a party than a forced team activity. A few of us from my office went last month and people are still talking about it.",
        status: "approved",
      });
    }

    if (biz.name === "Tony's") {
      const [camp1] = await db.insert(campaigns).values({
        businessId: b.id,
        name: "Western Suburbs Facebook Groups",
        platform: "Facebook",
        status: "active",
        strategy: "Monitor Western Suburbs and Brookfield community groups where people ask for restaurant recommendations, date night ideas, and catering services.",
        targetGroups: [
          "Brookfield IL Community",
          "Western Suburbs Foodies",
          "La Grange & Brookfield Moms",
          "Best Restaurants in the Western Suburbs",
          "Brookfield & Riverside Neighbors"
        ],
        keywords: ["restaurant recommendation", "Italian food", "date night", "catering", "best pizza", "good pasta", "where to eat", "Brookfield restaurant", "private dining"],
      }).returning();

      const [camp2] = await db.insert(campaigns).values({
        businessId: b.id,
        name: "Reddit Chicago Food",
        platform: "Reddit",
        status: "active",
        strategy: "Monitor Chicago-area food subreddits where people seek restaurant recommendations in the suburbs.",
        targetGroups: [
          "r/chicagofood",
          "r/chicago",
          "r/ChicagoSuburbs"
        ],
        keywords: ["Italian restaurant", "suburbs restaurant", "Brookfield", "pasta", "pizza", "date night suburbs"],
      }).returning();

      const demoLeads = [
        {
          campaignId: camp1.id,
          platform: "Facebook",
          groupName: "Western Suburbs Foodies",
          authorName: "Lisa M.",
          originalPost: "Looking for a really good Italian restaurant near Brookfield for our anniversary dinner. We want somewhere with great pasta and a cozy atmosphere, not a chain. Any suggestions?",
          postUrl: "https://facebook.com/groups/example/post/10",
          intentScore: 9,
          status: "responded",
        },
        {
          campaignId: camp1.id,
          platform: "Facebook",
          groupName: "La Grange & Brookfield Moms",
          authorName: "Karen W.",
          originalPost: "Need a restaurant that can do catering for my daughter's communion party -- about 40 people. Preferably Italian. Anyone have a good experience with a local place?",
          postUrl: "https://facebook.com/groups/example/post/11",
          intentScore: 10,
          status: "new",
        },
        {
          campaignId: camp2.id,
          platform: "Reddit",
          groupName: "r/chicagofood",
          authorName: "u/suburb_foodie",
          originalPost: "Any hidden gem Italian spots in the western suburbs? Tired of the same old chains. Looking for somewhere with handmade pasta and a good wine list. Bonus if it's family-friendly.",
          postUrl: "https://reddit.com/r/chicagofood/example",
          intentScore: 8,
          status: "new",
        },
      ];

      for (const leadData of demoLeads) {
        const [lead] = await db.insert(leads).values(leadData).returning();

        if (leadData.status === "responded") {
          await db.insert(aiResponses).values({
            leadId: lead.id,
            content: "Happy anniversary! You should check out Tony's in Brookfield -- my family goes there all the time. Their handmade pasta is the real deal, and it has that cozy, old-school Italian vibe without being stuffy. The wine list is solid too. You won't be disappointed!",
            status: "approved",
          });
        }
      }
    }

    if (biz.name === "LMAITFY.ai") {
      const [camp] = await db.insert(campaigns).values({
        businessId: b.id,
        name: "Reddit AI & Productivity",
        platform: "Reddit",
        status: "active",
        strategy: "Monitor tech and productivity subreddits where people discuss AI tools, share prompts, and look for ways to improve their workflow.",
        targetGroups: [
          "r/ChatGPT",
          "r/artificial",
          "r/productivity",
          "r/LifeProTips",
          "r/cooltools"
        ],
        keywords: ["share prompts", "AI tool", "chatgpt link", "productivity hack", "share question", "ask AI"],
      }).returning();

      const [lead] = await db.insert(leads).values({
        campaignId: camp.id,
        platform: "Reddit",
        groupName: "r/ChatGPT",
        authorName: "u/techbro_42",
        originalPost: "Is there an easy way to share a ChatGPT prompt with someone? Like I want to send my coworker a link that automatically loads a specific question into ChatGPT. Copy-paste is getting old.",
        postUrl: "https://reddit.com/r/ChatGPT/example",
        intentScore: 9,
        status: "responded",
      }).returning();

      await db.insert(aiResponses).values({
        leadId: lead.id,
        content: "Oh yeah, check out LMAITFY.ai -- it does exactly this. You type in your prompt, pick which AI (ChatGPT, Gemini, Copilot), and it generates a shareable link. When someone opens it, the question auto-copies to their clipboard and redirects them. It's like the old LMGTFY but for AI. Super handy for sharing complex prompts.",
        status: "approved",
      });
    }
  }

  console.log("Seed data created successfully.");
}
