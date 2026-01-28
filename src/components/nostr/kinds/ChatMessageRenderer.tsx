import { RichText } from "../RichText";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { MessageCircle } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { getTagValues } from "@/lib/nostr-utils";
import { isValidHexEventId } from "@/lib/nostr-validation";
import { InlineReplySkeleton } from "@/components/ui/skeleton";

/**
 * Renderer for Kind 9 - Chat Message (NIP-29)
 * Displays chat messages with optional quoted parent message
 */
export function Kind9Renderer({ event, depth = 0 }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  // Parse 'q' tag for quoted parent message
  const quotedEventIds = getTagValues(event, "q");
  const quotedEventId = quotedEventIds[0]; // First q tag

  // Pass full reply event to useNostrEvent for comprehensive relay selection
  // This allows eventLoader to extract r/e/p tags for better relay coverage
  const parentEvent = useNostrEvent(quotedEventId, event);

  const handleQuoteClick = () => {
    if (!parentEvent || !quotedEventId) return;
    const pointer = isValidHexEventId(quotedEventId)
      ? {
          id: quotedEventId,
        }
      : quotedEventId;

    addWindow(
      "open",
      { pointer },
      `Quoted message from ${parentEvent.pubkey.slice(0, 8)}...`,
    );
  };

  return (
    <BaseEventContainer event={event}>
      {/* Show quoted message loading state */}
      {quotedEventId && !parentEvent && (
        <InlineReplySkeleton icon={<MessageCircle className="size-3" />} />
      )}

      {/* Show quoted parent message once loaded (only if it's a chat message) */}
      {quotedEventId && parentEvent && parentEvent.kind === 9 && (
        <div
          onClick={handleQuoteClick}
          className="flex items-start gap-2 p-1 bg-muted/20 text-xs text-muted-foreground hover:bg-muted/30 cursor-crosshair rounded transition-colors"
        >
          <MessageCircle className="size-3 flex-shrink-0 mt-0.5" />
          <div className="flex items-baseline gap-1 min-w-0 flex-1">
            <UserName
              pubkey={parentEvent.pubkey}
              className="flex-shrink-0 text-accent"
            />
            <div className="truncate line-clamp-1">
              <RichText
                event={parentEvent}
                options={{ showMedia: false, showEventEmbeds: false }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Main message content */}
      <RichText event={event} className="text-sm" depth={depth} />
    </BaseEventContainer>
  );
}
