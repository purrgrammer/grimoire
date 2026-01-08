import { getTagValue } from "applesauce-core/helpers";
import { getEmojiTags } from "@/lib/emoji-helpers";
import { CustomEmoji } from "@/components/nostr/CustomEmoji";
import { NostrEvent } from "@/types/nostr";
import { Smile } from "lucide-react";

/**
 * Kind 30030 Detail Renderer - Emoji Set (Detail View)
 * Shows the full emoji set in a grid
 */
export function EmojiSetDetailRenderer({ event }: { event: NostrEvent }) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const emojis = getEmojiTags(event);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Smile className="size-6 text-muted-foreground" />
          {identifier}
        </h1>
        <p className="text-sm text-muted-foreground">
          {emojis.length} emoji{emojis.length !== 1 ? "s" : ""} in this set
        </p>
      </div>

      {/* Empty state */}
      {emojis.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          This emoji set is empty
        </div>
      ) : (
        /* Emoji grid */
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {emojis.map((emoji) => (
            <div
              key={emoji.shortcode}
              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-muted/30"
              title={`:${emoji.shortcode}:`}
            >
              <CustomEmoji
                shortcode={emoji.shortcode}
                url={emoji.url}
                size="lg"
              />
              <div className="text-xs text-muted-foreground font-mono truncate max-w-full px-1">
                :{emoji.shortcode}:
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
