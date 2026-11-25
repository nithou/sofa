import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "../client";
import { integrationEvents, integrations } from "../schema";

export function getUserIntegrations(userId: string) {
  return db.select().from(integrations).where(eq(integrations.userId, userId)).all();
}

export function getRecentEventsForIntegration(integrationId: string, limit = 10) {
  return db
    .select()
    .from(integrationEvents)
    .where(eq(integrationEvents.integrationId, integrationId))
    .orderBy(desc(integrationEvents.receivedAt))
    .limit(limit)
    .all();
}

export function getRecentEventsForIntegrations(integrationIds: string[], limit = 10) {
  if (integrationIds.length === 0)
    return new Map<string, ReturnType<typeof getRecentEventsForIntegration>>();

  const result = new Map<string, ReturnType<typeof getRecentEventsForIntegration>>();
  for (const integrationId of integrationIds) {
    const events = getRecentEventsForIntegration(integrationId, limit);
    if (events.length > 0) result.set(integrationId, events);
  }
  return result;
}

export function getIntegrationByUserAndProvider(userId: string, provider: string) {
  return db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)))
    .get();
}

export function updateIntegrationEnabled(integrationId: string, enabled: boolean) {
  return db
    .update(integrations)
    .set({ enabled })
    .where(eq(integrations.id, integrationId))
    .returning()
    .get();
}

/**
 * Store the account allowlist for a webhook integration.
 * `null` clears the restriction (every account is accepted).
 */
export function updateIntegrationAllowedAccounts(
  integrationId: string,
  allowedAccountIds: string[] | null,
) {
  return db
    .update(integrations)
    .set({
      allowedAccountIds: allowedAccountIds === null ? null : JSON.stringify(allowedAccountIds),
    })
    .where(eq(integrations.id, integrationId))
    .returning()
    .get();
}

/**
 * Media-server accounts seen in this integration's event history, most recently
 * active first, with the total number of events each one sent. Rejected events
 * are included: that's how the settings UI can offer accounts it has not been
 * allowed to log yet.
 */
export function getSeenAccountsForIntegration(integrationId: string) {
  return db
    .select({
      accountId: integrationEvents.accountId,
      // Any non-null name from the group — MAX() on text is lexicographic, not "latest",
      // so after a rename this label can lag. Cosmetic only: matching uses accountId.
      accountName: sql<string | null>`max(${integrationEvents.accountName})`,
      // Stored as unix seconds (Drizzle timestamp mode); converted below.
      lastSeenAt: sql<number>`max(${integrationEvents.receivedAt})`,
      eventCount: sql<number>`count(*)`,
    })
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.integrationId, integrationId),
        isNotNull(integrationEvents.accountId),
      ),
    )
    .groupBy(integrationEvents.accountId)
    .orderBy(desc(sql`max(${integrationEvents.receivedAt})`))
    .all()
    .map((row) => ({
      accountId: row.accountId,
      accountName: row.accountName,
      lastSeenAt: new Date(Number(row.lastSeenAt) * 1000),
      eventCount: Number(row.eventCount),
    }));
}

export function insertIntegration(values: typeof integrations.$inferInsert) {
  return db.insert(integrations).values(values).returning().get();
}

export function deleteIntegrationByUserAndProvider(userId: string, provider: string): void {
  db.delete(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)))
    .run();
}

export function regenerateIntegrationToken(userId: string, provider: string, newToken: string) {
  return db
    .update(integrations)
    .set({ token: newToken })
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)))
    .returning()
    .get();
}

export function getIntegrationByToken(token: string) {
  return db.select().from(integrations).where(eq(integrations.token, token)).get();
}
