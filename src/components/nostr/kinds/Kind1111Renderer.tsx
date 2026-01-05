import { RichText } from "../RichText";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import {
  getCommentReplyPointer,
  isCommentAddressPointer,
  isCommentEventPointer,
  type CommentPointer,
} from "applesauce-common/helpers/comment";
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
 * Convert CommentPointer to pointer format for useNostrEvent
 */
function convertCommentPointer(
  commentPointer: CommentPointer | null,
):
  | { id: string }
  | { kind: number; pubkey: string; identifier: string }
  | undefined {
  if (!commentPointer) return undefined;

  if (isCommentEventPointer(commentPointer)) {
    return { id: commentPointer.id };
  } else if (isCommentAddressPointer(commentPointer)) {
    return {
      kind: commentPointer.kind,
      pubkey: commentPointer.pubkey,
      identifier: commentPointer.identifier,
    };
  }
  return undefined;
}

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
  const showKindBadge = parentEvent.kind !== 1;

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
        {getEventDisplayTitle(parentEvent, false) || (
          <RichText
            event={parentEvent}
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Renderer for Kind 1111 - Post (NIP-22)
 * Shows immediate parent (reply) only for cleaner display
 */
export function Kind1111Renderer({ event, depth = 0 }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  // Use NIP-22 specific helpers to get reply pointer
  const replyPointerRaw = getCommentReplyPointer(event);

  // Convert to useNostrEvent format
  const replyPointer = convertCommentPointer(replyPointerRaw);

  // Fetch reply event
  const replyEvent = useNostrEvent(replyPointer, event);

  const handleReplyClick = () => {
    if (!replyEvent || !replyPointer) return;
    addWindow("open", { pointer: replyPointer });
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
