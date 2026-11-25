import {
  deleteIntegrationByUserAndProvider,
  getIntegrationByToken,
  getIntegrationByUserAndProvider,
  getRecentEventsForIntegrations,
  getSeenAccountsForIntegration,
  getUserIntegrations,
  insertIntegration,
  regenerateIntegrationToken,
  updateIntegrationAllowedAccounts,
  updateIntegrationEnabled,
} from "@sofa/db/queries/integrations";
import { createLogger } from "@sofa/logger";

const log = createLogger("integrations");

const LIST_PROVIDERS = new Set(["sonarr", "radarr"]);

function integrationTypeFor(provider: string): "webhook" | "list" {
  return LIST_PROVIDERS.has(provider) ? "list" : "webhook";
}

function generateToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
}

/**
 * Stored as JSON text. An unreadable value degrades to `null` (no restriction)
 * rather than locking the user out of their own integration — but it's logged,
 * because silently accepting every account is the opposite of what an allowlist
 * is for.
 */
export function parseAllowedAccountIds(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      log.warn(`Ignoring unreadable allowedAccountIds (not an array): ${raw}`);
      return null;
    }
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    log.warn(`Ignoring unparseable allowedAccountIds: ${raw}`);
    return null;
  }
}

function serializeIntegration(row: {
  id: string;
  provider: string;
  type: "webhook" | "list";
  token: string;
  enabled: boolean;
  allowedAccountIds: string | null;
  lastEventAt: Date | null;
  createdAt: Date;
}) {
  return {
    ...row,
    allowedAccountIds: parseAllowedAccountIds(row.allowedAccountIds),
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function listUserIntegrations(userId: string) {
  const userIntegrations = getUserIntegrations(userId);

  const integrationIds = userIntegrations.map((i) => i.id);
  const eventsByIntegration = getRecentEventsForIntegrations(integrationIds);

  const result = userIntegrations.map((integration) => {
    const events = eventsByIntegration.get(integration.id) ?? [];
    return Object.assign(serializeIntegration(integration), {
      recentEvents: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        mediaType: e.mediaType,
        mediaTitle: e.mediaTitle,
        accountId: e.accountId,
        accountName: e.accountName,
        status: e.status,
        receivedAt: e.receivedAt.toISOString(),
      })),
      accounts: getSeenAccountsForIntegration(integration.id).map((a) => ({
        accountId: a.accountId,
        accountName: a.accountName,
        lastSeenAt: a.lastSeenAt.toISOString(),
        eventCount: a.eventCount,
      })),
    });
  });

  return { integrations: result };
}

export function createOrUpdateIntegration(userId: string, provider: string, enabled?: boolean) {
  const existing = getIntegrationByUserAndProvider(userId, provider);

  if (existing) {
    if (enabled !== undefined) {
      const row = updateIntegrationEnabled(existing.id, enabled);
      return serializeIntegration(row);
    }
    return serializeIntegration(existing);
  }

  const row = insertIntegration({
    userId,
    provider,
    type: integrationTypeFor(provider),
    token: generateToken(),
    enabled: enabled ?? true,
    createdAt: new Date(),
  });

  return serializeIntegration(row);
}

export function deleteIntegration(userId: string, provider: string): void {
  deleteIntegrationByUserAndProvider(userId, provider);
}

export function regenerateToken(userId: string, provider: string) {
  return regenerateIntegrationToken(userId, provider, generateToken());
}

/**
 * Replace the account allowlist of an integration.
 *
 * `null` removes the restriction (every account accepted), `[]` blocks every
 * account, and anything else keeps only the listed IDs. Returns `null` when the
 * user has no such integration.
 */
export function setIntegrationAccounts(
  userId: string,
  provider: string,
  allowedAccountIds: string[] | null,
) {
  const existing = getIntegrationByUserAndProvider(userId, provider);
  if (!existing) return null;

  const normalized =
    allowedAccountIds === null
      ? null
      : [...new Set(allowedAccountIds.map((id) => id.trim()))].filter((id) => id.length > 0);

  return serializeIntegration(updateIntegrationAllowedAccounts(existing.id, normalized));
}

export function findIntegrationByToken(token: string) {
  return getIntegrationByToken(token);
}

export { serializeIntegration };
