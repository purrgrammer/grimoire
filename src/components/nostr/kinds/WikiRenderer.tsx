import { BookOpen } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";

/**
 * Renderer for Kind 30818 - Wiki Article (NIP-54)
 * Displays wiki article title and summary in feed
 * Note: getTagValue caches internally, no useMemo needed
 */
export function WikiRenderer({ event }: BaseEventProps) {
  // Get title from "title" tag, fallback to "d" tag (subject identifier)
  const title = getTagValue(event, "title") || getTagValue(event, "d");
  const summary = getTagValue(event, "summary");

  return (
    <BaseEventContainer event={event}>
      <div dir="auto" className="flex flex-col gap-2">
        {/* Title with wiki icon */}
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-muted-foreground flex-shrink-0" />
          {title && (
            <ClickableEventTitle
              event={event}
              className="text-lg font-bold text-foreground"
            >
              {title}
            </ClickableEventTitle>
          )}
          {!title && (
            <span className="text-sm text-muted-foreground italic">
              (Untitled wiki article)
            </span>
          )}
        </div>

        {/* Summary */}
        {summary && (
          <p className="text-sm text-muted-foreground line-clamp-3 pl-6">
            {summary}
          </p>
        )}
      </div>
    </BaseEventContainer>
  );
}
