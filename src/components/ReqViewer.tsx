import { useState, memo, useCallback, useMemo, useRef, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
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
  Inbox,
  Sparkles,
  Link as LinkIcon,
  Check,
  Target,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useReqTimelineEnhanced } from "@/hooks/useReqTimelineEnhanced";
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
import { normalizeRelayURL } from "@/lib/relay-url";
import {
  getStatusText,
  getStatusTooltip,
  getStatusColor,
  shouldAnimate,
} from "@/lib/req-state-machine";
import { resolveFilterAliases, getTagValues } from "@/lib/nostr-utils";
import { FilterSummaryBadges } from "./nostr/FilterSummaryBadges";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { MemoizedCompactEventRow } from "./nostr/CompactEventRow";
import type { ViewMode } from "@/lib/req-parser";

// Memoized FeedEvent to prevent unnecessary re-renders during scroll
const MemoizedFeedEvent = memo(
  FeedEvent,
  (prev, next) => prev.event.id === next.event.id,
);

/**
 * Compact event ID display in query dropdown
 * Shows truncated ID with click to open
 */
function EventIdPreview({ eventId }: { eventId: string }) {
  const { addWindow } = useGrimoire();

  const handleClick = useCallback(() => {
    addWindow("open", { pointer: { id: eventId } });
  }, [eventId, addWindow]);

  return (
    <code
      className="text-xs font-mono cursor-crosshair hover:text-primary transition-colors"
      onClick={handleClick}
    >
      {eventId.slice(0, 8)}...{eventId.slice(-4)}
    </code>
  );
}

interface ReqViewerProps {
  filter: NostrFilter;
  relays?: string[];
  closeOnEose?: boolean;
  view?: ViewMode;
  follow?: boolean; // Auto-refresh mode (like tail -f)
  nip05Authors?: string[];
  nip05PTags?: string[];
  domainAuthors?: string[];
  domainPTags?: string[];
  needsAccount?: boolean;
  title?: string;
}

interface QueryDropdownProps {
  filter: NostrFilter;
  nip05Authors?: string[];
  nip05PTags?: string[];
  domainAuthors?: string[];
  domainPTags?: string[];
}

