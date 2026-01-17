import { NostrEvent } from "@/types/nostr";
import { UserName } from "./nostr/UserName";
import { EventMenu } from "./nostr/kinds/BaseEventRenderer";
import { RichText } from "./nostr/RichText";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";

/**
 * Compact renderer for comments in thread view
 * - No reply preview
 * - No footer
 * - Minimal padding
 * - Used for both kind 1 and kind 1111 in thread context
 */
export function ThreadCommentRenderer({ event }: { event: NostrEvent }) {
  const { locale } = useGrimoire();

  // Format relative time for display
  const relativeTime = formatTimestamp(
    event.created_at,
    "relative",
    locale.locale,
  );

  // Format absolute timestamp for hover
  const absoluteTime = formatTimestamp(
    event.created_at,
    "absolute",
    locale.locale,
  );

  return (
    <div className="flex flex-col gap-1.5 p-2 border-b border-border/50 last:border-0">
      <div className="flex flex-row justify-between items-center">
        <div className="flex flex-row gap-2 items-baseline">
          <UserName pubkey={event.pubkey} className="text-sm" />
          <span
            className="text-xs text-muted-foreground cursor-help"
            title={absoluteTime}
          >
            {relativeTime}
          </span>
        </div>
        <EventMenu event={event} />
      </div>
      <RichText event={event} className="text-sm" />
    </div>
  );
}
