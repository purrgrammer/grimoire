import { useState, memo } from "react";
import {
  ChevronDown,
  ChevronRight,
  Radio,
  FileText,
  Wifi,
  Filter as FilterIcon,
  Circle,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useReqTimeline } from "@/hooks/useReqTimeline";
import { useGrimoire } from "@/core/state";
import { useProfile } from "@/hooks/useProfile";
import { FeedEvent } from "./nostr/Feed";
import { KindBadge } from "./KindBadge";
import type { NostrFilter } from "@/types/nostr";
import {
  formatEventIds,
  formatDTags,
  formatTimeRange,
  formatGenericTag,
  formatPubkeysWithProfiles,
  formatHashtags,
} from "@/lib/filter-formatters";

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
}

interface QueryDropdownProps {
  filter: NostrFilter;
  nip05Authors?: string[];
  nip05PTags?: string[];
}

function QueryDropdown({
  filter,
  nip05Authors,
  nip05PTags,
}: QueryDropdownProps) {
  // Load profiles for authors and #p tags
  const authorPubkeys = filter.authors || [];
  const authorProfiles = authorPubkeys
    .slice(0, 10)
    .map((pubkey) => useProfile(pubkey));

  const pTagPubkeys = filter["#p"] || [];
  const pTagProfiles = pTagPubkeys
    .slice(0, 10)
    .map((pubkey) => useProfile(pubkey));

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

  return (
    <div className="border-b border-border px-4 py-2 bg-muted space-y-2">
      {/* Kinds */}
      {filter.kinds && filter.kinds.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground">Kinds:</span>
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
      )}

      {/* Time Range */}
      {(filter.since || filter.until) && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-foreground">
            Time Range:
          </span>
          <span className="text-xs ml-2">
            {formatTimeRange(filter.since, filter.until)}
          </span>
        </div>
      )}

      {/* Search */}
      {filter.search && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-foreground">Search:</span>
          <span className="text-xs ml-2">"{filter.search}"</span>
        </div>
      )}

      {/* Authors */}
      {authorPubkeys.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-foreground">
            Authors: {authorPubkeys.length}
          </span>
          <div className="text-xs ml-2">
            {formatPubkeysWithProfiles(authorPubkeys, authorProfiles, 3)}
          </div>
          {nip05Authors && nip05Authors.length > 0 && (
            <div className="text-xs ml-2 mt-1 space-y-0.5">
              {nip05Authors.map((nip05) => (
                <div key={nip05}>→ {nip05}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tag Filters Section */}
      {(eTags ||
        pTagPubkeys.length > 0 ||
        tTags ||
        dTags ||
        genericTags.length > 0) && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground">
            Tag Filters:
          </span>

          {/* Event References (#e) */}
          {eTags && eTags.length > 0 && (
            <div className="flex flex-col">
              <span className="text-xs">#e ({eTags.length}):</span>
              <span className="text-xs">{formatEventIds(eTags, 3)}</span>
            </div>
          )}

          {/* Mentions (#p) */}
          {pTagPubkeys.length > 0 && (
            <div className="flex flex-col">
              <span className="text-xs">#p ({pTagPubkeys.length}):</span>
              <span className="text-xs">
                {formatPubkeysWithProfiles(pTagPubkeys, pTagProfiles, 3)}
              </span>
              {nip05PTags && nip05PTags.length > 0 && (
                <div className="text-xs space-y-0.5">
                  {nip05PTags.map((nip05) => (
                    <div key={nip05}>→ {nip05}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Hashtags (#t) */}
          {tTags && tTags.length > 0 && (
            <div className="flex flex-col">
              <span className="text-xs">#t ({tTags.length}):</span>
              <span className="text-xs">{formatHashtags(tTags, 3)}</span>
            </div>
          )}

          {/* D-Tags (#d) */}
          {dTags && dTags.length > 0 && (
            <div className="flex flex-col">
              <span className="text-xs">#d ({dTags.length}):</span>
              <span className="text-xs">{formatDTags(dTags, 3)}</span>
            </div>
          )}

          {/* Generic Tags */}
          {genericTags.map((tag) => (
            <div key={tag.letter} className="flex flex-col">
              <span className="text-xs">
                #{tag.letter} ({tag.values.length}):
              </span>
              <span className="text-xs">
                {formatGenericTag(tag.letter, tag.values, 3).replace(
                  `#${tag.letter}: `,
                  "",
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Raw Query */}
      <details className="text-xs">
        <summary className="cursor-pointer">Show raw query</summary>
        <pre className="mt-2 text-xs font-mono bg-background p-2 border border-border overflow-x-auto">
          {JSON.stringify(filter, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default function ReqViewer({
  filter,
  relays,
  closeOnEose = false,
  nip05Authors,
  nip05PTags,
}: ReqViewerProps) {
  const { state } = useGrimoire();

  // NIP-05 resolution already happened in argParser before window creation
  // The filter prop already contains resolved pubkeys
  // We just display the NIP-05 identifiers for user reference

  // Use inbox relays if logged in and no relays specified
  const defaultRelays =
    relays ||
    (state.activeAccount?.relays?.inbox.length
      ? state.activeAccount.relays.inbox.map((r) => r.url)
      : ["wss://theforest.nostr1.com"]);

  // Streaming is the default behavior, closeOnEose inverts it
  const stream = !closeOnEose;

  const { events, loading, error, eoseReceived } = useReqTimeline(
    `req-${JSON.stringify(filter)}-${closeOnEose}`,
    filter,
    defaultRelays,
    { limit: filter.limit || 50, stream },
  );

  const [showRelays, setShowRelays] = useState(false);
  const [showQuery, setShowQuery] = useState(false);

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Compact Header */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between">
        {/* Left: Status Indicator */}
        <div className="flex items-center gap-2">
          <Radio
            className={`size-3 ${
              loading && !eoseReceived
                ? "text-yellow-500 animate-pulse"
                : loading && eoseReceived && stream
                  ? "text-green-500 animate-pulse"
                  : !loading && eoseReceived
                    ? "text-muted-foreground"
                    : "text-yellow-500 animate-pulse"
            }`}
          />
          <span
            className={`${
              loading && !eoseReceived
                ? "text-yellow-500"
                : loading && eoseReceived && stream
                  ? "text-green-500"
                  : !loading && eoseReceived
                    ? "text-muted-foreground"
                    : "text-yellow-500"
            } font-semibold`}
          >
            {loading && !eoseReceived
              ? "LOADING"
              : loading && eoseReceived && stream
                ? "LIVE"
                : !loading && eoseReceived
                  ? "CLOSED"
                  : "CONNECTING"}
          </span>
        </div>

        {/* Right: Stats */}
        <div className="flex items-center gap-3">
          {/* Event Count */}
          <div className="flex items-center gap-1 text-muted-foreground">
            <FileText className="size-3" />
            <span>{events.length}</span>
          </div>

          {/* Relay Count (Clickable) */}
          <button
            onClick={() => setShowRelays(!showRelays)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showRelays ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <Wifi className="size-3" />
            <span>{defaultRelays.length}</span>
          </button>

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

      {/* Expandable Relays */}
      {showRelays && (
        <div className="border-b border-border px-4 py-2 bg-muted">
          <div className="flex flex-col gap-2">
            {defaultRelays.map((relay) => (
              <div key={relay} className="flex items-center gap-2">
                <Circle className="size-2 fill-green-500 text-green-500" />
                <span className="text-xs font-mono text-muted-foreground">
                  {relay}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable Query */}
      {showQuery && (
        <QueryDropdown
          filter={filter}
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

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading && events.length === 0 && (
          <div className="text-center text-muted-foreground font-mono text-sm p-4">
            Loading events...
          </div>
        )}

        {!loading && !stream && events.length === 0 && !error && (
          <div className="text-center text-muted-foreground font-mono text-sm p-4">
            No events found matching filter
          </div>
        )}

        {stream && events.length === 0 && !loading && (
          <div className="text-center text-muted-foreground font-mono text-sm p-4">
            Waiting for events...
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
    </div>
  );
}
