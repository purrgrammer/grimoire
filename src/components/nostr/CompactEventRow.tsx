import { memo, useCallback } from "react";
import type { NostrEvent } from "@/types/nostr";
import { kinds } from "nostr-tools";
import { useGrimoire } from "@/core/state";
import { formatTimestamp } from "@/hooks/useLocale";
import { getTagValue } from "applesauce-core/helpers";
import { getZapSender } from "applesauce-common/helpers/zap";
import { KindBadge } from "@/components/KindBadge";
import { UserName } from "./UserName";
import { compactRenderers, DefaultCompactPreview } from "./compact";

// NIP-01 Kind ranges for replaceable events
const REPLACEABLE_START = 10000;
const REPLACEABLE_END = 20000;
const PARAMETERIZED_REPLACEABLE_START = 30000;
const PARAMETERIZED_REPLACEABLE_END = 40000;

interface CompactEventRowProps {
  event: NostrEvent;
}

/**
 * Compact single-line event representation
 * Layout: [KindBadge] [Author] [Preview] [Time]
 */
export function CompactEventRow({ event }: CompactEventRowProps) {
  const { addWindow } = useGrimoire();
  const { locale } = useGrimoire();

  // Get the compact preview renderer for this kind, or use default
  const PreviewRenderer = compactRenderers[event.kind] || DefaultCompactPreview;

  // Format relative time
  const relativeTime = formatTimestamp(
    event.created_at,
    "relative",
    locale.locale,
  );

  // Format absolute time for tooltip
  const absoluteTime = formatTimestamp(
    event.created_at,
    "absolute",
    locale.locale,
  );

  // Click handler to open event detail
  const handleClick = useCallback(() => {
    // Determine if event is addressable/replaceable
    const isAddressable =
      (event.kind >= REPLACEABLE_START && event.kind < REPLACEABLE_END) ||
      (event.kind >= PARAMETERIZED_REPLACEABLE_START &&
        event.kind < PARAMETERIZED_REPLACEABLE_END);

    let pointer;

    if (isAddressable) {
      const dTag = getTagValue(event, "d") || "";
      pointer = {
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag,
      };
    } else {
      pointer = {
        id: event.id,
      };
    }

    addWindow("open", { pointer });
  }, [event, addWindow]);

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 text-sm border-b border-border/50 last:border-0 cursor-crosshair hover:bg-muted/30 transition-colors"
      onClick={handleClick}
    >
      {/* Kind badge - compact/icon only */}
      <KindBadge kind={event.kind} variant="compact" className="shrink-0" />

      {/* Author */}
      {event.kind === kinds.Zap && getZapSender(event) ? (
        <UserName
          pubkey={getZapSender(event) as string}
          className="shrink-0 truncate"
        />
      ) : (
        <UserName pubkey={event.pubkey} className="shrink-0 truncate" />
      )}

      {/* Kind-specific or default preview */}
      <div className="flex-1 min-w-0 truncate">
        <PreviewRenderer event={event} />
      </div>

      {/* Timestamp */}
      <span
        className="text-xs text-muted-foreground shrink-0 cursor-help"
        title={absoluteTime}
      >
        {relativeTime}
      </span>
    </div>
  );
}

// Memoized version for scroll performance
export const MemoizedCompactEventRow = memo(
  CompactEventRow,
  (prev, next) => prev.event.id === next.event.id,
);
