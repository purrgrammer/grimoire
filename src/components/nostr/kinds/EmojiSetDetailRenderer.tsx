import { getTagValue } from "applesauce-core/helpers";
import { getEmojiTags } from "@/lib/emoji-helpers";
import { Emoji } from "@/components/nostr/Emoji";
import { NostrEvent } from "@/types/nostr";

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
      <h1 className="text-2xl font-bold">{identifier}</h1>

      {/* Empty state */}
      {emojis.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          This emoji set is empty
        </div>
      ) : (
        <>
          {/* Emoji list - one per row */}
          <div className="flex flex-col gap-1">
            {emojis.map((emoji) => (
              <div
                key={emoji.shortcode}
                className="inline-flex items-center gap-2 px-2 py-1 rounded bg-muted/30 w-fit"
              >
                <Emoji
                  source="custom"
                  value={emoji.url}
                  shortcode={emoji.shortcode}
                  size="md"
                />
                <span className="text-sm font-mono text-muted-foreground">
                  :{emoji.shortcode}:
                </span>
              </div>
            ))}
          </div>

          {/* Count */}
          <p className="text-sm text-muted-foreground">
            {emojis.length} emoji{emojis.length !== 1 ? "s" : ""} in this set
          </p>
        </>
      )}
    </div>
  );
}
