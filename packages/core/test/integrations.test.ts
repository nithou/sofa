import { beforeEach, describe, expect, test } from "vitest";

import { insertIntegrationEventTransaction } from "@sofa/db/queries/webhooks";
import { clearAllTables, insertUser } from "@sofa/test/db";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;

import {
  createOrUpdateIntegration,
  deleteIntegration,
  findIntegrationByToken,
  listUserIntegrations,
  parseAllowedAccountIds,
  regenerateToken,
  setIntegrationAccounts,
} from "../src/integrations";

beforeEach(() => {
  clearAllTables();
  insertUser("user-1");
});

describe("createOrUpdateIntegration", () => {
  test("creates a new webhook integration", () => {
    const result = createOrUpdateIntegration("user-1", "plex");
    expect(result.provider).toBe("plex");
    expect(result.type).toBe("webhook");
    expect(result.enabled).toBe(true);
    expect(result.token).toHaveLength(64); // 32 bytes hex
  });

  test("creates a list integration for sonarr", () => {
    const result = createOrUpdateIntegration("user-1", "sonarr");
    expect(result.type).toBe("list");
  });

  test("creates a list integration for radarr", () => {
    const result = createOrUpdateIntegration("user-1", "radarr");
    expect(result.type).toBe("list");
  });

  test("returns existing integration without duplicating", () => {
    const first = createOrUpdateIntegration("user-1", "plex");
    const second = createOrUpdateIntegration("user-1", "plex");
    expect(second.id).toBe(first.id);
    expect(second.token).toBe(first.token);
  });

  test("updates enabled state on existing integration", () => {
    createOrUpdateIntegration("user-1", "plex", true);
    const updated = createOrUpdateIntegration("user-1", "plex", false);
    expect(updated.enabled).toBe(false);
  });

  test("creates with enabled=false when specified", () => {
    const result = createOrUpdateIntegration("user-1", "jellyfin", false);
    expect(result.enabled).toBe(false);
  });
});

describe("listUserIntegrations", () => {
  test("returns empty list for user with no integrations", () => {
    const result = listUserIntegrations("user-1");
    expect(result.integrations).toHaveLength(0);
  });

  test("returns all integrations for user", () => {
    createOrUpdateIntegration("user-1", "plex");
    createOrUpdateIntegration("user-1", "jellyfin");

    const result = listUserIntegrations("user-1");
    expect(result.integrations).toHaveLength(2);
    const providers = result.integrations.map((i) => i.provider).sort();
    expect(providers).toEqual(["jellyfin", "plex"]);
  });

  test("does not return other users integrations", () => {
    insertUser("user-2");
    createOrUpdateIntegration("user-1", "plex");
    createOrUpdateIntegration("user-2", "jellyfin");

    const result = listUserIntegrations("user-1");
    expect(result.integrations).toHaveLength(1);
    expect(result.integrations[0].provider).toBe("plex");
  });

  test("serializes dates as ISO strings", () => {
    createOrUpdateIntegration("user-1", "plex");
    const result = listUserIntegrations("user-1");
    expect(result.integrations[0].createdAt).toMatch(ISO_DATE_RE);
  });
});

describe("deleteIntegration", () => {
  test("removes an integration", () => {
    createOrUpdateIntegration("user-1", "plex");
    deleteIntegration("user-1", "plex");

    const result = listUserIntegrations("user-1");
    expect(result.integrations).toHaveLength(0);
  });

  test("does not throw for nonexistent integration", () => {
    expect(() => deleteIntegration("user-1", "nonexistent")).not.toThrow();
  });
});

describe("findIntegrationByToken", () => {
  test("finds integration by token", () => {
    const created = createOrUpdateIntegration("user-1", "plex");
    const found = findIntegrationByToken(created.token);
    expect(found?.id).toBe(created.id);
  });

  test("returns undefined for invalid token", () => {
    expect(findIntegrationByToken("nonexistent")).toBeUndefined();
  });
});

describe("regenerateToken", () => {
  test("generates a new token for existing integration", () => {
    const created = createOrUpdateIntegration("user-1", "plex");
    const result = regenerateToken("user-1", "plex");
    expect(result?.token).not.toBe(created.token);
    expect(result?.token).toHaveLength(64);
  });
});

describe("setIntegrationAccounts", () => {
  test("stores an allowlist and returns it in the list", () => {
    createOrUpdateIntegration("user-1", "plex");
    const result = setIntegrationAccounts("user-1", "plex", ["23031105", "2"]);

    expect(result?.allowedAccountIds).toEqual(["23031105", "2"]);
    expect(listUserIntegrations("user-1").integrations[0]?.allowedAccountIds).toEqual([
      "23031105",
      "2",
    ]);
  });

  test("null clears the restriction", () => {
    createOrUpdateIntegration("user-1", "plex");
    setIntegrationAccounts("user-1", "plex", ["1"]);

    expect(setIntegrationAccounts("user-1", "plex", null)?.allowedAccountIds).toBeNull();
  });

  test("trims, dedupes and drops empty ids", () => {
    createOrUpdateIntegration("user-1", "plex");

    expect(
      setIntegrationAccounts("user-1", "plex", [" 1 ", "1", "", "  "])?.allowedAccountIds,
    ).toEqual(["1"]);
  });

  test("keeps an empty list as 'nobody allowed'", () => {
    createOrUpdateIntegration("user-1", "plex");

    expect(setIntegrationAccounts("user-1", "plex", [])?.allowedAccountIds).toEqual([]);
  });

  test("returns null when the integration does not exist", () => {
    expect(setIntegrationAccounts("user-1", "plex", ["1"])).toBeNull();
  });
});

describe("listUserIntegrations accounts", () => {
  test("groups events per account, counts ignored ones and lists the most recent first", () => {
    const integration = createOrUpdateIntegration("user-1", "plex");

    const log = (
      accountId: string | null,
      accountName: string | null,
      status: "success" | "ignored" | "error",
      receivedAt: string,
    ) =>
      insertIntegrationEventTransaction(
        {
          integrationId: integration.id,
          eventType: "media.scrobble",
          mediaTitle: "Probe",
          accountId,
          accountName,
          status,
          errorMessage: null,
          receivedAt: new Date(receivedAt),
        },
        integration.id,
      );

    log("1", "alice", "success", "2026-01-01T10:00:00Z");
    log("1", "alice", "ignored", "2026-01-01T12:00:00Z");
    log("2", "bob", "success", "2026-01-01T11:00:00Z");
    // Events with no account cannot be attributed, so they are not offered as an account.
    log(null, null, "success", "2026-01-01T13:00:00Z");

    expect(listUserIntegrations("user-1").integrations[0]?.accounts).toEqual([
      {
        accountId: "1",
        accountName: "alice",
        lastSeenAt: "2026-01-01T12:00:00.000Z",
        eventCount: 2,
      },
      {
        accountId: "2",
        accountName: "bob",
        lastSeenAt: "2026-01-01T11:00:00.000Z",
        eventCount: 1,
      },
    ]);
  });
});

describe("parseAllowedAccountIds", () => {
  test("returns null for missing or unusable values", () => {
    expect(parseAllowedAccountIds(null)).toBeNull();
    expect(parseAllowedAccountIds("")).toBeNull();
    expect(parseAllowedAccountIds("not json")).toBeNull();
    expect(parseAllowedAccountIds('{"a":1}')).toBeNull();
  });

  test("keeps only string entries", () => {
    expect(parseAllowedAccountIds('["1",2,null,"3"]')).toEqual(["1", "3"]);
  });
});
