import { RichText } from "../RichText";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { MessageCircle, Hash } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { getNip10References } from "applesauce-common/helpers/threading";
import { isValidHexEventId } from "@/lib/nostr-validation";
import { InlineReplySkeleton } from "@/components/ui/skeleton";

/**
 * Kind 42 Renderer - Channel Message (Feed View)
 * NIP-28 public chat channel message with NIP-10 threading
 */
export function ChannelMessageRenderer({ event, depth = 0 }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  // Parse NIP-10 references for threading
  const references = getNip10References(event);

  // Root is the channel (kind 40), reply is the parent message
  const rootPointer = references.root?.e;
  const replyPointer = references.reply?.e;

  // Only show reply preview if there's a reply pointer
  const quotedEventId =
    replyPointer && replyPointer.id !== rootPointer?.id
      ? replyPointer.id
      : undefined;

  // Pass full event to useNostrEvent for relay hints
  const parentEvent = useNostrEvent(quotedEventId, event);

  // Load root channel event for context
  const channelEvent = useNostrEvent(rootPointer);

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
      `Reply to ${parentEvent.pubkey.slice(0, 8)}...`,
    );
  };

  const handleChannelClick = () => {
    if (!channelEvent) return;
    addWindow(
      "open",
      { pointer: { id: channelEvent.id } },
      `Channel ${channelEvent.content || channelEvent.id.slice(0, 8)}`,
    );
  };

  return (
    <BaseEventContainer event={event}>
      {/* Show channel context */}
      {channelEvent && (
        <div
          onClick={handleChannelClick}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-accent cursor-pointer transition-colors mb-1"
        >
          <Hash className="size-3" />
          <span>{channelEvent.content || channelEvent.id.slice(0, 8)}</span>
        </div>
      )}

      {/* Show quoted message loading state */}
      {quotedEventId && !parentEvent && (
        <InlineReplySkeleton icon={<MessageCircle className="size-3" />} />
      )}

      {/* Show quoted parent message once loaded (only if it's a channel message) */}
      {quotedEventId && parentEvent && parentEvent.kind === 42 && (
        <div
          onClick={handleQuoteClick}
          className="flex items-start gap-2 p-1 bg-muted/20 text-xs text-muted-foreground hover:bg-muted/30 cursor-crosshair rounded transition-colors mb-1"
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
