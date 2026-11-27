/**
 * Deciding whether a post is "emoji-only", so its body can render larger.
 *
 * The behaviour is inspired by Ditto (soapbox-pub/ditto, AGPL-3.0-or-later,
 * `src/components/NoteContent.tsx` at dfd7fea): a post of one to ten emoji
 * shows big, and a lone emoji bigger still. Only that design was taken —
 * the thresholds and the two tiers. This is an independent implementation:
 * Ditto matches one regex over the raw string, where this walks the tree
 * `RichText` has already parsed and segments graphemes with `Intl.Segmenter`.
 *
 * Working on the parsed tree is what makes the definition semantic rather than
 * textual. A link, mention, hashtag, gallery, NIP or relay reference is a node
 * of its own, so its presence disqualifies the post without this file knowing
 * what any of them look like. And a `:shortcode:` is an `emoji` node only when
 * the event carries a matching NIP-30 tag — an unknown one is still text, and
 * its letters fail the test below.
 */

import type { Root } from "applesauce-content/nast";

/** How large an emoji-only post renders: a lone emoji, or a short run. */
export type EmojiOnlyTier = "single" | "multi";

/** More emoji than this and the post is a wall, which stays at normal size. */
export const MAX_BIG_EMOJI = 10;

/**
 * Line breaks an emoji-only post may contain. `RichText` preserves newlines, so
 * without a bound ten emoji spread over fifty lines would scale all fifty.
 */
export const MAX_BIG_EMOJI_LINE_BREAKS = 10;

/** `1️⃣`, `#️⃣`, `*️⃣` — the selector is required, as a bare `1⃣` is text. */
const KEYCAP = /^[0-9#*]\uFE0F\u20E3$/u;

/** A flag: exactly two regional indicators. */
const FLAG = /^\p{Regional_Indicator}{2}$/u;

/**
 * Every code point an emoji grapheme may be built from: pictographs, plus the
 * joiners, selectors, skin tones and tag characters that modify them.
 * `Emoji_Component` also admits digits, `#` and `*`, which is why this alone
 * decides nothing — see {@link RENDERS_AS_EMOJI}.
 */
const EMOJI_PARTS = /^[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;

/**
 * What makes a grapheme actually draw as an emoji: a code point with default
 * emoji presentation, or a pictograph explicitly asked to be one with U+FE0F.
 * A bare `❤`, `☺` or `™` has neither and renders as a text glyph, so it does
 * not count; neither does a digit, which is `Emoji` but never pictographic.
 */
const RENDERS_AS_EMOJI =
  /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;

/** Whether one grapheme cluster is a single Unicode emoji. */
export function isEmojiGrapheme(grapheme: string): boolean {
  if (KEYCAP.test(grapheme) || FLAG.test(grapheme)) return true;
  // A lone regional indicator has emoji presentation but is half a flag.
  if (/^\p{Regional_Indicator}$/u.test(grapheme)) return false;
  return EMOJI_PARTS.test(grapheme) && RENDERS_AS_EMOJI.test(grapheme);
}

let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== "undefined" && "Segmenter" in Intl
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
  }
  return segmenter;
}

/** A run of text's emoji and line breaks, or null if it holds anything else. */
function countTextEmoji(
  text: string,
): { emoji: number; lineBreaks: number } | null {
  const graphemes = getSegmenter();
  // No segmenter, no way to tell a ZWJ family from four people: stay normal.
  if (!graphemes) return null;

  let emoji = 0;
  let lineBreaks = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (/^\s+$/u.test(segment)) {
      // "\r\n" is one grapheme and one break.
      if (/[\n\r\p{Zl}\p{Zp}]/u.test(segment)) lineBreaks++;
      continue;
    }
    if (!isEmojiGrapheme(segment)) return null;
    // Bail as soon as the answer is known, so a wall is not walked to its end.
    if (++emoji > MAX_BIG_EMOJI) return null;
  }
  return { emoji, lineBreaks };
}

/** A custom emoji that can only ever render as its broken-image fallback. */
function hasLoadableUrl(url: unknown): boolean {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/**
 * The size tier for a parsed post body, or null when it is not emoji-only.
 *
 * Emoji-only means every top-level node is a NIP-30 custom emoji or text made
 * solely of Unicode emoji and whitespace, with between one and
 * {@link MAX_BIG_EMOJI} emoji in total.
 */
export function getEmojiOnlyTier(
  tree: Pick<Root, "children"> | undefined,
): EmojiOnlyTier | null {
  if (!tree) return null;

  let emoji = 0;
  let lineBreaks = 0;

  for (const node of tree.children) {
    if (node.type === "emoji") {
      if (!hasLoadableUrl(node.url)) return null;
      emoji++;
    } else if (node.type === "text") {
      const counted = countTextEmoji(node.value);
      if (!counted) return null;
      emoji += counted.emoji;
      lineBreaks += counted.lineBreaks;
    } else {
      return null;
    }
    if (emoji > MAX_BIG_EMOJI || lineBreaks > MAX_BIG_EMOJI_LINE_BREAKS) {
      return null;
    }
  }

  if (emoji === 0) return null;
  return emoji === 1 ? "single" : "multi";
}
