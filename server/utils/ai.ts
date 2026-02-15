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

export function safeParseJsonFromAI(text: string): any | null {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
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
