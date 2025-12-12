import { useState, memo } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  ChevronDown,
  ChevronRight,
  Radio,
  FileText,
  Wifi,
  Filter as FilterIcon,
  Circle,
} from "lucide-react";
import { useReqTimeline } from "@/hooks/useReqTimeline";
import { useGrimoire } from "@/core/state";
import { FeedEvent } from "./nostr/Feed";
import { KindBadge } from "./KindBadge";
import type { NostrFilter } from "@/types/nostr";

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
        <div className="border-b border-border px-4 py-2 bg-muted space-y-2">
          {/* Kind Badges */}
          {filter.kinds && filter.kinds.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Kinds:</span>
              {filter.kinds.map((kind) => (
                <KindBadge key={kind} kind={kind} variant="full" />
              ))}
            </div>
          )}
          {/* Authors with NIP-05 info */}
          {filter.authors && filter.authors.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Authors: {filter.authors.length}
              </span>
              {nip05Authors && nip05Authors.length > 0 && (
                <div className="text-xs text-muted-foreground ml-2">
                  {nip05Authors.map((nip05) => (
                    <div key={nip05}>→ {nip05}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* #p Tags with NIP-05 info */}
          {filter["#p"] && filter["#p"].length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                #p Tags: {filter["#p"].length}
              </span>
              {nip05PTags && nip05PTags.length > 0 && (
                <div className="text-xs text-muted-foreground ml-2">
                  {nip05PTags.map((nip05) => (
                    <div key={nip05}>→ {nip05}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Limit */}
          {filter.limit && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Limit: {filter.limit}
              </span>
            </div>
          )}
          {/* Stream Mode */}
          {stream && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-green-500">
                ● Streaming mode enabled
              </span>
            </div>
          )}
          {/* Raw Query */}
          <details className="text-xs">
            <summary className="cursor-crosshair text-muted-foreground hover:text-foreground">
              Query Filter
            </summary>
            <pre className="mt-2 text-xs font-mono text-muted-foreground bg-background p-2 overflow-x-auto">
              {JSON.stringify(filter, null, 2)}
            </pre>
          </details>
        </div>
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
            computeItemKey={(_index, event) => event.id}
            itemContent={(_index, event) => <MemoizedFeedEvent event={event} />}
          />
        )}
      </div>
    </div>
  );
}
