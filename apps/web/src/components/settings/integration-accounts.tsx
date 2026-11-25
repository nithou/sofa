import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { orpc } from "@/lib/orpc/client";
import { formatRelativeTime } from "@sofa/i18n/format";

export interface IntegrationAccount {
  accountId: string;
  accountName: string | null;
  lastSeenAt: string;
  eventCount: number;
}

/**
 * Account allowlist for a media server webhook.
 *
 * Webhooks are server-wide: a shared Plex/Jellyfin/Emby server reports every
 * user's plays, and without a filter they all land on the integration owner.
 * Accounts are discovered from the events themselves (no server credentials
 * needed), so an account shows up here as soon as it plays something.
 *
 * `allowedAccountIds === null` means "no restriction" and is the default. The
 * component keeps no local copy of the allowlist: it renders the props it is
 * given, so a refetch can never leave the switches showing a value the server
 * does not have.
 */
export function IntegrationAccounts({
  provider,
  accounts,
  allowedAccountIds,
  onChange,
}: {
  provider: "plex" | "jellyfin" | "emby" | "sonarr" | "radarr";
  accounts: IntegrationAccount[];
  allowedAccountIds: string[] | null;
  onChange: (allowedAccountIds: string[] | null) => void;
}) {
  const { t } = useLingui();

  const mutation = useMutation(
    orpc.account.integrations.setAccounts.mutationOptions({
      onSuccess: (result) => onChange(result.allowedAccountIds),
      onError: () => toast.error(t`Failed to update accounts`),
    }),
  );

  // Treat a missing field like "no restriction" rather than "restricted to nothing".
  const restriction = allowedAccountIds ?? null;
  const restricted = restriction !== null;
  const selected = new Set(restriction ?? []);
  const busy = mutation.isPending;

  function commit(next: string[] | null) {
    mutation.mutate({ provider, allowedAccountIds: next });
  }

  function toggleAccount(accountId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(accountId);
    else next.delete(accountId);
    commit([...next]);
  }

  return (
    <div
      className={`border-border/50 space-y-3 rounded-lg border p-3 transition-opacity ${
        busy ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={`${provider}-account-filter`} className="text-sm font-medium">
            <Trans>Only log plays from selected accounts</Trans>
          </Label>
          <p
            id={`${provider}-account-filter-description`}
            className="text-muted-foreground mt-0.5 text-xs leading-relaxed"
          >
            {restricted ? (
              <Trans>Ticked accounts are logged. Everyone else is ignored.</Trans>
            ) : (
              <Trans>
                Every account on this server is logged. Turn this on to start with every account
                seen here, then untick the ones you don't want.
              </Trans>
            )}
          </p>
        </div>
        <Switch
          id={`${provider}-account-filter`}
          aria-describedby={`${provider}-account-filter-description`}
          checked={restricted}
          // Never lock someone out of turning an existing restriction off, even when no
          // account has been seen yet.
          disabled={busy || (accounts.length === 0 && !restricted)}
          onCheckedChange={(checked) => {
            // Turning the filter on starts from "every account seen so far": no account
            // is singled out or silently dropped, you untick the ones you don't want.
            // Turning it off removes the restriction entirely.
            commit(checked ? accounts.map((account) => account.accountId) : null);
          }}
        />
      </div>

      {accounts.length === 0 ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          <Trans>
            No accounts seen yet. They appear here the first time they play something — even when
            their plays are ignored.
          </Trans>
        </p>
      ) : (
        <ul className="space-y-2">
          {accounts.map((account) => {
            const id = `${provider}-account-${account.accountId}`;
            return (
              <li key={account.accountId} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={restricted && selected.has(account.accountId)}
                  disabled={!restricted || busy}
                  onCheckedChange={(checked) => toggleAccount(account.accountId, checked === true)}
                />
                <Label
                  htmlFor={id}
                  className="min-w-0 flex-1 cursor-pointer truncate text-sm font-normal"
                >
                  {account.accountName ?? account.accountId}
                </Label>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatRelativeTime(account.lastSeenAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {restricted && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {selected.size === 0 ? (
            <Trans>Nobody's plays will be logged until you tick an account.</Trans>
          ) : (
            <Trans>
              Other accounts keep showing up here and in the event list, but their plays are never
              logged.
            </Trans>
          )}
        </p>
      )}
    </div>
  );
}
