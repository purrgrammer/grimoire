import { getOrComputeCachedValue } from "applesauce-core/helpers";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import type { Emoji } from "applesauce-common/helpers/emoji";
import type { NostrEvent } from "@/types/nostr";

/**
 * Regex pattern to match NIP-30 custom emoji shortcodes like :shortcode:
 * Supports alphanumeric characters, underscores, and dashes
 */
export const EMOJI_SHORTCODE_REGEX = /^:([a-zA-Z0-9_-]+):$/;

/**
 * Represents a parsed emoji tag from NIP-30
 */
export interface EmojiTag {
  shortcode: string;
  url: string;
  /** NIP-30 optional 4th tag: "30030:pubkey:identifier" address of the emoji set */
  address?: string;
}

/**
 * Convert a Grimoire {@link EmojiTag} to an applesauce `Emoji`.
 *
 * Grimoire carries the NIP-30 emoji set address as the raw
 * "30030:pubkey:identifier" string; applesauce expects a parsed
 * `AddressPointer`. An unparseable address is dropped rather than throwing —
 * the emoji is still valid without it.
 */
export function toApplesauceEmoji(emoji: EmojiTag): Emoji {
  if (!emoji.address) {
    return { shortcode: emoji.shortcode, url: emoji.url };
  }

  try {
    const address = parseReplaceableAddress(emoji.address);
    return address
      ? { shortcode: emoji.shortcode, url: emoji.url, address }
      : { shortcode: emoji.shortcode, url: emoji.url };
  } catch {
    return { shortcode: emoji.shortcode, url: emoji.url };
  }
}

/** Convert an array of Grimoire emoji tags to applesauce `Emoji` objects */
export function toApplesauceEmojis(emojis: EmojiTag[]): Emoji[] {
  return emojis.map(toApplesauceEmoji);
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
