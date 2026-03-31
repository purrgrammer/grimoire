import dataByEmoji from "unicode-emoji-json/data-by-emoji.json";
import emojilib from "emojilib";

/**
 * Comprehensive Unicode emoji list derived from unicode-emoji-json.
 * ~1,900 RGI emojis with slugs as shortcodes.
 */
export const UNICODE_EMOJIS: Array<{ shortcode: string; emoji: string }> =
  Object.entries(dataByEmoji).map(([emoji, data]) => ({
    shortcode: data.slug,
    emoji,
  }));

/**
 * Keyword map for enriched search indexing (from emojilib).
 * Maps emoji character → array of search keywords.
 * e.g. "😀" → ["grinning_face", "face", "smile", "happy", "joy", ":D", "grin"]
 */
export const EMOJI_KEYWORDS: Record<string, string[]> = emojilib;
