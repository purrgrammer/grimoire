import { RichText } from "../RichText";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { getNip10References } from "applesauce-common/helpers/threading";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { MessageCircle } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { InlineReplySkeleton } from "@/components/ui/skeleton";

/**
 * Renderer for Kind 14 - Private Direct Message Rumor (NIP-17)
 * Displays DM messages with optional quoted parent message
 * Uses NIP-10 e-tags for threading
 */
export function DMRumorRenderer({ event, depth = 0 }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  // Use NIP-10 threading for DM replies
  const refs = getNip10References(event);
  const replyPointer = refs.reply?.e || refs.reply?.a;

  // Fetch reply event if available
  const parentEvent = useNostrEvent(replyPointer, event);

  const handleQuoteClick = () => {
    if (!parentEvent || !replyPointer) return;
    addWindow(
      "open",
      { pointer: replyPointer },
      `Reply to ${parentEvent.pubkey.slice(0, 8)}...`,
    );
  };

  return (
    <BaseEventContainer event={event}>
      {/* Show quoted message loading state */}
      {replyPointer && !parentEvent && (
        <InlineReplySkeleton icon={<MessageCircle className="size-3" />} />
      )}

      {/* Show quoted parent message once loaded */}
      {replyPointer && parentEvent && (
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
