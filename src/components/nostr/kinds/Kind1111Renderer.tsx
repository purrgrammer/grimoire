import { RichText } from "../RichText";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import {
  getCommentReplyPointer,
  getCommentRootPointer,
  isCommentAddressPointer,
  isCommentEventPointer,
  isCommentExternalPointer,
  type CommentPointer,
} from "applesauce-common/helpers/comment";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { Reply, Hash, ExternalLink } from "lucide-react";
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
 * Check if two comment pointers reference the same event
 */
function arePointersEqual(
  a: CommentPointer | null,
  b: CommentPointer | null,
): boolean {
  if (!a || !b) return false;

  if (isCommentEventPointer(a) && isCommentEventPointer(b)) {
    return a.id === b.id;
  }

  if (isCommentAddressPointer(a) && isCommentAddressPointer(b)) {
    return (
      a.kind === b.kind &&
      a.pubkey === b.pubkey &&
      a.identifier === b.identifier
    );
  }

  if (isCommentExternalPointer(a) && isCommentExternalPointer(b)) {
    return a.kind === b.kind && a.identifier === b.identifier;
  }

  return false;
}

/**
 * Format external identifier for display
 */
function formatExternalIdentifier(pointer: CommentPointer): {
  label: string;
  value: string;
  url?: string;
} {
  if (!isCommentExternalPointer(pointer)) {
    return { label: "Unknown", value: "" };
  }

  const { kind, identifier } = pointer;

  switch (kind) {
    case "web":
      return {
        label: "URL",
        value: identifier,
        url: identifier.startsWith("http")
          ? identifier
          : `https://${identifier}`,
      };
    case "#":
      return {
        label: "Hashtag",
        value: identifier,
      };
    case "geo":
      return {
        label: "Location",
        value: identifier.replace(/^geo:/, ""),
        url: `https://www.openstreetmap.org/?mlat=${identifier.replace(/^geo:/, "").split(",")[0]}&mlon=${identifier.replace(/^geo:/, "").split(",")[1]}`,
      };
    case "isbn":
      return {
        label: "ISBN",
        value: identifier.replace(/^isbn:/, ""),
        url: `https://isbnsearch.org/isbn/${identifier.replace(/^isbn:/, "")}`,
      };
    case "podcast:guid":
    case "podcast:item:guid":
    case "podcast:publisher:guid":
      return {
        label: "Podcast",
        value: identifier.replace(/^podcast:(item:|publisher:)?guid:/, ""),
      };
    case "doi":
      return {
        label: "DOI",
        value: identifier.replace(/^doi:/, ""),
        url: `https://doi.org/${identifier.replace(/^doi:/, "")}`,
      };
    case "isan":
      return {
        label: "ISAN",
        value: identifier.replace(/^isan:/, ""),
      };
    default:
      // Handle blockchain identifiers and generic formats
      if (kind.includes(":tx")) {
        return {
          label: "Transaction",
          value: identifier,
        };
      }
      if (kind.includes(":address")) {
        return {
          label: "Address",
          value: identifier,
        };
      }
      return {
        label: kind,
        value: identifier,
      };
  }
}

/**
 * External identifier card component - compact single line
 */
function ExternalIdentifierCard({
  pointer,
  icon: Icon,
  tooltipText,
}: {
  pointer: CommentPointer;
  icon: typeof ExternalLink;
  tooltipText: string;
}) {
  const { label, value, url } = formatExternalIdentifier(pointer);

  const content = (
    <div className="flex items-center gap-2 p-1 bg-muted/20 text-xs rounded">
      <Tooltip>
        <TooltipTrigger asChild>
          <Icon className="size-3 flex-shrink-0" />
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
      <span className="text-accent font-semibold flex-shrink-0">{label}:</span>
      <div className="text-muted-foreground truncate line-clamp-1 min-w-0 flex-1">
        {value}
      </div>
    </div>
  );

  // If there's a URL, make it clickable
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:opacity-80 transition-opacity block"
      >
        {content}
      </a>
    );
  }

  return content;
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
 * Renderer for Kind 1111 - Comment (NIP-22)
 * Shows root context (what the thread is about) and parent reply if different
 * Supports both Nostr events and external identifiers (URLs, podcasts, etc.)
 */
export function Kind1111Renderer({ event, depth = 0 }: BaseEventProps) {
  const { addWindow } = useGrimoire();

  // Use NIP-22 specific helpers to get root and reply pointers
  const rootPointerRaw = getCommentRootPointer(event);
  const replyPointerRaw = getCommentReplyPointer(event);

  // Check if pointers are external identifiers
  const isRootExternal = isCommentExternalPointer(rootPointerRaw);
  const isReplyExternal = isCommentExternalPointer(replyPointerRaw);

  // Convert to useNostrEvent format (only for non-external pointers)
  const rootPointer = !isRootExternal
    ? convertCommentPointer(rootPointerRaw)
    : undefined;
  const replyPointer = !isReplyExternal
    ? convertCommentPointer(replyPointerRaw)
    : undefined;

  // Check if root and reply are the same (top-level comment)
  const isTopLevel = arePointersEqual(rootPointerRaw, replyPointerRaw);

  // Fetch events (only for non-external pointers)
  const rootEvent = useNostrEvent(rootPointer, event);
  const replyEvent = useNostrEvent(replyPointer, event);

  const handleRootClick = () => {
    if (!rootEvent || !rootPointer) return;
    addWindow("open", { pointer: rootPointer });
  };

  const handleReplyClick = () => {
    if (!replyEvent || !replyPointer) return;
    addWindow("open", { pointer: replyPointer });
  };

  return (
    <BaseEventContainer event={event}>
      <TooltipProvider>
        {/* Show root context (what the comment thread is about) */}
        {isRootExternal && rootPointerRaw ? (
          <ExternalIdentifierCard
            pointer={rootPointerRaw}
            icon={ExternalLink}
            tooltipText="Comment on"
          />
        ) : (
          <>
            {rootPointer && !rootEvent && (
              <InlineReplySkeleton icon={<Hash className="size-3" />} />
            )}
            {rootPointer && rootEvent && (
              <ParentEventCard
                parentEvent={rootEvent}
                icon={Hash}
                tooltipText="Comment on"
                onClickHandler={handleRootClick}
              />
            )}
          </>
        )}

        {/* Show reply event (immediate parent) if different from root */}
        {!isTopLevel && (
          <>
            {isReplyExternal && replyPointerRaw ? (
              <ExternalIdentifierCard
                pointer={replyPointerRaw}
                icon={ExternalLink}
                tooltipText="Replying to"
              />
            ) : (
              <>
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
              </>
            )}
          </>
        )}
      </TooltipProvider>

      <RichText event={event} className="text-sm" depth={depth} />
    </BaseEventContainer>
  );
}
