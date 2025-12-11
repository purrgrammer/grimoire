import { useMemo } from "react";
import { BaseEventContainer, BaseEventProps } from "./BaseEventRenderer";
import { ExternalLink } from "lucide-react";
import {
  getHighlightText,
  getHighlightSourceUrl,
  getHighlightComment,
} from "applesauce-core/helpers/highlight";

/**
 * Renderer for Kind 9802 - Highlight
 * Displays highlighted text with optional comment and source URL
 */
export function Kind9802Renderer({ event }: BaseEventProps) {
  const highlightText = useMemo(() => getHighlightText(event), [event]);
  const sourceUrl = useMemo(() => getHighlightSourceUrl(event), [event]);
  const comment = useMemo(() => getHighlightComment(event), [event]);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Comment */}
        {comment && <p className="text-sm text-foreground">{comment}</p>}

        {/* Highlighted text */}
        {highlightText && (
          <blockquote className="border-l-4 border-muted pl-3 py-2 bg-muted/80">
            <p className="text-sm italic">{highlightText}</p>
          </blockquote>
        )}

        {/* Source URL */}
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-accent underline decoration-dotted"
          >
            <ExternalLink className="size-3 flex-shrink-0" />
            <span className="truncate">{sourceUrl}</span>
          </a>
        )}

        {/* No content fallback */}
        {!highlightText && (
          <p className="text-sm text-muted-foreground italic">
            (Empty highlight)
          </p>
        )}
      </div>
    </BaseEventContainer>
  );
}
