import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  User,
  Radio,
  ChevronDown,
  Filter as FilterIcon,
} from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import pool from "@/services/relay-pool";
import { RelayLink } from "./nostr/RelayLink";
import { FilterSummaryBadges } from "./nostr/FilterSummaryBadges";
import { KindBadge } from "./KindBadge";
import { UserName } from "./nostr/UserName";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { NostrFilter } from "@/types/nostr";
import { resolveFilterAliases, getTagValues } from "@/lib/nostr-utils";
import { formatTimeRange } from "@/lib/filter-formatters";
import type { Subscription } from "rxjs";
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
  approximate?: boolean;
  error?: string;
}

/**
 * Hook to perform COUNT requests using the relay pool
 */
function useCount(filter: NostrFilter, relays: string[]) {
  const [results, setResults] = useState<Map<string, RelayCountResult>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);
  const subscriptionRef = useRef<Subscription | null>(null);

  const executeCount = useCallback(() => {
    // Clean up any previous subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }

    setLoading(true);

    // Initialize all relays as loading
    const initialResults = new Map<string, RelayCountResult>();
    for (const url of relays) {
      initialResults.set(url, { url, status: "loading" });
    }
    setResults(initialResults);

    // Use pool.count() which returns Observable<Record<string, CountResponse>>
    // This handles connection management, retries, and timeouts automatically
    // Cast filter to nostr-tools Filter type for compatibility
    subscriptionRef.current = pool.count(relays, filter as Filter).subscribe({
      next: (countResults) => {
        // countResults is Record<string, { count: number }>
        setResults((prev) => {
          const next = new Map(prev);
          for (const [url, response] of Object.entries(countResults)) {
            next.set(url, {
              url,
              status: "success",
              count: response.count,
            });
          }
          return next;
        });
      },
      error: (error) => {
        // Handle error for relays that failed
        setResults((prev) => {
          const next = new Map(prev);
          // Mark all still-loading relays as errored
          for (const [url, result] of next) {
            if (result.status === "loading") {
              next.set(url, {
                url,
                status: "error",
                error: error?.message || "Request failed",
              });
            }
          }
          return next;
        });
        setLoading(false);
      },
      complete: () => {
        // Mark any relays that didn't respond as unsupported/error
        setResults((prev) => {
          const next = new Map(prev);
          for (const [url, result] of next) {
            if (result.status === "loading") {
              next.set(url, {
                url,
                status: "unsupported",
                error: "Relay did not respond - may not support NIP-45",
              });
            }
          }
          return next;
        });
        setLoading(false);
      },
    });
  }, [filter, relays]);

  useEffect(() => {
    executeCount();

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }
    };
  }, [executeCount]);

  return { results, loading, refresh: executeCount };
}

interface QueryHeaderProps {
  filter: NostrFilter;
  relays: string[];
  loading: boolean;
  onRefresh: () => void;
}

function QueryHeader({ filter, relays, loading, onRefresh }: QueryHeaderProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [relaysOpen, setRelaysOpen] = useState(false);

  const authorPubkeys = filter.authors || [];
  const pTagPubkeys = filter["#p"] || [];
  const tTags = filter["#t"] || [];

  return (
    <div className="border-b border-border px-4 py-3 bg-muted/30 space-y-2">
      {/* Summary line */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Human-readable kinds */}
        {filter.kinds && filter.kinds.length > 0 && (
          <div className="flex items-center gap-1">
            {filter.kinds.slice(0, 3).map((kind) => (
              <KindBadge
                key={kind}
                kind={kind}
                iconClassname="size-3"
                className="text-xs"
              />
            ))}
            {filter.kinds.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{filter.kinds.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Authors */}
        {authorPubkeys.length > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">by</span>
            {authorPubkeys.slice(0, 2).map((pubkey) => (
              <UserName key={pubkey} pubkey={pubkey} className="text-xs" />
            ))}
            {authorPubkeys.length > 2 && (
              <span className="text-muted-foreground">
                +{authorPubkeys.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Mentions */}
        {pTagPubkeys.length > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">mentioning</span>
            {pTagPubkeys.slice(0, 2).map((pubkey) => (
              <UserName
                key={pubkey}
                pubkey={pubkey}
                isMention
                className="text-xs"
              />
            ))}
            {pTagPubkeys.length > 2 && (
              <span className="text-muted-foreground">
                +{pTagPubkeys.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Hashtags */}
        {tTags.length > 0 && (
          <div className="flex items-center gap-1">
            {tTags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded"
              >
                #{tag}
              </span>
            ))}
            {tTags.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{tTags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Time range */}
        {(filter.since || filter.until) && (
          <span className="text-xs text-muted-foreground">
            {formatTimeRange(filter.since, filter.until)}
          </span>
        )}

        {/* Search */}
        {filter.search && (
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
            "{filter.search}"
          </code>
        )}

        {/* Refresh button */}
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-7 px-2"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {/* Collapsible sections */}
      <div className="flex gap-4 text-xs">
        {/* Filter dropdown */}
        <Collapsible open={filterOpen} onOpenChange={setFilterOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <FilterIcon className="size-3" />
            <span>Filter</span>
            <ChevronDown
              className={`size-3 transition-transform ${filterOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <FilterSummaryBadges filter={filter} />
          </CollapsibleContent>
        </Collapsible>

        {/* Relays dropdown */}
        <Collapsible open={relaysOpen} onOpenChange={setRelaysOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <Radio className="size-3" />
            <span>
              {relays.length} relay{relays.length !== 1 ? "s" : ""}
            </span>
            <ChevronDown
              className={`size-3 transition-transform ${relaysOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="flex flex-wrap gap-2">
              {relays.map((url) => (
                <RelayLink key={url} url={url} className="text-xs" />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
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
    <div className="flex flex-col items-center justify-center py-16">
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
      <QueryHeader
        filter={filter}
        relays={relays}
        loading={loading}
        onRefresh={refresh}
      />

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
