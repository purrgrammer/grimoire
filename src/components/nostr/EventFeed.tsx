import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { Virtuoso } from "react-virtuoso";
import { ChevronUp, User } from "lucide-react";
import { FeedEvent } from "./Feed";
import { MemoizedCompactEventRow } from "./CompactEventRow";
import { TimelineSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { NostrEvent } from "@/types/nostr";
import type { ViewMode } from "@/lib/req-parser";

// Memoized FeedEvent to prevent unnecessary re-renders during scroll
const MemoizedFeedEvent = memo(
  FeedEvent,
  (prev, next) => prev.event.id === next.event.id,
);

export interface EventFeedProps {
  /** Events to display */
  events: NostrEvent[];

  /** View mode: list (default) or compact */
  view?: ViewMode;

  /** Loading state (before EOSE received) */
  loading?: boolean;

  /** Whether EOSE has been received */
  eoseReceived?: boolean;

  /** Whether in streaming mode (for empty state messaging) */
  stream?: boolean;

  /** Optional error to display */
  error?: Error | null;

  /** Whether account is required (for $me/$contacts) */
  needsAccount?: boolean;

  /** Active account pubkey (if available) */
  accountPubkey?: string;

  /** Enable freeze functionality for streaming feeds (default: true when stream=true) */
  enableFreeze?: boolean;

  /** Callback when frozen state changes */
  onFreezeChange?: (isFrozen: boolean) => void;
}

/**
 * Reusable virtualized event feed component
 *
 * Features:
 * - Virtualized scrolling for performance with large feeds
 * - Support for list and compact view modes
 * - Auto-freeze on EOSE in streaming mode to prevent auto-scrolling
 * - Loading states and empty states
 * - Account required messaging
 */
export function EventFeed({
  events,
  view = "list",
  loading = false,
  eoseReceived = false,
  stream = false,
  error = null,
  needsAccount = false,
  accountPubkey,
  enableFreeze = stream,
  onFreezeChange,
}: EventFeedProps) {
  const virtuosoRef = useRef<any>(null);

  // Freeze timeline after EOSE to prevent auto-scrolling on new events
  const [freezePoint, setFreezePoint] = useState<string | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);

  // Freeze timeline after EOSE in streaming mode
  useEffect(() => {
    if (!enableFreeze) return;

    // Freeze after EOSE in streaming mode
    if (eoseReceived && stream && !isFrozen && events.length > 0) {
      setFreezePoint(events[0].id);
      setIsFrozen(true);
      onFreezeChange?.(true);
    }

    // Reset freeze on query change (events cleared)
    if (events.length === 0) {
      setFreezePoint(null);
      setIsFrozen(false);
      onFreezeChange?.(false);
    }
  }, [enableFreeze, eoseReceived, stream, isFrozen, events, onFreezeChange]);

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
    onFreezeChange?.(false);
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: 0,
        align: "start",
        behavior: "smooth",
      });
    });
  }, [onFreezeChange]);

  // Account Required Error
  if (needsAccount && !accountPubkey) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <div className="text-muted-foreground">
          <User className="size-12 mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-2">Account Required</h3>
          <p className="text-sm max-w-md">
            This query uses <code className="bg-muted px-1.5 py-0.5">$me</code>{" "}
            or <code className="bg-muted px-1.5 py-0.5">$contacts</code> aliases
            and requires an active account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      {/* Floating "New Events" Button */}
      {isFrozen && newEventCount > 0 && (
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

      {/* Error Display */}
      {error && (
        <div className="border-b border-border px-4 py-2 bg-destructive/10">
          <span className="text-xs font-mono text-destructive">
            Error: {error.message}
          </span>
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

      {/* Event List */}
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
  );
}
