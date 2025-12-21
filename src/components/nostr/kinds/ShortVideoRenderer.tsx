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
 * Renderer for Kind 22 - Short Video Event (NIP-71)
 * Also handles Kind 34236 - Vertical Video (legacy NIP-71)
 *
 * Short-form portrait video events (like TikTok/Reels)
 */
export function Kind22Renderer({ event }: BaseEventProps) {
  // Get video URL (imeta or url tag fallback)
  const videoUrl = getVideoUrl(event);

  // Get title from tags
  const title = event.tags.find((t) => t[0] === "title")?.[1];

  // Get alt text for accessibility
  const altText = event.tags.find((t) => t[0] === "alt")?.[1];

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title if present */}
        {title && <h3 className="text-base font-semibold">{title}</h3>}

        {/* Short video - optimized for portrait */}
        {videoUrl ? (
          <MediaEmbed
            url={videoUrl}
            type="video"
            preset="preview"
            showControls
            alt={altText}
          />
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No video URL found
          </p>
        )}

        {/* Description - from content or alt tag */}
        {event.content ? (
          <RichText event={event} className="text-sm" />
        ) : (
          altText && <p className="text-sm text-muted-foreground">{altText}</p>
        )}
      </div>
    </BaseEventContainer>
  );
}
