import { db } from "../db";
import { wizardSessions } from "@shared/schema";
import { eq, lt } from "drizzle-orm";
import type { ClientWizardState, AdminSetupState } from "../telegram/state";

const CLIENT_WIZARD_TYPE = "client";
const ADMIN_SETUP_TYPE = "admin";

export async function getClientWizard(chatId: string): Promise<ClientWizardState | null> {
  const [row] = await db.select().from(wizardSessions)
    .where(eq(wizardSessions.chatId, chatId))
    .limit(1);
  if (!row || row.wizardType !== CLIENT_WIZARD_TYPE) return null;
  return row.state as ClientWizardState;
}

export async function saveClientWizard(chatId: string, state: ClientWizardState): Promise<void> {
  await db.insert(wizardSessions)
    .values({ chatId, wizardType: CLIENT_WIZARD_TYPE, state, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: wizardSessions.chatId,
      set: { wizardType: CLIENT_WIZARD_TYPE, state, updatedAt: new Date() },
    });
}

export async function deleteClientWizard(chatId: string): Promise<void> {
  await db.delete(wizardSessions).where(eq(wizardSessions.chatId, chatId));
}

export async function getAdminSetup(chatId: string): Promise<AdminSetupState | null> {
  const [row] = await db.select().from(wizardSessions)
    .where(eq(wizardSessions.chatId, chatId))
    .limit(1);
  if (!row || row.wizardType !== ADMIN_SETUP_TYPE) return null;
  return row.state as AdminSetupState;
}

export async function saveAdminSetup(chatId: string, state: AdminSetupState): Promise<void> {
  await db.insert(wizardSessions)
    .values({ chatId, wizardType: ADMIN_SETUP_TYPE, state, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: wizardSessions.chatId,
      set: { wizardType: ADMIN_SETUP_TYPE, state, updatedAt: new Date() },
    });
}

export async function deleteAdminSetup(chatId: string): Promise<void> {
  await db.delete(wizardSessions).where(eq(wizardSessions.chatId, chatId));
}

export async function pruneWizardSessions(): Promise<void> {
  const ttlHours = 2;
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);
  const result = await db.delete(wizardSessions).where(lt(wizardSessions.updatedAt, cutoff));
  const count = (result as any).rowCount ?? 0;
  if (count > 0) console.log(`wizard_sessions: pruned ${count} stale sessions (>${ttlHours}h old)`);
}