function QueryDropdown({
  filter,
  nip05Authors,
  domainAuthors,
  domainPTags,
}: QueryDropdownProps) {
  const { copy: handleCopy, copied } = useCopy();

  // Expandable lists state
  const [showAllIds, setShowAllIds] = useState(false);
  const [showAllAuthors, setShowAllAuthors] = useState(false);
  const [showAllPTags, setShowAllPTags] = useState(false);
  const [showAllETags, setShowAllETags] = useState(false);
  const [showAllTTags, setShowAllTTags] = useState(false);

  // Get IDs for direct lookup (from -i flag)
  const eventIds = filter.ids || [];

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

  // Determine if we should use accordion for complex queries
  const isComplexQuery =
    (filter.kinds?.length || 0) +
      eventIds.length +
      authorPubkeys.length +
      (filter.search ? 1 : 0) +
      tagCount >
    5;

  return (
    <div className="border-b border-border px-4 py-3 bg-muted/30 space-y-3">
      {/* Summary Header */}
      <FilterSummaryBadges filter={filter} />

      {isComplexQuery ? (
        /* Accordion for complex queries */
        <Accordion
          type="multiple"
          defaultValue={[
            "kinds",
            "ids",
            "authors",
            "mentions",
            "time",
            "search",
            "tags",
          ]}
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

          {/* IDs Section (direct event lookup) */}
          {eventIds.length > 0 && (
            <AccordionItem value="ids" className="border-0">
              <AccordionTrigger className="py-2 hover:no-underline">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Target className="size-3.5 text-muted-foreground" />
                  Event IDs ({eventIds.length})
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-1 ml-5">
                  {eventIds
                    .slice(0, showAllIds ? undefined : 3)
                    .map((eventId) => (
                      <EventIdPreview key={eventId} eventId={eventId} />
                    ))}
                  {eventIds.length > 3 && (
                    <button
                      onClick={() => setShowAllIds(!showAllIds)}
                      className="text-xs text-primary hover:underline"
                    >
                      {showAllIds ? "Show less" : `Show all ${eventIds.length}`}
                    </button>
                  )}
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
                  {domainAuthors && domainAuthors.length > 0 && (
                    <div className="text-xs space-y-0.5 text-muted-foreground">
                      {domainAuthors.map((domain) => (
                        <div key={domain}>→ @{domain}</div>
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
                  {domainPTags && domainPTags.length > 0 && (
                    <div className="text-xs space-y-0.5 text-muted-foreground">
                      {domainPTags.map((domain) => (
                        <div key={domain}>→ @{domain}</div>
                      ))}
                    </div>
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

          {/* Event IDs (direct lookup) */}
          {eventIds.length > 0 && (
            <div className="">
              <div className="flex items-center gap-2 text-xs font-semibold mb-1.5">
                <Target className="size-3.5 text-muted-foreground" />
                Event IDs ({eventIds.length})
              </div>
              <div className="ml-5 space-y-1">
                {eventIds
                  .slice(0, showAllIds ? undefined : 3)
                  .map((eventId) => (
                    <EventIdPreview key={eventId} eventId={eventId} />
                  ))}
                {eventIds.length > 3 && (
                  <button
                    onClick={() => setShowAllIds(!showAllIds)}
                    className="text-xs text-primary hover:underline"
                  >
                    {showAllIds ? "Show less" : `Show all ${eventIds.length}`}
                  </button>
                )}
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
  view = "list",
  follow = false,
  nip05Authors,
  nip05PTags,
  domainAuthors,
  domainPTags,
  needsAccount = false,
  title = "nostr-events",
}: ReqViewerProps) {
  const { state, addWindow } = useGrimoire();
  const { relays: relayStates } = useRelayState();

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

  // Extract contacts from kind 3 event (memoized to prevent unnecessary recalculation)
  const contacts = useMemo(
    () =>
      contactListEvent
        ? getTagValues(contactListEvent, "p").filter((pk) => pk.length === 64)
        : [],
    [contactListEvent],
  );

  // Resolve $me and $contacts aliases (memoized to prevent unnecessary object creation)
  const resolvedFilter = useMemo(
    () =>
      needsAccount
        ? resolveFilterAliases(filter, accountPubkey, contacts)
        : filter,
    [needsAccount, filter, accountPubkey, contacts],
  );

  // NIP-05 resolution already happened in argParser before window creation
  // The filter prop already contains resolved pubkeys
  // We just display the NIP-05 identifiers for user reference

  // NIP-65 outbox relay selection
  // Memoize fallbackRelays to prevent re-creation on every render
  const fallbackRelays = useMemo(
    () =>
      state.activeAccount?.relays?.filter((r) => r.read).map((r) => r.url) ||
      AGGREGATOR_RELAYS,
    [state.activeAccount?.relays],
  );

  // Memoize outbox options to prevent object re-creation
  const outboxOptions = useMemo(
    () => ({
      fallbackRelays,
      timeout: 1000,
      maxRelays: 42,
    }),
    [fallbackRelays],
  );

  // Select optimal relays based on authors (write relays) and #p tags (read relays)
  const {
    relays: selectedRelays,
    reasoning,
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
    if (relaySelectionPhase !== "ready") {
      return [];
    }

    return selectedRelays;
  }, [relays, relaySelectionPhase, selectedRelays]);

  // Normalize relay URLs for consistent lookups in relayStates
  // RelayStateManager normalizes all URLs (adds trailing slash, lowercase, etc.)
  // so we must normalize here too to match the keys in relayStates
  const normalizedRelays = useMemo(() => {
    return finalRelays.map((url) => {
      try {
        return normalizeRelayURL(url);
      } catch (err) {
        console.warn("Failed to normalize relay URL:", url, err);
        return url; // Fallback to original URL if normalization fails
      }
    });
  }, [finalRelays]);

  // Streaming is the default behavior, closeOnEose inverts it
  const stream = !closeOnEose;

  const {
    events,
    loading,
    error,
    eoseReceived,
    relayStates: reqRelayStates,
    overallState,
  } = useReqTimelineEnhanced(
    `req-${JSON.stringify(filter)}-${closeOnEose}`,
    resolvedFilter,
    normalizedRelays,
    { limit: resolvedFilter.limit || 50, stream },
  );

  const [showQuery, setShowQuery] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFilename, setExportFilename] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Freeze timeline after EOSE to prevent auto-scrolling on new events
  const [freezePoint, setFreezePoint] = useState<string | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);
  const virtuosoRef = useRef<any>(null);

  // Freeze timeline after EOSE in streaming mode (skip if follow mode enabled)
  useEffect(() => {
    // Don't freeze in follow mode - show events as they arrive
    if (follow) return;

    // Freeze after EOSE in streaming mode
    if (eoseReceived && stream && !isFrozen && events.length > 0) {
      setFreezePoint(events[0].id);
      setIsFrozen(true);
    }

    // Reset freeze on query change (events cleared)
    if (events.length === 0) {
      setFreezePoint(null);
      setIsFrozen(false);
    }
  }, [follow, eoseReceived, stream, isFrozen, events]);

  // Filter events based on freeze point
  const { visibleEvents, newEventCount } = useMemo(() => {
    if (!isFrozen || !freezePoint) {
      return { visibleEvents: events, newEventCount: 0 };
    }

    const freezeIndex = events.findIndex((e) => e.id === freezePoint);
    return freezeIndex === -1
      ? { visibleEvents: events, newEventCount: 0 }
      : {
          visibleEvents: events.slice(freezeIndex),
          newEventCount: freezeIndex,
        };
  }, [events, isFrozen, freezePoint]);

  // Unfreeze handler - show new events and scroll to top
  const handleUnfreeze = useCallback(() => {
    setIsFrozen(false);
    setFreezePoint(null);
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: 0,
        align: "start",
        behavior: "smooth",
      });
    });
  }, []);

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
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 cursor-help">
              <Radio
                className={`size-3 ${getStatusColor(overallState.status)} ${
                  shouldAnimate(overallState.status) ? "animate-pulse" : ""
                }`}
              />
              <span
                className={`${getStatusColor(overallState.status)} font-semibold`}
              >
                {getStatusText(overallState)}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="bg-popover text-popover-foreground border border-border shadow-md">
            <p>{getStatusTooltip(overallState)}</p>
          </TooltipContent>
        </Tooltip>

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
                  {overallState.connectedCount}/{overallState.totalRelays}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-96 max-h-96 overflow-y-auto"
            >
              {/* Header: Relay Selection Strategy */}
              <div className="px-3 py-2 border-b border-border">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  {relays ? (
                    // Explicit relays
                    <>
                      <LinkIcon className="size-3 text-muted-foreground/60" />
                      <span>Explicit Relays ({finalRelays.length})</span>
                    </>
                  ) : reasoning && reasoning.some((r) => !r.isFallback) ? (
                    // NIP-65 Outbox
                    <>
                      <Sparkles className="size-3 text-muted-foreground/60" />
                      <span>
                        <button
                          className="text-accent underline decoration-dotted cursor-crosshair"
                          onClick={(e) => {
                            e.stopPropagation();
                            addWindow("nip", { number: "65" });
                          }}
                        >
                          NIP-65 Outbox
                        </button>{" "}
                        ({finalRelays.length} relays)
                      </span>
                    </>
                  ) : (
                    // Fallback relays
                    <>
                      <Inbox className="size-3 text-muted-foreground/60" />
                      <span>Fallback Relays ({finalRelays.length})</span>
                    </>
                  )}
                </div>
              </div>

              {(() => {
                // Group relays by connection status
                // Use normalizedRelays for lookups to match RelayStateManager's keys
                const onlineRelays: string[] = [];
                const disconnectedRelays: string[] = [];

                normalizedRelays.forEach((url) => {
                  const globalState = relayStates[url];
                  const isConnected =
                    globalState?.connectionState === "connected";

                  if (isConnected) {
                    onlineRelays.push(url);
                  } else {
                    disconnectedRelays.push(url);
                  }
                });

                const renderRelay = (url: string) => {
                  const globalState = relayStates[url];
                  const reqState = reqRelayStates.get(url);
                  const connIcon = getConnectionIcon(globalState);
                  const authIcon = getAuthIcon(globalState);

                  // Find NIP-65 info for this relay (if using outbox)
                  const nip65Info = reasoning?.find((r) => r.relay === url);

                  // Build comprehensive tooltip content
                  const tooltipContent = (
                    <div className="space-y-3 text-xs p-1">
                      <div className="font-mono font-bold border-b border-border pb-2 mb-2 break-all text-primary">
                        {url}
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                        <div className="space-y-0.5">
                          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">
                            Connection
                          </div>
                          <div className="flex items-center gap-1.5 font-medium">
                            <span className="shrink-0">{connIcon.icon}</span>
                            <span>{connIcon.label}</span>
                          </div>
                        </div>

                        <div className="space-y-0.5">
                          <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">
                            Authentication
                          </div>
                          <div className="flex items-center gap-1.5 font-medium">
                            <span className="shrink-0">{authIcon.icon}</span>
                            <span>{authIcon.label}</span>
                          </div>
                        </div>

                        {reqState && (
                          <>
                            <div className="space-y-0.5">
                              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">
                                Subscription
                              </div>
                              <div className="font-medium capitalize">
                                {reqState.subscriptionState}
                              </div>
                            </div>

                            <div className="space-y-0.5">
                              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">
                                Events
                              </div>
                              <div className="flex items-center gap-1.5 font-medium">
                                <FileText className="size-3 text-muted-foreground" />
                                <span>{reqState.eventCount} received</span>
                              </div>
                            </div>
                          </>
                        )}

                        {nip65Info && (
                          <>
                            {nip65Info.readers.length > 0 && (
                              <div className="space-y-0.5">
                                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">
                                  Inbox (Read)
                                </div>
                                <div className="font-medium">
                                  {nip65Info.readers.length} author
                                  {nip65Info.readers.length !== 1 ? "s" : ""}
                                </div>
                              </div>
                            )}
                            {nip65Info.writers.length > 0 && (
                              <div className="space-y-0.5">
                                <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">
                                  Outbox (Write)
                                </div>
                                <div className="font-medium">
                                  {nip65Info.writers.length} author
                                  {nip65Info.writers.length !== 1 ? "s" : ""}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );

                  return (
                    <Tooltip key={url}>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-2 text-xs py-1 px-3 hover:bg-accent/5 cursor-default">
                          {/* Relay URL */}
                          <RelayLink
                            url={url}
                            showInboxOutbox={false}
                            className="flex-1 min-w-0 truncate font-mono text-foreground/80"
                          />

                          {/* Right side: compact status icons */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {/* Event count badge */}
                            {reqState && reqState.eventCount > 0 && (
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                                <FileText className="size-2.5" />
                                <span>{reqState.eventCount}</span>
                              </div>
                            )}

                            {/* EOSE status */}
                            {reqState && (
                              <>
                                {reqState.subscriptionState === "eose" ? (
                                  <Check className="size-3 text-green-600/70" />
                                ) : (
                                  (reqState.subscriptionState === "receiving" ||
                                    reqState.subscriptionState ===
                                      "waiting") && (
                                    <Loader2 className="size-3 text-muted-foreground/40 animate-spin" />
                                  )
                                )}
                              </>
                            )}

                            {/* Auth icon (always visible) */}
                            <div>{authIcon.icon}</div>

                            {/* Connection icon (always visible) */}
                            <div>{connIcon.icon}</div>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="left"
                        className="max-w-xs bg-popover text-popover-foreground border border-border shadow-md"
                      >
                        {tooltipContent}
                      </TooltipContent>
                    </Tooltip>
                  );
                };

                return (
                  <>
                    {/* Online Section */}
                    {onlineRelays.length > 0 && (
                      <div className="py-2">
                        <div className="px-3 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Online ({onlineRelays.length})
                        </div>
                        {onlineRelays.map(renderRelay)}
                      </div>
                    )}

                    {/* Disconnected Section */}
                    {disconnectedRelays.length > 0 && (
                      <div className="py-2 border-t border-border">
                        <div className="px-3 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Disconnected ({disconnectedRelays.length})
                        </div>
                        {disconnectedRelays.map(renderRelay)}
                      </div>
                    )}
                  </>
                );
              })()}
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
          domainAuthors={domainAuthors}
          domainPTags={domainPTags}
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
        <div className="flex-1 overflow-y-auto relative">
          {/* Floating "New Events" Button (hidden in follow mode) */}
          {isFrozen && newEventCount > 0 && !follow && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
              <Button
                onClick={handleUnfreeze}
                className="shadow-lg bg-accent text-accent-foreground opacity-100 hover:bg-accent"
                size="sm"
              >
                <ChevronUp className="size-4" />
                {newEventCount} new event{newEventCount !== 1 ? "s" : ""}
              </Button>
            </div>
          )}

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

          {visibleEvents.length > 0 && (
            <Virtuoso
              ref={virtuosoRef}
              style={{ height: "100%" }}
              data={visibleEvents}
              computeItemKey={(_index, item) => item.id}
              itemContent={(_index, event) =>
                view === "compact" ? (
                  <MemoizedCompactEventRow event={event} />
                ) : (
                  <MemoizedFeedEvent event={event} />
                )
              }
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
