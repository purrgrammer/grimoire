import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { MediaEmbed } from "../MediaEmbed";
import { RichText } from "../RichText";
import { parseImetaTags } from "@/lib/imeta";

/**
 * Renderer for Kind 22 - Short Video Event (NIP-71)
 * Short-form portrait video events (like TikTok/Reels)
 */
export function Kind22Renderer({ event }: BaseEventProps) {
  // Parse imeta tags to get video URLs and metadata
  const videos = parseImetaTags(event);

  // Get title from tags
  const title = event.tags.find((t) => t[0] === "title")?.[1];

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title if present */}
        {title && <h3 className="text-base font-semibold">{title}</h3>}

        {/* Short video - optimized for portrait */}
        {videos.length > 0 && (
          <MediaEmbed
            url={videos[0].url}
            type="video"
            preset="preview"
            showControls
          />
        )}

        {/* Description */}
        {event.content && <RichText event={event} className="text-sm" />}
      </div>
    </BaseEventContainer>
  );
}
