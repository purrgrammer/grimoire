import { memo } from "react";
import type { NostrEvent } from "@/types/nostr";
import { kinds } from "nostr-tools";
import { getZapSender } from "applesauce-common/helpers/zap";
import { KindBadge } from "@/components/KindBadge";
import { UserName } from "./UserName";
import { compactRenderers, DefaultCompactPreview } from "./compact";

interface InlineEventPreviewProps {
  event: NostrEvent;
}

/**
 * Inline event preview for use in chat composer
 * Similar to CompactEventRow but optimized for inline display
 * - No click handlers (pointer events disabled)
 * - Ultra-compact single-line styling
 * - Designed to fit inline within text
 */
export function InlineEventPreview({ event }: InlineEventPreviewProps) {
  // Get the compact preview renderer for this kind, or use default
  const PreviewRenderer = compactRenderers[event.kind] || DefaultCompactPreview;

  return (
    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-primary/10 border border-primary/20 align-middle max-w-[180px] pointer-events-none whitespace-nowrap">
      {/* Kind badge - icon only */}
      <KindBadge
        kind={event.kind}
        variant="compact"
        className="shrink-0"
        iconClassname="size-3 text-muted-foreground"
      />

      {/* Author */}
      {event.kind === kinds.Zap && getZapSender(event) ? (
        <UserName
          pubkey={getZapSender(event) as string}
          className="shrink-0 truncate text-foreground font-medium text-[10px] max-w-[60px]"
        />
      ) : (
        <UserName
          pubkey={event.pubkey}
          className="shrink-0 truncate text-foreground font-medium text-[10px] max-w-[60px]"
        />
      )}

      {/* Kind-specific or default preview */}
      <span className="flex-1 min-w-0 truncate text-muted-foreground text-[10px]">
        <PreviewRenderer event={event} />
      </span>
    </span>
  );
}

// Memoized version
export const MemoizedInlineEventPreview = memo(
  InlineEventPreview,
  (prev, next) => prev.event.id === next.event.id,
);
