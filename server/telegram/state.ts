export interface PendingContextRequest {
  postText: string;
  postUrl: string | null;
  platform: "reddit" | "facebook" | null;
  timestamp: number;
}

export interface ClientWizardState {
  step: "name" | "offering" | "contact" | "location" | "keywords" | "done";
  chatId: string;
  timestamp: number;
  name?: string;
  keywords?: string[];
  offering?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  location?: string;
}

export interface AdminSetupState {
  step: string;
  timestamp: number;
  name?: string;
  type?: string;
  audience?: string;
  offering?: string;
  tone?: string;
  keywords?: string[];
  groups?: string[];
}

export const pendingContextRequests = new Map<string, PendingContextRequest>();
export const pendingRedditPosts = new Map<number, { responseText: string; postUrl: string; timestamp: number }>();

export const REDDIT_POST_TTL = 30 * 60 * 1000;
export const CONTEXT_TTL = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 10 * 60 * 1000;

export function cleanupStaleState(): void {
  const now = Date.now();
  let cleaned = 0;

  pendingContextRequests.forEach((val, key) => {
    if (now - val.timestamp > CONTEXT_TTL) {
      pendingContextRequests.delete(key);
      cleaned++;
    }
  });

  pendingRedditPosts.forEach((val, key) => {
    if (now - val.timestamp > REDDIT_POST_TTL) {
      pendingRedditPosts.delete(key);
      cleaned++;
    }
  });

  if (cleaned > 0) {
    console.log(`State cleanup: removed ${cleaned} stale in-memory entries`);
  }
}

setInterval(cleanupStaleState, CLEANUP_INTERVAL).unref();

import { pruneWizardSessions } from "../utils/wizard-db";
const WIZARD_PRUNE_INTERVAL = 60 * 60 * 1000;
setInterval(() => pruneWizardSessions().catch(console.error), WIZARD_PRUNE_INTERVAL).unref();
