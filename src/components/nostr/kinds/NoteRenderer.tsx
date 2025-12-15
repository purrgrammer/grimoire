import { RichText } from "../RichText";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { getNip10References } from "applesauce-core/helpers/threading";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { Reply } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { InlineReplySkeleton } from "@/components/ui/skeleton";

/**
 * Renderer for Kind 1 - Short Text Note
 */
export function Kind1Renderer({ event, depth = 0 }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const refs = getNip10References(event);
  const pointer =
    refs.reply?.e || refs.reply?.a || refs.root?.e || refs.root?.a;
  const parentEvent = useNostrEvent(pointer);

  const handleReplyClick = () => {
    if (!parentEvent) return;

    if (pointer) {
      addWindow(
        "open",
        { pointer },
        `Reply to ${parentEvent.pubkey.slice(0, 8)}...`,
      );
    }
  };

  return (
    <BaseEventContainer event={event}>
      {/* Show parent message loading state */}
      {pointer && !parentEvent && <InlineReplySkeleton icon={<Reply />} />}

      {/* Show parent message once loaded */}
      {pointer && parentEvent && (
        <div
          onClick={handleReplyClick}
          className="flex items-start gap-2 p-1 bg-muted/20 text-xs text-muted-foreground hover:bg-muted/30 cursor-crosshair rounded transition-colors"
        >
          <Reply className="size-3 flex-shrink-0 mt-0.5" />
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
      <RichText event={event} className="text-sm" depth={depth} />
    </BaseEventContainer>
  );
}
