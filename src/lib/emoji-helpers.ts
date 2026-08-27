import { getOrComputeCachedValue, getTagValue } from "applesauce-core/helpers";
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

/** Unanchored twin of {@link EMOJI_SHORTCODE_REGEX} for finding shortcodes inline */
const INLINE_EMOJI_SHORTCODE_REGEX = /:([a-zA-Z0-9_-]+):/g;

export type EmojiSegment =
  | { type: "text"; value: string }
  | { type: "emoji"; shortcode: string; url: string };

/**
 * Split text into literal runs and NIP-30 custom emoji, resolving shortcodes
 * against `emojis`. Unknown shortcodes stay literal text.
 */
export function parseEmojiSegments(
  text: string,
  emojis?: EmojiTag[],
): EmojiSegment[] {
  if (!text) return [];
  // `Array.isArray`, not a truthiness-and-length test. `emojis` reaches here
  // from a kind 0's own JSON by way of `useProfile`, and a profile that
  // publishes `"emojis": "🔥"` satisfies `emojis.length > 0` all the way to
  // `emojis.map`, which a string does not have — one such profile crashed every
  // feed row that rendered its name.
  if (!Array.isArray(emojis) || emojis.length === 0)
    return [{ type: "text", value: text }];

  const byShortcode = new Map(emojis.map((e) => [e.shortcode, e.url]));
  const segments: EmojiSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_EMOJI_SHORTCODE_REGEX)) {
    const url = byShortcode.get(match[1]);
    if (!url) continue;

    const start = match.index;
    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }
    segments.push({ type: "emoji", shortcode: match[1], url });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments;
}

/**
 * Flatten NIP-30 shortcodes to their bare codes — `":H::e:!!"` → `"He!!"`.
 * For text indexes and other plain-text contexts that can't render an image;
 * dropping the emoji entirely would leave a name searchable by nothing.
 */
export function emojiShortcodesToPlainText(
  text: string,
  emojis?: EmojiTag[],
): string {
  return parseEmojiSegments(text, emojis)
    .map((segment) =>
      segment.type === "text" ? segment.value : segment.shortcode,
    )
    .join("");
}

/**
 * Human name of a NIP-30 emoji set (kind 30030). Prefers the `title` tag, then
 * the `name` tag some clients publish, and only falls back to the `d`
 * identifier — which is an address component, not a display name.
 */
export function getEmojiSetName(event: NostrEvent): string {
  return (
    getTagValue(event, "title") ||
    getTagValue(event, "name") ||
    getTagValue(event, "d") ||
    "unnamed"
  );
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
