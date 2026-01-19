import { memo } from "react";
import type { NostrEvent } from "@/types/nostr";
import { kinds } from "nostr-tools";
import { formatTimestamp } from "@/hooks/useLocale";
import { getZapSender } from "applesauce-common/helpers/zap";
import { KindBadge } from "@/components/KindBadge";
import { UserName } from "./UserName";
import { compactRenderers, DefaultCompactPreview } from "./compact";
import { useGrimoire } from "@/core/state";

interface InlineEventPreviewProps {
  event: NostrEvent;
}

/**
 * Inline event preview for use in chat composer
 * Similar to CompactEventRow but optimized for inline display
 * - No click handlers (pointer events disabled)
 * - More compact styling
 * - Designed to fit in a single line within text
 */
export function InlineEventPreview({ event }: InlineEventPreviewProps) {
  const { locale } = useGrimoire();

  // Get the compact preview renderer for this kind, or use default
  const PreviewRenderer = compactRenderers[event.kind] || DefaultCompactPreview;

  // Format relative time
  const relativeTime = formatTimestamp(
    event.created_at,
    "relative",
    locale.locale,
  );

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 text-xs align-middle max-w-[320px] pointer-events-none">
      {/* Kind badge - icon only */}
      <KindBadge kind={event.kind} variant="compact" className="shrink-0" />

      {/* Author */}
      {event.kind === kinds.Zap && getZapSender(event) ? (
        <UserName
          pubkey={getZapSender(event) as string}
          className="shrink-0 truncate text-foreground font-medium text-[10px]"
        />
      ) : (
        <UserName
          pubkey={event.pubkey}
          className="shrink-0 truncate text-foreground font-medium text-[10px]"
        />
      )}

      {/* Kind-specific or default preview */}
      <span className="flex-1 min-w-0 truncate text-muted-foreground text-[10px]">
        <PreviewRenderer event={event} />
      </span>

      {/* Timestamp */}
      <span className="text-[9px] text-muted-foreground/70 shrink-0">
        {relativeTime}
      </span>
    </span>
  );
}

// Memoized version
export const MemoizedInlineEventPreview = memo(
  InlineEventPreview,
  (prev, next) => prev.event.id === next.event.id,
);
