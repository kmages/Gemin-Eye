import { GoogleGenAI } from "@google/genai";
import { z, ZodSchema } from "zod";

export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || "30000", 10);
const AI_MAX_RETRIES = parseInt(process.env.AI_MAX_RETRIES || "2", 10);

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("timed out")) return true;
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("quota")) return true;
    if (msg.includes("503") || msg.includes("500") || msg.includes("unavailable")) return true;
    if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("socket")) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateContentOnce(
  opts: { model: string; contents: any; config?: any },
  timeoutMs: number,
): Promise<{ text: string }> {
  const aiCall = ai.models.generateContent(opts);
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`AI call timed out after ${timeoutMs}ms (model: ${opts.model})`));
    }, timeoutMs);
    timer.unref?.();
  });
  const result = await Promise.race([aiCall, timeout]);
  return { text: result.text || "" };
}

export async function generateContent(
  opts: { model: string; contents: any; config?: any },
  timeoutMs: number = AI_TIMEOUT_MS,
  retries: number = AI_MAX_RETRIES,
): Promise<{ text: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await generateContentOnce(opts, timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt < retries && isRetryableError(err)) {
        const backoffMs = 1000 * Math.pow(2, attempt);
        console.warn(`AI call failed (attempt ${attempt + 1}/${retries + 1}, model: ${opts.model}), retrying in ${backoffMs}ms...`, err instanceof Error ? err.message : err);
        await sleep(backoffMs);
      } else if (!isRetryableError(err)) {
        throw err;
      }
    }
  }
  throw lastError;
}

export function safeParseJsonFromAI(text: string): unknown | null {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  try { return JSON.parse(cleaned); } catch {}

  const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

export function parseAIJsonWithSchema<T>(
  text: string,
  schema: ZodSchema<T>,
): T | null {
  const parsed = safeParseJsonFromAI(text);
  if (!parsed) return null;
  const validated = schema.safeParse(parsed);
  if (validated.success) return validated.data;
  console.warn("AI JSON schema validation failed:", validated.error.issues);
  return null;
}

export async function parseAIJsonWithRetry<T>(
  generateFn: () => Promise<string>,
  schema: ZodSchema<T>,
  maxRetries: number = 1
): Promise<T | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const text = await generateFn();
      const parsed = safeParseJsonFromAI(text);
      if (!parsed) {
        if (attempt < maxRetries) {
          console.warn(`AI JSON parse failed (attempt ${attempt + 1}), retrying...`);
          continue;
        }
        return null;
      }

      const validated = schema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }

      console.warn(`AI JSON validation failed (attempt ${attempt + 1}):`, validated.error.issues);
      if (attempt < maxRetries) continue;

      return null;
    } catch (err) {
      console.error(`AI generation error (attempt ${attempt + 1}):`, err);
      if (attempt >= maxRetries) return null;
    }
  }
  return null;
}

export const leadScoreSchema = z.object({
  is_lead: z.boolean(),
  intent_score: z.number().min(1).max(10),
  reasoning: z.string(),
});

export type LeadScore = z.infer<typeof leadScoreSchema>;

export const strategySchema = z.object({
  platforms: z.array(z.object({ name: z.string() })),
  groups: z.array(z.string()),
  keywords: z.array(z.string()),
  sampleResponse: z.string(),
  rationale: z.string(),
});

export type Strategy = z.infer<typeof strategySchema>;

export const scanMatchSchema = z.object({
  is_lead: z.boolean(),
  intent_score: z.number().min(1).max(10),
  reasoning: z.string(),
});

export type ScanMatch = z.infer<typeof scanMatchSchema>;

export const analysisMatchSchema = z.object({
  matched_business: z.string().nullable(),
  intent_score: z.number().min(1).max(10),
  confidence: z.number().min(1).max(10).optional(),
  reasoning: z.string(),
});

export type AnalysisMatch = z.infer<typeof analysisMatchSchema>;

const MENTAL_HEALTH_KEYWORDS = [
  "schizophrenia", "schizoaffective", "psychosis", "psychotic",
  "bipolar", "mental illness", "mental health", "psychiatric",
  "antipsychotic", "hallucinations", "delusions", "voices",
  "paranoia", "paranoid", "manic", "mania", "dissociat",
];

export function getMentalHealthGuidance(coreOffering: string, postText: string, isReddit: boolean = false): string {
  const combined = `${coreOffering} ${postText}`.toLowerCase();
  const isMentalHealth = MENTAL_HEALTH_KEYWORDS.some(kw => combined.includes(kw));
  if (!isMentalHealth) return "";

  let guidance = `\n\nMENTAL HEALTH RESPONSE GUIDELINES (MANDATORY — LIFE AND DEATH CONTEXT):`;
  guidance += `\n- These posts involve serious mental illness. Every response must be treated with the gravity and sensitivity that a potentially life-or-death situation demands.`;
  guidance += `\n- Carefully assess the urgency and emotional state of the poster. Adapt your tone and depth accordingly — a person in distress needs compassion first, information second.`;
  guidance += `\n- Evaluate whether the poster appears to be in active crisis (expressing suicidal thoughts, self-harm, danger to self or others, extreme distress, or desperation). If there is ANY indication of crisis, start your response by acknowledging their pain and prominently include: "If you or someone you know is in crisis, please call or text 988 (Suicide & Crisis Lifeline) for immediate support."`;
  guidance += `\n- ALWAYS include a link to Team Daniel (https://www.teamdanielrunningforrecovery.org) in every response. Team Daniel provides psychosis education and community support for individuals and families. This link must appear in every response, no exceptions.`;

  if (isReddit) {
    guidance += `\n- EXCEPTION TO REDDIT RULES: The Team Daniel link is an educational/safety resource, not self-promotion. You ARE allowed and REQUIRED to include it.`;
  }

  return guidance;
}

export const TONE_MAP: Record<string, string> = {
  empathetic: "empathetic, warm, and supportive",
  professional: "professional, authoritative, and informative",
  casual: "casual, friendly, and approachable",
  helpful: "helpful, knowledgeable, and conversational",
};

export const MIN_POST_LENGTH = 25;
export const MIN_SCAN_INTENT_SCORE = 4;
export const MIN_MONITOR_INTENT_SCORE = 5;
export const SALESY_FEEDBACK_THRESHOLD = 0.3;
