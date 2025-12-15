import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { RichText } from "../RichText";
import { ExternalLink } from "lucide-react";

/**
 * Renderer for Kind 39701 - Web Bookmarks (NIP-B0)
 * Displays bookmark title, URL, and description
 */
export function Kind39701Renderer({ event }: BaseEventProps) {
  // Extract bookmark data from tags
  const title = event.tags.find((t) => t[0] === "title")?.[1];
  // URL comes from d tag (identifier) or optional u tag
  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  const uTag = event.tags.find((t) => t[0] === "u")?.[1];
  // If only d tag provided, assume https:// prefix
  const url = uTag || (dTag ? `https://${dTag}` : undefined);
  // Display URL without scheme and trailing slash for cleaner appearance
  const displayUrl = url?.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title */}
        {title && (
          <ClickableEventTitle
            event={event}
            windowTitle={title}
            className="text-lg font-bold text-foreground"
          >
            {title}
          </ClickableEventTitle>
        )}

        {/* URL with external link icon */}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-muted-foreground hover:underline hover:decoration-dotted"
          >
            <ExternalLink className="size-4 flex-shrink-0" />
            <span className="text-sm break-all">{displayUrl}</span>
          </a>
        )}

        {/* Description/Content as RichText */}
        {event.content && <RichText event={event} className="text-sm" />}

        {/* Fallback if no data */}
        {!title && !url && (
          <p className="text-sm text-muted-foreground italic">
            (Empty bookmark)
          </p>
        )}
      </div>
    </BaseEventContainer>
  );
}
