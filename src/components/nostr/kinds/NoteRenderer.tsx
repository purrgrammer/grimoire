import { RichText } from "../RichText";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { kinds } from "nostr-tools";
import { getNip10References } from "applesauce-common/helpers/threading";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { Reply } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { InlineReplySkeleton } from "@/components/ui/skeleton";
import { KindBadge } from "@/components/KindBadge";
import { getEventDisplayTitle } from "@/lib/event-title";
import type { NostrEvent } from "@/types/nostr";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Parent event card component - compact single line
 */
function ParentEventCard({
  parentEvent,
  icon: Icon,
  tooltipText,
  onClickHandler,
}: {
  parentEvent: NostrEvent;
  icon: typeof Reply;
  tooltipText: string;
  onClickHandler: () => void;
}) {
  // Don't show kind badge for kind 1 (most common, adds clutter)
  const showKindBadge = parentEvent.kind !== kinds.ShortTextNote;

  return (
    <div
      onClick={onClickHandler}
      className="flex items-center gap-2 p-1 bg-muted/20 text-xs hover:bg-muted/30 cursor-crosshair rounded transition-colors"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Icon className="size-3 flex-shrink-0" />
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
      {showKindBadge && <KindBadge kind={parentEvent.kind} variant="compact" />}
      <UserName
        pubkey={parentEvent.pubkey}
        className="text-accent font-semibold flex-shrink-0"
      />
      <div className="text-muted-foreground truncate line-clamp-1 min-w-0 flex-1">
        {showKindBadge ? (
          getEventDisplayTitle(parentEvent, false)
        ) : (
          <RichText
            className="truncate line-clamp-1"
            event={parentEvent}
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Renderer for Kind 1 - Short Text Note (NIP-10 threading)
 * Shows immediate parent (reply) only for cleaner display
 */
export function Kind1Renderer({ event, depth = 0 }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  // Use NIP-10 threading helpers
  const refs = getNip10References(event);

  // Get reply pointer (immediate parent)
  const replyPointer = refs.reply?.e || refs.reply?.a;

  // Fetch reply event
  const replyEvent = useNostrEvent(replyPointer, event);

  const handleReplyClick = () => {
    if (!replyEvent || !replyPointer) return;
    addWindow(
      "open",
      { pointer: replyPointer },
      `Reply to ${replyEvent.pubkey.slice(0, 8)}...`,
    );
  };

  return (
    <BaseEventContainer event={event}>
      <TooltipProvider>
        {/* Show reply event (immediate parent) */}
        {replyPointer && !replyEvent && (
          <InlineReplySkeleton icon={<Reply className="size-3" />} />
        )}

        {replyPointer && replyEvent && (
          <ParentEventCard
            parentEvent={replyEvent}
            icon={Reply}
            tooltipText="Replying to"
            onClickHandler={handleReplyClick}
          />
        )}
      </TooltipProvider>

      <RichText event={event} className="text-sm" depth={depth} />
    </BaseEventContainer>
  );
}
