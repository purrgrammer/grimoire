import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  User,
  Wifi,
  Filter as FilterIcon,
  Code,
  ChevronDown,
  Ban,
} from "lucide-react";
import { firstValueFrom, timeout, catchError, of } from "rxjs";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import pool from "@/services/relay-pool";
import { getRelayInfo } from "@/lib/nip11";
import { RelayLink } from "./nostr/RelayLink";
import { FilterSummaryBadges } from "./nostr/FilterSummaryBadges";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { useCopy } from "@/hooks/useCopy";
import type { NostrFilter } from "@/types/nostr";
import { resolveFilterAliases, getTagValues } from "@/lib/nostr-utils";
import type { Filter } from "nostr-tools";

interface CountViewerProps {
  filter: NostrFilter;
  relays: string[];
  needsAccount?: boolean;
}

type CountStatus = "pending" | "loading" | "success" | "error" | "unsupported";

interface RelayCountResult {
  url: string;
  status: CountStatus;
  count?: number;
  error?: string;
}

const COUNT_TIMEOUT = 10000; // 10 second timeout per relay

/**
 * Check if relay supports NIP-45 via NIP-11 relay info
 * Returns: true = supported, false = not supported, null = unknown (couldn't fetch info)
 */
async function checkNip45Support(url: string): Promise<boolean | null> {
  try {
    const info = await getRelayInfo(url);
    if (!info) return null; // Couldn't fetch relay info
    if (!info.supported_nips) return null; // No NIP support info available
    return info.supported_nips.includes(45);
  } catch {
    return null; // Error fetching info
  }
}

/**
 * Perform a COUNT request to a single relay with timeout
 * First checks NIP-45 support via NIP-11, then makes the request
 */
