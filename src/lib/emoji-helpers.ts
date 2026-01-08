import { getOrComputeCachedValue } from "applesauce-core/helpers";
import type { NostrEvent } from "@/types/nostr";

/**
 * Represents a parsed emoji tag from NIP-30
 */
export interface EmojiTag {
  shortcode: string;
  url: string;
}

/**
 * Symbol for caching parsed emoji tags on events
 */
const EmojiTagsSymbol = Symbol("emojiTags");

/**
 * Extract and cache emoji tags from an event
 * Uses applesauce's symbol-based caching to avoid recomputation
 *
 * Emoji tags format: ["emoji", "shortcode", "url"]
 */
export function getEmojiTags(event: NostrEvent): EmojiTag[] {
  return getOrComputeCachedValue(event, EmojiTagsSymbol, () =>
    event.tags
      .filter((tag) => tag[0] === "emoji" && tag[1] && tag[2])
      .map((tag) => ({
        shortcode: tag[1],
        url: tag[2],
      })),
  );
}
