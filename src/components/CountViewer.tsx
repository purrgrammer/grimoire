import { useState, useMemo } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Copy,
  Download,
  Sparkles,
} from "lucide-react";
import { useCountQuery, type CountResult } from "@/hooks/useCountQuery";
import { useGrimoire } from "@/core/state";
import type { NostrFilter } from "@/types/nostr";
import { RelayLink } from "./nostr/RelayLink";
import { Button } from "./ui/button";
import { KindBadge } from "./KindBadge";
import { UserName } from "./nostr/UserName";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useCopy } from "@/hooks/useCopy";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import { resolveFilterAliases, getTagValues } from "@/lib/nostr-utils";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import {
  formatEventIds,
  formatDTags,
  formatTimeRange,
  formatHashtags,
} from "@/lib/filter-formatters";

export interface CountViewerProps {
  filter: NostrFilter;
  relays?: string[];
  nip05Authors?: string[];
  nip05PTags?: string[];
  nip05PTagsUppercase?: string[];
  needsAccount?: boolean;
  title?: string;
}

/**
 * Get status icon for a count result
 */
function getStatusIcon(result: CountResult) {
  switch (result.status) {
    case "loading":
      return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
    case "success":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "error":
    case "closed":
      return <XCircle className="size-4 text-red-500" />;
    default:
      return <AlertCircle className="size-4 text-yellow-500" />;
  }
}

/**
 * Format count with thousands separators
 */
function formatCount(count: number | null): string {
  if (count === null) return "—";
  return count.toLocaleString();
}

