import { Smile } from "lucide-react";
import { getAddressPointerFromATag } from "applesauce-core/helpers";
import { getEmojiTags } from "@/lib/emoji-helpers";
import { CustomEmoji } from "@/components/nostr/CustomEmoji";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { EventRefListFull } from "../lists";
import type { NostrEvent } from "@/types/nostr";
import type { AddressPointer } from "nostr-tools/nip19";

/**
 * Extract address pointers from a tags (for emoji set references)
 */
function getEmojiSetPointers(event: NostrEvent): AddressPointer[] {
  const pointers: AddressPointer[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "a" && tag[1]) {
      const pointer = getAddressPointerFromATag(tag);
      // Only include kind 30030 (emoji sets)
      if (pointer && pointer.kind === 30030) {
        pointers.push(pointer);
      }
    }
  }
  return pointers;
}

/**
 * Kind 10030 Renderer - User Emoji List (Feed View)
 * NIP-51 list of favorite/preferred emojis
 */
export function EmojiListRenderer({ event }: BaseEventProps) {
  const emojis = getEmojiTags(event);
  const emojiSets = getEmojiSetPointers(event);

  // Show first 8 emojis in preview
  const previewEmojis = emojis.slice(0, 8);
  const remainingCount = emojis.length - previewEmojis.length;

  if (emojis.length === 0 && emojiSets.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No emojis configured
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Smile className="size-4 text-muted-foreground" />
          <span>Emoji Preferences</span>
        </ClickableEventTitle>

        {emojis.length > 0 && (
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

        {emojiSets.length > 0 && (
          <div className="text-xs text-muted-foreground">
            + {emojiSets.length} emoji sets
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          {emojis.length} emoji{emojis.length !== 1 ? "s" : ""}
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10030 Detail View - Full emoji list
 */
export function EmojiListDetailRenderer({ event }: { event: NostrEvent }) {
  const emojis = getEmojiTags(event);
  const emojiSets = getEmojiSetPointers(event);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <Smile className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Emoji Preferences</span>
      </div>

      {emojis.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-semibold">Custom Emojis ({emojis.length})</span>
          <div className="flex flex-wrap gap-2">
            {emojis.map((emoji) => (
              <div
                key={emoji.shortcode}
                className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded"
              >
                <CustomEmoji
                  shortcode={emoji.shortcode}
                  url={emoji.url}
                  size="md"
                />
                <span className="text-xs text-muted-foreground">
                  :{emoji.shortcode}:
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {emojiSets.length > 0 && (
        <EventRefListFull
          addressPointers={emojiSets}
          label="Emoji Sets"
          icon={<Smile className="size-5" />}
        />
      )}

      {emojis.length === 0 && emojiSets.length === 0 && (
        <div className="text-sm text-muted-foreground italic">
          No emojis configured
        </div>
      )}
    </div>
  );
}
