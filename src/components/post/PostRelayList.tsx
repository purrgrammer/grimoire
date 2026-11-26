import { Check, Circle, Loader2, Server, ServerOff, X } from "lucide-react";
import { use$ } from "applesauce-react/hooks";
import { Checkbox } from "@/components/ui/checkbox";
import { RelayLink } from "@/components/nostr/RelayLink";
import { useRelayState } from "@/hooks/useRelayState";
import { getAuthIcon } from "@/lib/relay-status-utils";
import pool from "@/services/relay-pool";
import type { RelayPublishStatus } from "@/services/publish-service";
import {
  isRowSelected,
  type RelayOverrides,
  type RelayRow,
} from "@/lib/post-relays";

export interface RelayPublishState {
  status: RelayPublishStatus;
  error?: string;
}

interface PostRelayRowProps {
  row: RelayRow;
  overrides: RelayOverrides;
  publish?: RelayPublishState;
  disabled: boolean;
  retryDisabled: boolean;
  onToggle: (url: string, selected: boolean) => void;
  onRetry: (url: string) => void;
}

/** Why a row is here, in words. Empty for the plain "your relay" case. */
function rowReasons(row: RelayRow): string[] {
  const reasons: string[] = [];
  if (row.origins.some((o) => o.type === "manual"))
    reasons.push("added by you");
  if (row.origins.some((o) => o.type === "fallback"))
    reasons.push("default relay");
  return reasons;
}

export function PostRelayRow({
  row,
  overrides,
  publish,
  disabled,
  retryDisabled,
  onToggle,
  onRetry,
}: PostRelayRowProps) {
  const relayPoolMap = use$(pool.relays$);
  const { getRelay } = useRelayState();
  const isConnected = relayPoolMap?.get(row.url)?.connected ?? false;
  const authIcon = getAuthIcon(getRelay(row.url));
  const selected = isRowSelected(row, overrides);
  const status = publish?.status ?? "pending";
  const reasons = rowReasons(row);

  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <Checkbox
          id={row.url}
          className="mt-0.5"
          checked={selected}
          onCheckedChange={(checked) => onToggle(row.url, checked === true)}
          disabled={disabled}
        />
        <div className="hidden sm:flex items-center gap-2 mt-0.5">
          {isConnected ? (
            <Server className="h-3 w-3 text-green-500 flex-shrink-0" />
          ) : (
            <ServerOff className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
          <div className="flex-shrink-0" title={authIcon.label}>
            {authIcon.icon}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <label
            htmlFor={row.url}
            className="cursor-pointer truncate block"
            onClick={(e) => e.preventDefault()}
          >
            <RelayLink
              url={row.url}
              write={true}
              showInboxOutbox={false}
              className="text-sm"
            />
          </label>
          {reasons.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {reasons.join(", ")}
            </p>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 w-6 flex items-center justify-center mt-0.5">
        {status === "pending" && (
          <Circle className="h-4 w-4 text-muted-foreground" />
        )}
        {status === "publishing" && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {status === "success" && <Check className="h-4 w-4 text-green-500" />}
        {status === "error" && (
          <button
            onClick={() => onRetry(row.url)}
            disabled={retryDisabled}
            className="p-0.5 rounded hover:bg-red-500/10 transition-colors"
            title={`${publish?.error || "Failed to publish"}. Click to retry.`}
            aria-label={`Retry ${row.url}`}
          >
            <X className="h-4 w-4 text-red-500" />
          </button>
        )}
      </div>
    </div>
  );
}