export function CountViewer({
  filter,
  relays = [],
  needsAccount,
}: CountViewerProps) {
  const { state } = useGrimoire();
  const [filterOpen, setFilterOpen] = useState(false);
  const { copy: handleCopy, copied } = useCopy();

  // Get active account for alias resolution
  const activeAccount = state.activeAccount;
  const accountPubkey = activeAccount?.pubkey;

  // Memoize contact list pointer to prevent unnecessary re-subscriptions
  const contactPointer = useMemo(
    () =>
      needsAccount && accountPubkey
        ? { kind: 3, pubkey: accountPubkey, identifier: "" }
        : undefined,
    [needsAccount, accountPubkey],
  );

  // Fetch contact list (kind 3) if needed for $contacts resolution
  const contactListEvent = useNostrEvent(contactPointer);

  // Extract contact pubkeys from kind 3 event
  const contacts = useMemo(() => {
    if (!contactListEvent) return [];
    return getTagValues(contactListEvent, "p").filter(
      (pk): pk is string => typeof pk === "string" && pk.length === 64,
    );
  }, [contactListEvent]);

  // Resolve filter aliases ($me, $contacts) if needed
  const resolvedFilter = useMemo(() => {
    if (!needsAccount || !accountPubkey) {
      return filter;
    }

    return resolveFilterAliases(filter, accountPubkey, contacts);
  }, [filter, needsAccount, accountPubkey, contacts]);

  // Query relays for counts
  const { results, error } = useCountQuery(
    `count-${JSON.stringify(filter)}`,
    resolvedFilter,
    relays,
  );

  // Calculate total count (sum of all successful relay counts)
  const totalCount = useMemo(() => {
    return results
      .filter((r) => r.status === "success" && r.count !== null)
      .reduce((sum, r) => sum + (r.count || 0), 0);
  }, [results]);

  // Count approximate results
  const approximateCount = results.filter((r) => r.approximate).length;

  // Handle copy results
  const handleCopyResults = () => {
    const text = results
      .map((r) => `${r.relay}: ${formatCount(r.count)}`)
      .join("\n");
    handleCopy(text);
  };

  // Handle export JSON
  const handleExportJSON = () => {
    const data = {
      filter: resolvedFilter,
      relays,
      results: results.map((r) => ({
        relay: r.relay,
        count: r.count,
        approximate: r.approximate,
        status: r.status,
      })),
      totalCount,
      timestamp: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `count-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Extract tag filters for display
  const authorPubkeys = Array.isArray(filter.authors) ? filter.authors : [];
  const pTagPubkeys = Array.isArray(filter["#p"]) ? filter["#p"] : [];
  const eTags = Array.isArray(filter["#e"]) ? filter["#e"] : undefined;
  const tTags = Array.isArray(filter["#t"]) ? filter["#t"] : undefined;
  const dTags = Array.isArray(filter["#d"]) ? filter["#d"] : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Header with total count */}
      <div className="border-b border-border px-4 py-6 bg-muted/30">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-4xl font-bold tabular-nums">
              {formatCount(totalCount)}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {results.length} relay{results.length !== 1 ? "s" : ""}
              {approximateCount > 0 && (
                <span>
                  {" "}
                  · {approximateCount} approximate
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyResults}
                >
                  {copied ? (
                    <CheckCircle2 className="size-4 text-green-500" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy results</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleExportJSON}
                >
                  <Download className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export JSON</TooltipContent>
            </Tooltip>

            <Button variant="outline" size="sm" className="gap-2">
              <Sparkles className="size-4" />
              Save as Spell
            </Button>
          </div>
        </div>
      </div>

      {/* Per-relay results */}
      <div className="flex-1 overflow-auto">
        <div className="p-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              Per-Relay Results
            </h3>

            {results.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No relays configured
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">
                        Status
                      </th>
                      <th className="text-left px-4 py-2 font-medium">Relay</th>
                      <th className="text-right px-4 py-2 font-medium">
                        Count
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result) => (
                      <tr
                        key={result.relay}
                        className="border-t border-border hover:bg-muted/30"
                      >
                        <td className="px-4 py-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center">
                                {getStatusIcon(result)}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              {result.status === "error" && result.error
                                ? result.error
                                : result.status}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3">
                          <RelayLink url={result.relay} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className="font-medium">
                            {formatCount(result.count)}
                          </span>
                          {result.approximate && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="ml-2 text-muted-foreground">
                                  ~
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                Approximate count (probabilistic)
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Filter Summary */}
          <Collapsible
            open={filterOpen}
            onOpenChange={setFilterOpen}
            className="mt-6"
          >
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                <span className="text-sm font-medium">Filter Details</span>
                <ChevronDown
                  className={`size-4 transition-transform ${filterOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-3">
              {/* Kinds */}
              {filter.kinds && filter.kinds.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Kinds
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {filter.kinds.map((kind) => (
                      <KindBadge key={kind} kind={kind} />
                    ))}
                  </div>
                </div>
              )}

              {/* Authors */}
              {authorPubkeys.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Authors
                  </div>
                  <div className="space-y-1">
                    {authorPubkeys.slice(0, 5).map((pubkey) => (
                      <div key={pubkey} className="text-sm">
                        <UserName pubkey={pubkey} />
                      </div>
                    ))}
                    {authorPubkeys.length > 5 && (
                      <div className="text-xs text-muted-foreground">
                        +{authorPubkeys.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* #p tags (mentions) */}
              {pTagPubkeys.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Mentions (#p)
                  </div>
                  <div className="space-y-1">
                    {pTagPubkeys.slice(0, 5).map((pubkey) => (
                      <div key={pubkey} className="text-sm">
                        <UserName pubkey={pubkey} />
                      </div>
                    ))}
                    {pTagPubkeys.length > 5 && (
                      <div className="text-xs text-muted-foreground">
                        +{pTagPubkeys.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Time range */}
              {(filter.since || filter.until) && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Time Range
                  </div>
                  <div className="text-sm">
                    {formatTimeRange(filter.since, filter.until)}
                  </div>
                </div>
              )}

              {/* Search */}
              {filter.search && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Search
                  </div>
                  <div className="text-sm font-mono bg-muted px-2 py-1 rounded">
                    {filter.search}
                  </div>
                </div>
              )}

              {/* Other tags */}
              {(eTags || tTags || dTags) && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Tags
                  </div>
                  <div className="text-sm space-y-1">
                    {eTags && (
                      <div>
                        <span className="text-muted-foreground">#e:</span>{" "}
                        {formatEventIds(eTags)}
                      </div>
                    )}
                    {tTags && (
                      <div>
                        <span className="text-muted-foreground">#t:</span>{" "}
                        {formatHashtags(tTags)}
                      </div>
                    )}
                    {dTags && (
                      <div>
                        <span className="text-muted-foreground">#d:</span>{" "}
                        {formatDTags(dTags)}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Raw filter JSON */}
              <div className="relative">
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  Filter JSON
                </div>
                <div className="relative">
                  <CodeCopyButton
                    onCopy={() => handleCopy(JSON.stringify(resolvedFilter, null, 2))}
                    copied={copied}
                  />
                  <SyntaxHighlight
                    language="json"
                    code={JSON.stringify(resolvedFilter, null, 2)}
                    className="text-xs"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="border-t border-border px-4 py-3 bg-red-500/10">
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="size-4" />
            <span>{String(error.message || error)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
