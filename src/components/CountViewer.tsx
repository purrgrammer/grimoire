import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Filter as FilterIcon,
  Hash,
  User,
  Clock,
  Search,
  FileText,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { RelayLink } from "./nostr/RelayLink";
import { UserName } from "./nostr/UserName";
import { KindBadge } from "./KindBadge";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { NostrFilter } from "@/types/nostr";
import { resolveFilterAliases, getTagValues } from "@/lib/nostr-utils";
import {
  formatTimeRange,
  formatHashtags,
  formatGenericTag,
} from "@/lib/filter-formatters";

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
  approximate?: boolean;
  error?: string;
}

/**
 * Send a COUNT request to a relay and get the result
 */
async function sendCountRequest(
  relayUrl: string,
  filter: NostrFilter,
): Promise<RelayCountResult> {
  const queryId = `count-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    let resolved = false;

    const cleanup = () => {
      if (ws) {
        ws.close();
        ws = null;
      }
    };

    // Timeout after 10 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({
          url: relayUrl,
          status: "error",
          error: "Timeout - relay did not respond",
        });
      }
    }, 10000);

    try {
      // Convert wss:// to ws:// if needed for WebSocket constructor
      ws = new WebSocket(relayUrl);

      ws.onopen = () => {
        // Send COUNT request
        const countMsg = JSON.stringify(["COUNT", queryId, filter]);
        ws?.send(countMsg);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const [type, id, payload] = data;

          if (id !== queryId) return;

          if (type === "COUNT") {
            resolved = true;
            clearTimeout(timeout);
            cleanup();
            resolve({
              url: relayUrl,
              status: "success",
              count: payload.count,
              approximate: payload.approximate,
            });
          } else if (type === "CLOSED") {
            resolved = true;
            clearTimeout(timeout);
            cleanup();
            // payload is the reason string for CLOSED
            resolve({
              url: relayUrl,
              status: "error",
              error: payload || "Request closed by relay",
            });
          } else if (type === "NOTICE") {
            // Some relays send NOTICE for unsupported commands
            if (
              payload?.toLowerCase().includes("count") ||
              payload?.toLowerCase().includes("unknown") ||
              payload?.toLowerCase().includes("unsupported")
            ) {
              resolved = true;
              clearTimeout(timeout);
              cleanup();
              resolve({
                url: relayUrl,
                status: "unsupported",
                error: "Relay does not support COUNT (NIP-45)",
              });
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          resolve({
            url: relayUrl,
            status: "error",
            error: "Connection error",
          });
        }
      };

      ws.onclose = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          resolve({
            url: relayUrl,
            status: "error",
            error: "Connection closed unexpectedly",
          });
        }
      };
    } catch (error) {
      resolved = true;
      clearTimeout(timeout);
      cleanup();
      resolve({
        url: relayUrl,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}

/**
 * Hook to perform COUNT requests to multiple relays
 */
function useCount(filter: NostrFilter, relays: string[]) {
  const [results, setResults] = useState<Map<string, RelayCountResult>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);

  const executeCount = useCallback(async () => {
    setLoading(true);

    // Initialize all relays as pending
    const initialResults = new Map<string, RelayCountResult>();
    for (const url of relays) {
      initialResults.set(url, { url, status: "loading" });
    }
    setResults(initialResults);

    // Send COUNT requests in parallel
    const promises = relays.map(async (url) => {
      const result = await sendCountRequest(url, filter);
      setResults((prev) => {
        const next = new Map(prev);
        next.set(url, result);
        return next;
      });
      return result;
    });

    await Promise.all(promises);
    setLoading(false);
  }, [filter, relays]);

  // Execute on mount
  useEffect(() => {
    executeCount();
  }, [executeCount]);

  return { results, loading, refresh: executeCount };
}

function FilterSummary({ filter }: { filter: NostrFilter }) {
  const [isOpen, setIsOpen] = useState(true);

  const authorPubkeys = filter.authors || [];
  const pTagPubkeys = filter["#p"] || [];
  const tTags = filter["#t"];
  const dTags = filter["#d"];

  // Find generic tags
  const genericTags = Object.entries(filter)
    .filter(
      ([key]) =>
        key.startsWith("#") &&
        key.length === 2 &&
        !["#e", "#p", "#t", "#d", "#P"].includes(key),
    )
    .map(([key, values]) => ({ letter: key[1], values: values as string[] }));

  const tagCount =
    (filter["#e"]?.length || 0) +
    (tTags?.length || 0) +
    (dTags?.length || 0) +
    genericTags.reduce((sum, tag) => sum + tag.values.length, 0);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 hover:bg-muted/50 rounded px-2 -mx-2">
        {isOpen ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
        <FilterIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Filter</span>

        {/* Summary badges */}
        <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
          {filter.kinds && filter.kinds.length > 0 && (
            <span className="flex items-center gap-1">
              <FileText className="size-3" />
              {filter.kinds.length}
            </span>
          )}
          {authorPubkeys.length > 0 && (
            <span className="flex items-center gap-1">
              <User className="size-3" />
              {authorPubkeys.length}
            </span>
          )}
          {pTagPubkeys.length > 0 && (
            <span className="flex items-center gap-1">
              <User className="size-3" />@{pTagPubkeys.length}
            </span>
          )}
          {(filter.since || filter.until) && <Clock className="size-3" />}
          {filter.search && <Search className="size-3" />}
          {tagCount > 0 && (
            <span className="flex items-center gap-1">
              <Hash className="size-3" />
              {tagCount}
            </span>
          )}
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pl-6 pr-2 py-2 space-y-2 text-sm">
          {/* Kinds */}
          {filter.kinds && filter.kinds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-16">kinds:</span>
              <div className="flex flex-wrap gap-1">
                {filter.kinds.map((kind) => (
                  <KindBadge key={kind} kind={kind} />
                ))}
              </div>
            </div>
          )}

          {/* Authors */}
          {authorPubkeys.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-16">authors:</span>
              <div className="flex flex-wrap gap-1">
                {authorPubkeys.slice(0, 5).map((pubkey) => (
                  <span
                    key={pubkey}
                    className="bg-muted px-2 py-0.5 rounded text-xs"
                  >
                    <UserName pubkey={pubkey} />
                  </span>
                ))}
                {authorPubkeys.length > 5 && (
                  <span className="text-muted-foreground text-xs">
                    +{authorPubkeys.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* #p tags (mentions) */}
          {pTagPubkeys.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-16">#p:</span>
              <div className="flex flex-wrap gap-1">
                {pTagPubkeys.slice(0, 5).map((pubkey) => (
                  <span
                    key={pubkey}
                    className="bg-muted px-2 py-0.5 rounded text-xs"
                  >
                    <UserName pubkey={pubkey} />
                  </span>
                ))}
                {pTagPubkeys.length > 5 && (
                  <span className="text-muted-foreground text-xs">
                    +{pTagPubkeys.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Time range */}
          {(filter.since || filter.until) && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-16">time:</span>
              <span className="text-xs">
                {formatTimeRange(filter.since, filter.until)}
              </span>
            </div>
          )}

          {/* Search */}
          {filter.search && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-16">search:</span>
              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                {filter.search}
              </span>
            </div>
          )}

          {/* Hashtags */}
          {tTags && tTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-16">#t:</span>
              <span className="text-xs">{formatHashtags(tTags)}</span>
            </div>
          )}

          {/* Generic tags */}
          {genericTags.map(({ letter, values }) => (
            <div key={letter} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-16">#{letter}:</span>
              <span className="text-xs font-mono">
                {formatGenericTag(letter, values)}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
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
      case "error":
        return <AlertCircle className="size-4 text-destructive" />;
      case "unsupported":
        return <AlertCircle className="size-4 text-yellow-500" />;
      default:
        return null;
    }
  }, [result.status]);

  return (
    <div className="flex items-center justify-between py-2 px-3 hover:bg-muted/30 rounded">
      <div className="flex items-center gap-2">
        {statusIcon}
        <RelayLink url={result.url} />
      </div>

      <div className="flex items-center gap-2">
        {result.status === "success" && (
          <>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {result.count?.toLocaleString()}
            </span>
            {result.approximate && (
              <Tooltip>
                <TooltipTrigger>
                  <span className="text-muted-foreground text-sm">~</span>
                </TooltipTrigger>
                <TooltipContent>Approximate count</TooltipContent>
              </Tooltip>
            )}
          </>
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
        {result.status === "unsupported" && (
          <span className="text-sm text-yellow-600 dark:text-yellow-400">
            NIP-45 not supported
          </span>
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

  if (result.status === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-destructive">{result.error}</p>
      </div>
    );
  }

  if (result.status === "unsupported") {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <AlertCircle className="size-8 text-yellow-500" />
        <p className="text-yellow-600 dark:text-yellow-400">
          This relay does not support COUNT (NIP-45)
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-5xl font-bold tabular-nums">
          {result.count?.toLocaleString()}
        </span>
        {result.approximate && (
          <Tooltip>
            <TooltipTrigger>
              <span className="text-2xl text-muted-foreground">~</span>
            </TooltipTrigger>
            <TooltipContent>Approximate count</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="text-sm text-muted-foreground">events</p>
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 bg-muted/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isSingleRelay ? (
              <RelayLink url={relays[0]} />
            ) : (
              <span className="text-sm text-muted-foreground">
                {relays.length} relays
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading}
            className="h-8"
          >
            <RefreshCw
              className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
        <FilterSummary filter={filter} />
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
