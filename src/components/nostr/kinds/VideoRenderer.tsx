import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { MediaEmbed } from "../MediaEmbed";
import { RichText } from "../RichText";
import { parseImetaTags } from "@/lib/imeta";

/**
 * Get video URL from event - tries imeta first, then url tag
 */
function getVideoUrl(event: {
  tags: string[][];
  content: string;
}): string | null {
  // Try imeta tags first (NIP-92)
  const videos = parseImetaTags(event as any);
  if (videos.length > 0 && videos[0].url) {
    return videos[0].url;
  }

  // Fallback: try url tag (older NIP-71 format)
  const urlTag = event.tags.find((t) => t[0] === "url")?.[1];
  if (urlTag) {
    return urlTag;
  }

  return null;
}

/**
 * Renderer for Kind 21 - Video Event (NIP-71)
 * Also handles Kind 34235 - Horizontal Video (legacy NIP-71)
 *
 * Horizontal/landscape video events with imeta tags or url tag
 */
export function Kind21Renderer({ event }: BaseEventProps) {
  // Get video URL (imeta or url tag fallback)
  const videoUrl = getVideoUrl(event);

  // Get title from tags
  const title = event.tags.find((t) => t[0] === "title")?.[1];

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title if present */}
        {title && <h3 className="text-base font-semibold">{title}</h3>}

        {/* Video player */}
        {videoUrl ? (
          <MediaEmbed
            url={videoUrl}
            type="video"
            preset="preview"
            showControls
          />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No video URL found
          </p>
        )}

        {/* Description */}
        {event.content && <RichText event={event} className="text-sm" />}
      </div>
    </BaseEventContainer>
  );
}
