import { useState, memo, useCallback, useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Radio,
  FileText,
  Wifi,
  Filter as FilterIcon,
  Download,
  Clock,
  User,
  Hash,
  Search,
  Code,
  Loader2,
  Mail,
  Send,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useReqTimeline } from "@/hooks/useReqTimeline";
import { useGrimoire } from "@/core/state";
import { useRelayState } from "@/hooks/useRelayState";
import { useOutboxRelays } from "@/hooks/useOutboxRelays";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { FeedEvent } from "./nostr/Feed";
import { KindBadge } from "./KindBadge";
import { UserName } from "./nostr/UserName";
import { TimelineSkeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import { RelayLink } from "./nostr/RelayLink";
import type { NostrFilter } from "@/types/nostr";
import {
  formatEventIds,
  formatDTags,
  formatTimeRange,
  formatGenericTag,
  formatHashtags,
} from "@/lib/filter-formatters";
import { sanitizeFilename } from "@/lib/filename-utils";
import { useCopy } from "@/hooks/useCopy";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import { getConnectionIcon, getAuthIcon } from "@/lib/relay-status-utils";
import { resolveFilterAliases, getTagValues } from "@/lib/nostr-utils";
import { useNostrEvent } from "@/hooks/useNostrEvent";

// Memoized FeedEvent to prevent unnecessary re-renders during scroll
const MemoizedFeedEvent = memo(
  FeedEvent,
  (prev, next) => prev.event.id === next.event.id,
);

interface ReqViewerProps {
  filter: NostrFilter;
  relays?: string[];
  closeOnEose?: boolean;
  nip05Authors?: string[];
  nip05PTags?: string[];
  needsAccount?: boolean;
  title?: string;
}

interface QueryDropdownProps {
  filter: NostrFilter;
  nip05Authors?: string[];
  nip05PTags?: string[];
}

function QueryDropdown({ filter, nip05Authors }: QueryDropdownProps) {
  const { copy: handleCopy, copied } = useCopy();

  // Expandable lists state
  const [showAllAuthors, setShowAllAuthors] = useState(false);
  const [showAllPTags, setShowAllPTags] = useState(false);
  const [showAllETags, setShowAllETags] = useState(false);
  const [showAllTTags, setShowAllTTags] = useState(false);

  // Get pubkeys for authors and #p tags
  const authorPubkeys = filter.authors || [];
  const pTagPubkeys = filter["#p"] || [];

  // Extract tag filters
  const eTags = filter["#e"];
  const tTags = filter["#t"];
  const dTags = filter["#d"];

  // Find generic tags (exclude #e, #p, #t, #d)
  const genericTags = Object.entries(filter)
    .filter(
      ([key]) =>
        key.startsWith("#") &&
        key.length === 2 &&
        !["#e", "#p", "#t", "#d"].includes(key),
    )
    .map(([key, values]) => ({ letter: key[1], values: values as string[] }));

  // Calculate summary counts (excluding #p which is shown separately as mentions)
  const tagCount =
    (eTags?.length || 0) +
    (tTags?.length || 0) +
    (dTags?.length || 0) +
    genericTags.reduce((sum, tag) => sum + tag.values.length, 0);

  const mentionCount = pTagPubkeys.length;

  // Determine if we should use accordion for complex queries
  const isComplexQuery =
    (filter.kinds?.length || 0) +
      authorPubkeys.length +
      (filter.search ? 1 : 0) +
      tagCount >
    5;

  return (
    <div className="border-b border-border px-4 py-3 bg-muted/30 space-y-3">
      {/* Summary Header */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        {filter.kinds && filter.kinds.length > 0 && (
          <span className="flex items-center gap-1.5">
            <FileText className="size-3.5" />
            {filter.kinds.length} kind{filter.kinds.length !== 1 ? "s" : ""}
          </span>
        )}
        {authorPubkeys.length > 0 && (
          <span className="flex items-center gap-1.5">
            <User className="size-3.5" />
            {authorPubkeys.length} author
            {authorPubkeys.length !== 1 ? "s" : ""}
          </span>
        )}
        {mentionCount > 0 && (
          <span className="flex items-center gap-1.5">
            <User className="size-3.5" />
            {mentionCount} mention{mentionCount !== 1 ? "s" : ""}
          </span>
        )}
        {(filter.since || filter.until) && (
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" />
            time range
          </span>
        )}
        {filter.search && (
          <span className="flex items-center gap-1.5">
            <Search className="size-3.5" />
            search
          </span>
        )}
        {tagCount > 0 && (
          <span className="flex items-center gap-1.5">
            <Hash className="size-3.5" />
            {tagCount} tag{tagCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isComplexQuery ? (
        /* Accordion for complex queries */
        <Accordion
          type="multiple"
          defaultValue={["kinds", "authors", "mentions", "time", "search", "tags"]}
          className="space-y-2"
        >
          {/* Kinds Section */}
          {filter.kinds && filter.kinds.length > 0 && (
            <AccordionItem value="kinds" className="border-0">
              <AccordionTrigger className="py-2 hover:no-underline">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <FileText className="size-3.5 text-muted-foreground" />
                  Kinds ({filter.kinds.length})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex items-center gap-2 flex-wrap pl-5">
                  {filter.kinds.map((kind) => (
                    <KindBadge
                      key={kind}
                      kind={kind}
                      iconClassname="size-3"
                      className="text-xs"
                      clickable
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Time Range Section */}
          {(filter.since || filter.until) && (
            <AccordionItem value="time" className="border-0">
              <AccordionTrigger className="py-2 hover:no-underline">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Clock className="size-3.5 text-muted-foreground" />
                  Time Range
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="text-xs ml-5 text-muted-foreground">
                  {formatTimeRange(filter.since, filter.until)}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Search Section */}
          {filter.search && (
            <AccordionItem value="search" className="border-0">
              <AccordionTrigger className="py-2 hover:no-underline">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Search className="size-3.5 text-muted-foreground" />
                  Search
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="text-xs ml-5">
                  <code className="bg-muted/50 px-1.5 py-0.5">
                    "{filter.search}"
                  </code>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Authors Section */}
          {authorPubkeys.length > 0 && (
            <AccordionItem value="authors" className="border-0">
              <AccordionTrigger className="py-2 hover:no-underline">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <User className="size-3.5 text-muted-foreground" />
                  Authors ({authorPubkeys.length})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 ml-5">
                  <div className="flex flex-wrap gap-2">
                    {authorPubkeys
                      .slice(0, showAllAuthors ? undefined : 3)
                      .map((pubkey) => {
                        return (
                          <UserName
                            key={pubkey}
                            pubkey={pubkey}
                            className="text-xs"
                          />
                        );
                      })}
                  </div>
                  {authorPubkeys.length > 3 && (
                    <button
                      onClick={() => setShowAllAuthors(!showAllAuthors)}
                      className="text-xs text-primary hover:underline"
                    >
                      {showAllAuthors
                        ? "Show less"
                        : `Show all ${authorPubkeys.length}`}
                    </button>
                  )}
                  {nip05Authors && nip05Authors.length > 0 && (
                    <div className="text-xs space-y-0.5 text-muted-foreground">
                      {nip05Authors.map((nip05) => (
                        <div key={nip05}>→ {nip05}</div>
                      ))}
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Mentions Section */}
          {pTagPubkeys.length > 0 && (
            <AccordionItem value="mentions" className="border-0">
              <AccordionTrigger className="py-2 hover:no-underline">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <User className="size-3.5 text-muted-foreground" />
                  Mentions ({pTagPubkeys.length})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 ml-5">
                  <div className="flex flex-wrap gap-2">
                    {pTagPubkeys
                      .slice(0, showAllPTags ? undefined : 3)
                      .map((pubkey) => {
                        return (
                          <UserName
                            key={pubkey}
                            pubkey={pubkey}
                            isMention
                            className="text-xs"
                          />
                        );
                      })}
                  </div>
                  {pTagPubkeys.length > 3 && (
                    <button
                      onClick={() => setShowAllPTags(!showAllPTags)}
                      className="text-xs text-primary hover:underline"
                    >
                      {showAllPTags
                        ? "Show less"
                        : `Show all ${pTagPubkeys.length}`}
                    </button>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* Tags Section */}
          {tagCount > 0 && (
            <AccordionItem value="tags" className="border-0">
              <AccordionTrigger className="py-2 hover:no-underline">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Hash className="size-3.5 text-muted-foreground" />
                  Tags ({tagCount})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 ml-5">
                  {/* Event References (#e) */}
                  {eTags && eTags.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">
                        Event References ({eTags.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {eTags
                          .slice(0, showAllETags ? undefined : 3)
                          .map((eventId) => (
                            <div
                              key={eventId}
                              className="flex items-center gap-1.5 group"
                            >
                              <code className="text-xs">
                                {eventId.slice(0, 8)}...{eventId.slice(-4)}
                              </code>
                            </div>
                          ))}
                      </div>
                      {eTags.length > 3 && (
                        <button
                          onClick={() => setShowAllETags(!showAllETags)}
                          className="text-xs text-primary hover:underline"
                        >
                          {showAllETags
                            ? "Show less"
                            : `Show all ${eTags.length}`}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Hashtags (#t) */}
                  {tTags && tTags.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">
                        Hashtags ({tTags.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {tTags
                          .slice(0, showAllTTags ? undefined : 5)
                          .map((tag) => (
                            <span
                              key={tag}
                              className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                            >
                              #{tag}
                            </span>
                          ))}
                      </div>
                      {tTags.length > 5 && (
                        <button
                          onClick={() => setShowAllTTags(!showAllTTags)}
                          className="text-xs text-primary hover:underline"
                        >
                          {showAllTTags
                            ? "Show less"
                            : `Show all ${tTags.length}`}
                        </button>
                      )}
                    </div>
                  )}

                  {/* D-Tags (#d) */}
                  {dTags && dTags.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium">
                        D-Tags ({dTags.length})
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDTags(dTags, 5)}
                      </div>
                    </div>
                  )}

                  {/* Generic Tags */}
                  {genericTags.map((tag) => (
                    <div key={tag.letter} className="space-y-1">
                      <div className="text-xs font-medium">
                        #{tag.letter} Tags ({tag.values.length})
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatGenericTag(tag.letter, tag.values, 5).replace(
                          `#${tag.letter}: `,
                          "",
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      ) : (
        /* Simple cards for simple queries */
        <div className="space-y-3">
          {/* Kinds */}
          {filter.kinds && filter.kinds.length > 0 && (
            <div className="">
              <div className="flex items-center gap-2 text-xs font-semibold mb-1.5">
                <FileText className="size-3.5 text-muted-foreground" />
                Kinds ({filter.kinds.length})
              </div>
              <div className="flex items-center gap-2 flex-wrap ml-5">
                {filter.kinds.map((kind) => (
                  <KindBadge
                    key={kind}
                    kind={kind}
                    iconClassname="size-3"
                    className="text-xs"
                    clickable
                  />
                ))}
              </div>
            </div>
          )}

          {/* Time Range */}
          {(filter.since || filter.until) && (
            <div className="">
              <div className="flex items-center gap-2 text-xs font-semibold mb-1.5">
                <Clock className="size-3.5 text-muted-foreground" />
                Time Range
              </div>
              <div className="text-xs ml-5 text-muted-foreground">
                {formatTimeRange(filter.since, filter.until)}
              </div>
            </div>
          )}

          {/* Search */}
          {filter.search && (
            <div className="">
              <div className="flex items-center gap-2 text-xs font-semibold mb-1.5">
                <Search className="size-3.5 text-muted-foreground" />
                Search
              </div>
              <div className="text-xs ml-5">
                <code className="bg-muted/50 px-1.5 py-0.5 rounded">
                  "{filter.search}"
                </code>
              </div>
            </div>
          )}

          {/* Authors */}
          {authorPubkeys.length > 0 && (
            <div className="">
              <div className="flex items-center gap-2 text-xs font-semibold mb-1.5">
                <User className="size-3.5 text-muted-foreground" />
                Authors ({authorPubkeys.length})
              </div>
              <div className="ml-5 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {authorPubkeys
                    .slice(0, showAllAuthors ? undefined : 3)
                    .map((pubkey) => {
                      return (
                        <UserName
                          key={pubkey}
                          pubkey={pubkey}
                          className="text-xs"
                        />
                      );
                    })}
                </div>
                {authorPubkeys.length > 3 && (
                  <button
                    onClick={() => setShowAllAuthors(!showAllAuthors)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showAllAuthors
                      ? "Show less"
                      : `Show all ${authorPubkeys.length}`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Mentions */}
          {pTagPubkeys.length > 0 && (
            <div className="">
              <div className="flex items-center gap-2 text-xs font-semibold mb-1.5">
                <User className="size-3.5 text-muted-foreground" />
                Mentions ({pTagPubkeys.length})
              </div>
              <div className="ml-5 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {pTagPubkeys
                    .slice(0, showAllPTags ? undefined : 3)
                    .map((pubkey) => {
                      return (
                        <UserName
                          key={pubkey}
                          pubkey={pubkey}
                          isMention
                          className="text-xs"
                        />
                      );
                    })}
                </div>
                {pTagPubkeys.length > 3 && (
                  <button
                    onClick={() => setShowAllPTags(!showAllPTags)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showAllPTags
                      ? "Show less"
                      : `Show all ${pTagPubkeys.length}`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Tags (simplified for simple queries) */}
          {tagCount > 0 && (
            <div className="">
              <div className="flex items-center gap-2 text-xs font-semibold mb-1.5">
                <Hash className="size-3.5 text-muted-foreground" />
                Tags ({tagCount})
              </div>
              <div className="ml-5 text-xs text-muted-foreground space-y-1">
                {eTags && eTags.length > 0 && (
                  <div>Event refs: {formatEventIds(eTags, 3)}</div>
                )}
                {tTags && tTags.length > 0 && (
                  <div>Hashtags: {formatHashtags(tTags, 3)}</div>
                )}
                {dTags && dTags.length > 0 && (
                  <div>D-tags: {formatDTags(dTags, 3)}</div>
                )}
                {genericTags.map((tag) => (
                  <div key={tag.letter}>
                    #{tag.letter}:{" "}
                    {formatGenericTag(tag.letter, tag.values, 3).replace(
                      `#${tag.letter}: `,
                      "",
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Raw Query - Always at bottom */}
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
              className="bg-muted/50 p-3 pr-10 overflow-x-auto border border-border/40 rounded"
            />
            <CodeCopyButton
              onCopy={() => handleCopy(JSON.stringify(filter, null, 2))}
              copied={copied}
              label="Copy query JSON"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default function ReqViewer({
  filter,
  relays,
  closeOnEose = false,
  nip05Authors,
  nip05PTags,
  needsAccount = false,
  title = "nostr-events",
}: ReqViewerProps) {
  const { state, addWindow } = useGrimoire();
  const { relays: relayStates } = useRelayState();

  // Get active account for alias resolution
  const activeAccount = state.activeAccount;
  const accountPubkey = activeAccount?.pubkey;

  // Fetch contact list (kind 3) if needed for $contacts resolution
  const contactListEvent = useNostrEvent(
    needsAccount && accountPubkey
      ? { kind: 3, pubkey: accountPubkey, identifier: "" }
      : undefined,
  );

  // Extract contacts from kind 3 event (memoized to prevent unnecessary recalculation)
  const contacts = useMemo(
    () => contactListEvent
      ? getTagValues(contactListEvent, "p").filter((pk) => pk.length === 64)
      : [],
    [contactListEvent]
  );

  // Resolve $me and $contacts aliases (memoized to prevent unnecessary object creation)
  const resolvedFilter = useMemo(
    () => needsAccount
      ? resolveFilterAliases(filter, accountPubkey, contacts)
      : filter,
    [needsAccount, filter, accountPubkey, contacts]
  );

  // NIP-05 resolution already happened in argParser before window creation
  // The filter prop already contains resolved pubkeys
  // We just display the NIP-05 identifiers for user reference

  // NIP-65 outbox relay selection
  // Memoize fallbackRelays to prevent re-creation on every render
  const fallbackRelays = useMemo(
    () => state.activeAccount?.relays?.inbox.map((r) => r.url) || AGGREGATOR_RELAYS,
    [state.activeAccount?.relays?.inbox]
  );

  // Memoize outbox options to prevent object re-creation
  const outboxOptions = useMemo(
    () => ({
      fallbackRelays,
      timeout: 1000,
      maxRelays: 42,
    }),
    [fallbackRelays]
  );

  // Select optimal relays based on authors (write relays) and #p tags (read relays)
  const {
    relays: selectedRelays,
    reasoning,
    isOptimized,
    phase: relaySelectionPhase,
  } = useOutboxRelays(resolvedFilter, outboxOptions);

  // Use explicit relays if provided, otherwise use NIP-65 selected relays
  // Wait for relay selection to complete before subscribing to prevent multiple reconnections
  const finalRelays = useMemo(() => {
    // Explicit relays always used immediately
    if (relays) {
      return relays;
    }

    // Wait for outbox relay selection to complete before subscribing
    // This prevents multiple reconnections during discovery/selection phases
    if (relaySelectionPhase !== 'ready') {
      return [];
    }

    return selectedRelays;
  }, [relays, relaySelectionPhase, selectedRelays]);


  // Get relay state for each relay and calculate connected count
  const relayStatesForReq = useMemo(
    () => finalRelays.map((url) => ({
      url,
      state: relayStates[url],
    })),
    [finalRelays, relayStates]
  );
  const connectedCount = relayStatesForReq.filter(
    (r) => r.state?.connectionState === "connected",
  ).length;

  // Streaming is the default behavior, closeOnEose inverts it
  const stream = !closeOnEose;

  const { events, loading, error, eoseReceived } = useReqTimeline(
    `req-${JSON.stringify(filter)}-${closeOnEose}`,
    resolvedFilter,
    finalRelays,
    { limit: resolvedFilter.limit || 50, stream },
  );

  const [showQuery, setShowQuery] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFilename, setExportFilename] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  /**
   * Export events to JSONL format with chunked processing for large datasets
   * Uses Share API on mobile for reliable file sharing, falls back to download on desktop
   * Handles tens of thousands of events without blocking the UI
   */
  const handleExport = useCallback(async () => {
    if (!exportFilename.trim()) return;

    setIsExporting(true);
    setExportProgress(0);

    try {
      const sanitized = sanitizeFilename(exportFilename);
      const filename = `${sanitized}.jsonl`;
      const CHUNK_SIZE = 1000; // Process 1000 events at a time
      const shouldChunk = events.length > CHUNK_SIZE;

      // Build JSONL content with chunked processing for large datasets
      let content: string;

      if (shouldChunk) {
        // Chunked processing for large datasets
        const chunks: string[] = [];

        for (let i = 0; i < events.length; i += CHUNK_SIZE) {
          // Yield to browser to prevent UI blocking
          await new Promise((resolve) => setTimeout(resolve, 0));

          const chunk = events.slice(i, i + CHUNK_SIZE);
          const jsonlChunk = chunk.map((e) => JSON.stringify(e)).join("\n");
          chunks.push(jsonlChunk);

          // Update progress
          setExportProgress(
            Math.round(((i + chunk.length) / events.length) * 100),
          );
        }

        // Join chunks with newlines between them
        content = chunks.join("\n");
      } else {
        // Direct processing for small datasets
        content = events.map((e) => JSON.stringify(e)).join("\n");
      }

      // Create File object (required for Share API)
      const file = new File([content], filename, {
        type: "application/jsonl",
      });

      // Try Share API first (mobile-friendly, native UX)
      if (
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function"
      ) {
        try {
          // Check if we can actually share files
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: "Export Nostr Events",
              text: `${events.length} event${events.length !== 1 ? "s" : ""}`,
            });

            // Success! Close dialog
            setExportProgress(100);
            setIsExporting(false);
            setExportProgress(0);
            setShowExportDialog(false);
            return;
          }
        } catch (err) {
          // User cancelled share dialog (AbortError) - just close silently
          if (err instanceof Error && err.name === "AbortError") {
            setIsExporting(false);
            setExportProgress(0);
            setShowExportDialog(false);
            return;
          }
          // Other errors - fall through to traditional download
          console.warn("Share API failed, falling back to download:", err);
        }
      }

      // Fallback: Traditional blob download (desktop browsers)
      const blob = new Blob([content], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportProgress(100);
    } catch (error) {
      console.error("Export failed:", error);
      // Keep dialog open on error so user can retry
      setIsExporting(false);
      setExportProgress(0);
      return;
    }

    // Close dialog on success
    setIsExporting(false);
    setExportProgress(0);
    setShowExportDialog(false);
  }, [events, exportFilename]);

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Compact Header */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between">
        {/* Left: Status Indicator */}
        <div className="flex items-center gap-2">
          <Radio
            className={`size-3 ${
              relaySelectionPhase !== 'ready'
                ? "text-yellow-500 animate-pulse"
                : loading && eoseReceived && stream
                  ? "text-green-500 animate-pulse"
                  : loading && !eoseReceived
                    ? "text-yellow-500 animate-pulse"
                    : eoseReceived
                      ? "text-muted-foreground"
                      : "text-yellow-500 animate-pulse"
            }`}
          />
          <span
            className={`${
              relaySelectionPhase !== 'ready'
                ? "text-yellow-500"
                : loading && eoseReceived && stream
                  ? "text-green-500"
                  : loading && !eoseReceived
                    ? "text-yellow-500"
                    : eoseReceived
                      ? "text-muted-foreground"
                      : "text-yellow-500"
            } font-semibold`}
          >
            {relaySelectionPhase === 'discovering'
              ? "DISCOVERING RELAYS"
              : relaySelectionPhase === 'selecting'
                ? "SELECTING RELAYS"
                : loading && eoseReceived && stream
                  ? "LIVE"
                  : loading && !eoseReceived && events.length === 0
                    ? "CONNECTING"
                    : loading && !eoseReceived
                      ? "LOADING"
                      : eoseReceived
                        ? "CLOSED"
                        : "CONNECTING"}
          </span>
        </div>

        {/* Right: Stats */}
        <div className="flex items-center gap-3">
          {/* Event Count (Dropdown) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={`${events.length} event${events.length !== 1 ? "s" : ""}, click for export options`}
              >
                <FileText className="size-3" />
                <span>{events.length}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setExportFilename(title);
                  setShowExportDialog(true);
                }}
                disabled={events.length === 0}
              >
                <Download className="size-3 mr-2" />
                Export to JSONL
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Relay Count (Dropdown) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                <Wifi className="size-3" />
                <span>
                  {connectedCount}/{finalRelays.length}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
              {/* Connection Status */}
              <div className="py-1 border-b border-border">
                <div className="px-3 py-1 text-xs font-semibold text-muted-foreground">
                  Connection Status
                </div>
                {relayStatesForReq.map(({ url, state }) => {
                  const connIcon = getConnectionIcon(state);
                  const authIcon = getAuthIcon(state);

                  return (
                    <DropdownMenuItem
                      key={url}
                      className="flex items-center justify-between gap-2"
                    >
                      <RelayLink
                        url={url}
                        showInboxOutbox={false}
                        className="flex-1 min-w-0 hover:bg-transparent"
                        iconClassname="size-3"
                        urlClassname="text-xs"
                      />
                      <div
                        className="flex items-center gap-1.5 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {authIcon && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="cursor-help">{authIcon.icon}</div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{authIcon.label}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help">{connIcon.icon}</div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{connIcon.label}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </div>

              {/* Relay Selection */}
              {!relays && reasoning && reasoning.length > 0 && (
                <div className="py-2">
                  <div className="px-3 py-1 text-xs font-semibold text-muted-foreground">
                    Relay Selection
                    {isOptimized && (
                      <span className="ml-1.5 font-normal">
                        (
                        <button
                          className="text-accent underline decoration-dotted cursor-crosshair"
                          onClick={(e) => {
                            e.stopPropagation();
                            addWindow("nip", { number: "65" });
                          }}
                        >
                          NIP-65
                        </button>
                        )
                      </span>
                    )}
                  </div>

                  {/* Flat list of relays with icons and counts */}
                  <div className="px-3 py-1 space-y-1">
                    {reasoning.map((r, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs py-0.5"
                      >
                        <RelayLink
                          url={r.relay}
                          className="flex-1 truncate font-mono text-foreground/80"
                        />
                        <div className="flex items-center gap-2 flex-shrink-0 text-muted-foreground">
                          {r.readers.length > 0 && (
                            <div className="flex items-center gap-0.5">
                              <Mail className="w-3 h-3" />
                              <span>{r.readers.length}</span>
                            </div>
                          )}
                          {r.writers.length > 0 && (
                            <div className="flex items-center gap-0.5">
                              <Send className="w-3 h-3" />
                              <span>{r.writers.length}</span>
                            </div>
                          )}
                          {r.isFallback && (
                            <span className="text-[10px] text-muted-foreground/60">
                              fallback
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Query (Clickable) */}
          <button
            onClick={() => setShowQuery(!showQuery)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showQuery ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <FilterIcon className="size-3" />
          </button>
        </div>
      </div>

      {/* Expandable Query */}
      {showQuery && (
        <QueryDropdown
          filter={resolvedFilter}
          nip05Authors={nip05Authors}
          nip05PTags={nip05PTags}
        />
      )}

      {/* Error Display */}
      {error && (
        <div className="border-b border-border px-4 py-2 bg-destructive/10">
          <span className="text-xs font-mono text-destructive">
            Error: {error.message}
          </span>
        </div>
      )}

      {/* Account Required Error */}
      {needsAccount && !accountPubkey && (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
          <div className="text-muted-foreground">
            <User className="size-12 mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-2">Account Required</h3>
            <p className="text-sm max-w-md">
              This query uses <code className="bg-muted px-1.5 py-0.5">$me</code>{" "}
              or <code className="bg-muted px-1.5 py-0.5">$contacts</code>{" "}
              aliases and requires an active account.
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {(!needsAccount || accountPubkey) && (
        <div className="flex-1 overflow-y-auto">
          {/* Loading: Before EOSE received */}
          {loading && events.length === 0 && !eoseReceived && (
            <div className="p-4">
              <TimelineSkeleton count={5} />
            </div>
          )}

          {/* EOSE received, no events, not streaming */}
          {eoseReceived && events.length === 0 && !stream && !error && (
            <div className="text-center text-muted-foreground font-mono text-sm p-4">
              No events found matching filter
            </div>
          )}

          {/* EOSE received, no events, streaming (live mode) */}
          {eoseReceived && events.length === 0 && stream && (
            <div className="text-center text-muted-foreground font-mono text-sm p-4">
              Listening for new events...
            </div>
          )}

          {events.length > 0 && (
            <Virtuoso
              style={{ height: "100%" }}
              data={events}
              computeItemKey={(_index, item) => item.id}
              itemContent={(_index, event) => <MemoizedFeedEvent event={event} />}
            />
          )}
        </div>
      )}

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Events to JSONL</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {isExporting ? (
                <>
                  Exporting{" "}
                  <span className="font-semibold">{events.length}</span> event
                  {events.length !== 1 ? "s" : ""}...
                </>
              ) : (
                <>
                  Export <span className="font-semibold">{events.length}</span>{" "}
                  event{events.length !== 1 ? "s" : ""} as JSONL
                  (newline-delimited JSON).
                </>
              )}
            </div>
            {isExporting && events.length > 1000 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Processing events...</span>
                  <span>{exportProgress}%</span>
                </div>
                <Progress value={exportProgress} className="h-2" />
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="filename" className="text-sm font-medium">
                Filename
              </label>
              <Input
                id="filename"
                autoFocus
                value={exportFilename}
                onChange={(e) => setExportFilename(e.target.value)}
                placeholder="Enter filename"
                disabled={isExporting}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    exportFilename.trim() &&
                    !isExporting
                  ) {
                    handleExport();
                  }
                }}
              />
              <div className="text-xs text-muted-foreground">
                .jsonl extension will be added automatically
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowExportDialog(false)}
              disabled={isExporting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleExport}
              disabled={!exportFilename.trim() || isExporting}
            >
              {isExporting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="size-4 mr-2" />
                  Export
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
