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
export const pendingClientSetups = new Map<string, AdminSetupState>();
export const clientWizards = new Map<string, ClientWizardState>();

export const REDDIT_POST_TTL = 30 * 60 * 1000;
export const CONTEXT_TTL = 5 * 60 * 1000;
const WIZARD_TTL = 60 * 60 * 1000;
const ADMIN_SETUP_TTL = 60 * 60 * 1000;
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

  clientWizards.forEach((val, key) => {
    if (now - val.timestamp > WIZARD_TTL) {
      clientWizards.delete(key);
      cleaned++;
    }
  });

  pendingClientSetups.forEach((val, key) => {
    if (now - val.timestamp > ADMIN_SETUP_TTL) {
      pendingClientSetups.delete(key);
      cleaned++;
    }
  });

  if (cleaned > 0) {
    console.log(`State cleanup: removed ${cleaned} stale entries`);
  }
}

setInterval(cleanupStaleState, CLEANUP_INTERVAL).unref();
