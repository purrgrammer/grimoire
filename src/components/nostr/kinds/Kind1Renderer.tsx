import { RichText } from "../RichText";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { getNip10References } from "applesauce-core/helpers/threading";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { Reply } from "lucide-react";
import { useGrimoire } from "@/core/state";

/**
 * Renderer for Kind 1 - Short Text Note
 */
export function Kind1Renderer({
  event,
  showTimestamp,
  depth = 0,
}: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const refs = getNip10References(event);
  const hasReply = refs.reply?.e || refs.reply?.a;

  // Fetch parent event if replying
  const parentEvent = useNostrEvent(
    hasReply ? refs.reply?.e || refs.reply?.a : undefined,
  );

  const handleReplyClick = () => {
    if (!parentEvent) return;

    const pointer = refs.reply?.e || refs.reply?.a;
    if (pointer) {
      addWindow(
        "open",
        { pointer },
        `Reply to ${parentEvent.pubkey.slice(0, 8)}...`,
      );
    }
  };

  return (
    <BaseEventContainer event={event} showTimestamp={showTimestamp}>
      {hasReply && parentEvent && (
        <div
          onClick={handleReplyClick}
          className="flex items-start gap-2 p-1 bg-muted/20 text-xs text-muted-foreground hover:bg-muted/30 cursor-pointer rounded transition-colors"
        >
          <Reply className="size-3 flex-shrink-0 mt-0.5" />
          <div className="flex items-baseline gap-1 min-w-0 flex-1">
            <UserName
              pubkey={parentEvent.pubkey}
              className="flex-shrink-0 text-accent"
            />
            <span className="truncate">{parentEvent.content}</span>
          </div>
        </div>
      )}
      <RichText event={event} className="text-sm" depth={depth} />
    </BaseEventContainer>
  );
}
