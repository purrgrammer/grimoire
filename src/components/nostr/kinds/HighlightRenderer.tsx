import { BaseEventContainer, BaseEventProps } from "./BaseEventRenderer";
import { ExternalLink } from "lucide-react";
import {
  getHighlightText,
  getHighlightSourceUrl,
  getHighlightComment,
  getHighlightSourceEventPointer,
  getHighlightSourceAddressPointer,
} from "applesauce-common/helpers/highlight";
import { UserName } from "../UserName";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { RichText } from "../RichText";
import { getArticleTitle } from "applesauce-common/helpers/article";
import { KindBadge } from "@/components/KindBadge";

/**
 * Renderer for Kind 9802 - Highlight
 * Displays highlighted text with optional comment, compact source event preview, and source URL
 * Note: All applesauce helpers cache internally, no useMemo needed
 */
export function Kind9802Renderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const highlightText = getHighlightText(event);
  const sourceUrl = getHighlightSourceUrl(event);
  const comment = getHighlightComment(event);

  // Get source event pointer (e tag) or address pointer (a tag) for Nostr event references
  const eventPointer = getHighlightSourceEventPointer(event);
  const addressPointer = getHighlightSourceAddressPointer(event);

  // Load the source event for preview
  const sourceEvent = useNostrEvent(eventPointer || addressPointer);

  // Get article title if this is an article (caches internally)
  const sourceTitle = sourceEvent ? getArticleTitle(sourceEvent) : null;

  // Handle click to open source event
  const handleOpenEvent = () => {
    if (eventPointer?.id) {
      addWindow("open", { pointer: eventPointer });
    } else if (addressPointer) {
      addWindow("open", { pointer: addressPointer });
    }
  };

  // Create synthetic event for comment rendering (preserves emoji tags)
  const commentEvent = comment
    ? {
        ...event,
        content: comment,
      }
    : undefined;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Comment */}
        {commentEvent && (
          <RichText
            event={commentEvent}
            className="text-sm text-foreground"
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        )}

        {/* Highlighted text */}
        {highlightText && (
          <blockquote className="border-l-4 border-muted px-4 py-2 bg-muted/30">
            <p className="text-sm italic leading-relaxed text-muted-foreground">
              {highlightText}
            </p>
          </blockquote>
        )}

        {/* Compact Source Event Preview - Clickable link with icon, author, and title/content */}
        {sourceEvent && (eventPointer || addressPointer) && (
          <div className="flex items-center gap-2">
            <KindBadge
              iconClassname="size-3 flex-shrink-0 text-muted-foreground"
              showName={false}
              kind={sourceEvent.kind}
              clickable
            />

            <UserName
              pubkey={sourceEvent.pubkey}
              className="text-xs flex-shrink-0 line-clamp-1"
            />

            {/* Title or Content Preview - CSS handles truncation */}
            <div
              className="hover:underline hover:decoration-dotted cursor-crosshair text-xs line-clamp-1 overflow-hidden min-w-0"
              onClick={handleOpenEvent}
            >
              <RichText
                event={
                  sourceTitle
                    ? { ...sourceEvent, content: sourceTitle }
                    : sourceEvent
                }
                options={{ showMedia: false, showEventEmbeds: false }}
              />
            </div>
          </div>
        )}

        {/* Source URL - Show for external websites (non-Nostr sources) */}
        {sourceUrl && !eventPointer && !addressPointer && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground underline decoration-dotted"
          >
            <ExternalLink className="size-3 flex-shrink-0" />
            <span className="truncate">{sourceUrl}</span>
          </a>
        )}

        {/* No content fallback */}
        {!highlightText && (
          <p className="text-xs text-muted-foreground italic">
            (Empty highlight)
          </p>
        )}
      </div>
    </BaseEventContainer>
  );
}
