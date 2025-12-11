import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { MediaEmbed } from "../MediaEmbed";
import { RichText } from "../RichText";
import { parseImetaTags } from "@/lib/imeta";

/**
 * Renderer for Kind 20 - Picture Event (NIP-68)
 * Picture-first feed events with imeta tags for image metadata
 */
export function Kind20Renderer({ event }: BaseEventProps) {
  // Parse imeta tags to get image URLs and metadata
  const images = parseImetaTags(event);

  // Get title from tags
  const title = event.tags.find((t) => t[0] === "title")?.[1];

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title if present */}
        {title && (
          <h3 dir="auto" className="text-base font-semibold text-start">
            {title}
          </h3>
        )}

        {/* Images */}
        {images.length > 0 && (
          <div className="flex flex-col gap-2">
            {images.map((img, i) => (
              <MediaEmbed
                key={i}
                url={img.url}
                alt={img.alt || title || "Picture"}
                preset="preview"
                enableZoom
              />
            ))}
          </div>
        )}

        {/* Description */}
        {event.content && <RichText event={event} className="text-sm" />}
      </div>
    </BaseEventContainer>
  );
}
