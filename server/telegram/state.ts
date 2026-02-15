export interface PendingContextRequest {
  postText: string;
  postUrl: string | null;
  platform: "reddit" | "facebook" | null;
  timestamp: number;
}

export interface ClientWizardState {
  step: "name" | "offering" | "contact" | "location" | "keywords" | "done";
  chatId: string;
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