async function countFromRelay(
  url: string,
  filter: NostrFilter,
): Promise<RelayCountResult> {
  try {
    // Check NIP-45 support first (uses cached relay info when available)
    const nip45Supported = await checkNip45Support(url);

    // If we know for sure the relay doesn't support NIP-45, return early
    if (nip45Supported === false) {
      return {
        url,
        status: "unsupported",
        error: "NIP-45 not supported (per relay info)",
      };
    }

    // Try the COUNT request
    const relay = pool.relay(url);
    const result = await firstValueFrom(
      relay.count(filter as Filter).pipe(
        timeout(COUNT_TIMEOUT),
        catchError((err) => {
          // Timeout or connection error
          if (err.name === "TimeoutError") {
            // If we couldn't check NIP-11, the timeout might mean no NIP-45 support
            const errorMsg =
              nip45Supported === null
                ? "Timeout - relay may not support NIP-45"
                : "Timeout - relay did not respond";
            return of({ count: -1, _error: errorMsg });
          }
          return of({
            count: -1,
            _error: err?.message || "Connection error",
          });
        }),
      ),
    );

    // Check if this was an error result
    if ("_error" in result) {
      return {
        url,
        status: "error",
        error: (result as { _error: string })._error,
      };
    }

    return {
      url,
      status: "success",
      count: result.count,
    };
  } catch (err) {
    return {
      url,
      status: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Hook to perform COUNT requests to multiple relays
 */
function useCount(filter: NostrFilter, relays: string[]) {
  const [results, setResults] = useState<Map<string, RelayCountResult>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(false);

  const executeCount = useCallback(async () => {
    abortRef.current = false;
    setLoading(true);

    // Initialize all relays as loading
    const initialResults = new Map<string, RelayCountResult>();
    for (const url of relays) {
      initialResults.set(url, { url, status: "loading" });
    }
    setResults(initialResults);

    // Execute count requests in parallel
    const promises = relays.map(async (url) => {
      const result = await countFromRelay(url, filter);
      if (!abortRef.current) {
        setResults((prev) => {
          const next = new Map(prev);
          next.set(url, result);
          return next;
        });
      }
      return result;
    });

    await Promise.all(promises);
    if (!abortRef.current) {
      setLoading(false);
    }
  }, [filter, relays]);

  useEffect(() => {
    executeCount();
    return () => {
      abortRef.current = true;
    };
  }, [executeCount]);

  return { results, loading, refresh: executeCount };
}

function RelayResultRow({ result }: { result: RelayCountResult }) {
  const statusIcon = useMemo(() => {
    switch (result.status) {
      case "loading":
        return (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        );
      case "success":
        return <CheckCircle2 className="size-4 text-green-500" />;
      case "unsupported":
        return <Ban className="size-4 text-yellow-500" />;
      case "error":
        return <AlertCircle className="size-4 text-destructive" />;
      default:
        return null;
    }
  }, [result.status]);

  return (
    <div className="flex items-center justify-between py-2 px-4 hover:bg-muted/30">
      <div className="flex items-center gap-2">
        {statusIcon}
        <RelayLink url={result.url} className="text-sm" />
      </div>

      <div className="flex items-center gap-2">
        {result.status === "success" && (
          <span className="font-mono text-lg font-semibold tabular-nums">
            {result.count?.toLocaleString()}
          </span>
        )}
        {result.status === "unsupported" && (
          <span className="text-sm text-yellow-600 dark:text-yellow-400">
            {result.error}
          </span>
        )}
        {result.status === "error" && (
          <Tooltip>
            <TooltipTrigger>
              <span className="text-sm text-destructive truncate max-w-48">
                {result.error}
              </span>
            </TooltipTrigger>
            <TooltipContent>{result.error}</TooltipContent>
          </Tooltip>
        )}
        {result.status === "loading" && (
          <span className="text-sm text-muted-foreground">counting...</span>
        )}
      </div>
    </div>
  );
}

function SingleRelayResult({ result }: { result: RelayCountResult }) {
  if (result.status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Counting events...</p>
      </div>
    );
  }

  if (result.status === "unsupported") {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Ban className="size-8 text-yellow-500" />
        <p className="text-yellow-600 dark:text-yellow-400">{result.error}</p>
      </div>
    );
  }

  if (result.status === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-destructive">{result.error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <span className="font-mono text-5xl font-bold tabular-nums">
        {result.count?.toLocaleString()}
      </span>
    </div>
  );
}

export default function CountViewer({
  filter: rawFilter,
  relays,
  needsAccount,
}: CountViewerProps) {
  const { state } = useGrimoire();
  const accountPubkey = state.activeAccount?.pubkey;
  const { copy: handleCopy, copied } = useCopy();

  // Create pointer for contact list (kind 3) if we need to resolve $contacts
  const contactPointer = useMemo(
    () =>
      needsAccount && accountPubkey
        ? { kind: 3, pubkey: accountPubkey, identifier: "" }
        : undefined,
    [needsAccount, accountPubkey],
  );

  // Fetch contact list (kind 3) if needed for $contacts resolution
  const contactListEvent = useNostrEvent(contactPointer);

  // Extract contacts from kind 3 event
  const contacts = useMemo(
    () =>
      contactListEvent
        ? getTagValues(contactListEvent, "p").filter((pk) => pk.length === 64)
        : [],
    [contactListEvent],
  );

  // Resolve $me and $contacts aliases
  const filter = useMemo(
    () =>
      needsAccount
        ? resolveFilterAliases(rawFilter, accountPubkey, contacts)
        : rawFilter,
    [needsAccount, rawFilter, accountPubkey, contacts],
  );

  const { results, loading, refresh } = useCount(filter, relays);

  const isSingleRelay = relays.length === 1;
  const singleResult = isSingleRelay ? results.get(relays[0]) : null;

  // Calculate totals for header
  const successCount = Array.from(results.values()).filter(
    (r) => r.status === "success",
  ).length;

  return (
    <div className="h-full flex flex-col">
      {/* Compact Header - matches ReqViewer style */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between">
        {/* Left: Status */}
        <div className="flex items-center gap-2">
          {loading ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : (
            <CheckCircle2 className="size-3 text-green-500" />
          )}
          <span className="text-muted-foreground">
            {loading
              ? "Counting..."
              : `${successCount}/${relays.length} relays`}
          </span>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-3">
          {/* Filter Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                <FilterIcon className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-0">
              <div className="p-3 space-y-3">
                <FilterSummaryBadges filter={filter} />
                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
                    <Code className="size-3" />
                    Raw Query JSON
                    <ChevronDown className="size-3 ml-auto" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="relative mt-2">
                      <SyntaxHighlight
                        code={JSON.stringify(filter, null, 2)}
                        language="json"
                        className="bg-muted/50 p-3 pr-10 overflow-x-auto border border-border/40 rounded text-[11px]"
                      />
                      <CodeCopyButton
                        onCopy={() =>
                          handleCopy(JSON.stringify(filter, null, 2))
                        }
                        copied={copied}
                        label="Copy query JSON"
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Relay Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                <Wifi className="size-3" />
                <span>{relays.length}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-3">
              <div className="text-xs font-semibold text-muted-foreground mb-2">
                Relays ({relays.length})
              </div>
              <div className="space-y-1">
                {relays.map((url) => (
                  <RelayLink key={url} url={url} className="text-xs block" />
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Refresh Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={refresh}
                disabled={loading}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`size-3 ${loading ? "animate-spin" : ""}`}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh counts</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Account Required Message */}
      {needsAccount && !accountPubkey && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground text-center">
            <User className="size-12 mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-2">Account Required</h3>
            <p className="text-sm max-w-md">
              This query uses{" "}
              <code className="bg-muted px-1.5 py-0.5">$me</code> or{" "}
              <code className="bg-muted px-1.5 py-0.5">$contacts</code> aliases
              and requires an active account.
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {(!needsAccount || accountPubkey) && (
        <div className="flex-1 overflow-auto">
          {isSingleRelay && singleResult ? (
            <SingleRelayResult result={singleResult} />
          ) : (
            <div className="divide-y divide-border">
              {relays.map((url) => {
                const result = results.get(url) || {
                  url,
                  status: "pending" as const,
                };
                return <RelayResultRow key={url} result={result} />;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
