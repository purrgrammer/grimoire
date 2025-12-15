import { useMemo } from "react";
import { BaseEventContainer, BaseEventProps } from "./BaseEventRenderer";
import { ExternalLink } from "lucide-react";
import {
  getHighlightText,
  getHighlightSourceUrl,
  getHighlightComment,
  getHighlightSourceEventPointer,
  getHighlightSourceAddressPointer,
} from "applesauce-core/helpers/highlight";
import { UserName } from "../UserName";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { RichText } from "../RichText";
import { getArticleTitle } from "applesauce-core/helpers";
import { KindBadge } from "@/components/KindBadge";

/**
 * Renderer for Kind 9802 - Highlight
 * Displays highlighted text with optional comment, compact source event preview, and source URL
 */
export function Kind9802Renderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const highlightText = useMemo(() => getHighlightText(event), [event]);
  const sourceUrl = useMemo(() => getHighlightSourceUrl(event), [event]);
  const comment = useMemo(() => getHighlightComment(event), [event]);

  // Get source event pointer (e tag) or address pointer (a tag) for Nostr event references
  const eventPointer = useMemo(
    () => getHighlightSourceEventPointer(event),
    [event],
  );
  const addressPointer = useMemo(
    () => getHighlightSourceAddressPointer(event),
    [event],
  );

  // Load the source event for preview
  const sourceEvent = useNostrEvent(eventPointer || addressPointer);

  // Extract title or content preview from source event
  const sourcePreview = useMemo(() => {
    if (!sourceEvent) return null;

    const title = getArticleTitle(sourceEvent);
    if (title) return title;

    // Fall back to content
    return sourceEvent.content || null;
  }, [sourceEvent]);

  // Handle click to open source event
  const handleOpenEvent = () => {
    if (eventPointer?.id) {
      addWindow(
        "open",
        { pointer: eventPointer },
        `Event ${eventPointer.id.slice(0, 8)}...`,
      );
    } else if (addressPointer) {
      addWindow("open", { pointer: addressPointer }, `Event`);
    }
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Comment */}
        {comment && <p className="text-sm text-foreground">{comment}</p>}

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

            {/* Title or Content Preview */}
            {sourcePreview && (
              <div
                className="hover:underline hover:decoration-dotted cursor-crosshair text-xs line-clamp-1 break-words"
                onClick={handleOpenEvent}
              >
                <RichText content={sourcePreview} />
              </div>
            )}
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
