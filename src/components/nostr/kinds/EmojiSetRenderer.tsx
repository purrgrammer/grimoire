import { getTagValue } from "applesauce-core/helpers";
import { getEmojiTags } from "@/lib/emoji-helpers";
import { CustomEmoji } from "@/components/nostr/CustomEmoji";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";

/**
 * Kind 30030 Renderer - Emoji Set (Feed View)
 * Shows a preview of the emoji set with a few emojis
 */
export function EmojiSetRenderer({ event }: BaseEventProps) {
  const identifier = getTagValue(event, "d") || "unnamed";
  const emojis = getEmojiTags(event);

  // Show first 8 emojis in feed view
  const previewEmojis = emojis.slice(0, 8);
  const remainingCount = emojis.length - previewEmojis.length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="text-sm font-medium text-foreground"
        >
          {identifier}
        </ClickableEventTitle>

        {emojis.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Empty emoji set
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 items-center">
            {previewEmojis.map((emoji) => (
              <CustomEmoji
                key={emoji.shortcode}
                shortcode={emoji.shortcode}
                url={emoji.url}
                size="md"
              />
            ))}
            {remainingCount > 0 && (
              <span className="text-xs text-muted-foreground">
                +{remainingCount} more
              </span>
            )}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          {emojis.length} emoji{emojis.length !== 1 ? "s" : ""}
        </div>
      </div>
    </BaseEventContainer>
  );
}
