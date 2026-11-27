import { describe, expect, it } from "vitest";
import {
  getParsedContent,
  textNoteTransformers,
} from "applesauce-content/text";
import {
  MAX_BIG_EMOJI,
  MAX_BIG_EMOJI_LINE_BREAKS,
  getEmojiOnlyTier,
  isEmojiGrapheme,
} from "./emoji-only";
import type { NostrEvent } from "@/types/nostr";

const BLOB = "https://emoji.example/blob.png";

function note(content: string, tags: string[][] = []): NostrEvent {
  return {
    id: "0".repeat(64),
    pubkey: "1".repeat(64),
    created_at: 1,
    kind: 1,
    sig: "2".repeat(128),
    content,
    tags,
  };
}

/** The tier of a post, parsed the way `RichText` parses it. */
function tierOf(content: string, tags: string[][] = []) {
  return getEmojiOnlyTier(
    getParsedContent(
      note(content, tags),
      undefined,
      textNoteTransformers,
      null,
    ),
  );
}

describe("isEmojiGrapheme", () => {
  it.each([
    ["plain", "😀"],
    ["variation selector", "❤️"],
    ["skin tone", "👍🏽"],
    ["ZWJ family", "👨‍👩‍👧‍👦"],
    ["ZWJ with selector", "🏳️‍🌈"],
    ["flag", "🇸🇪"],
    ["subdivision flag", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"],
    ["keycap", "1️⃣"],
    ["keycap #", "#️⃣"],
  ])("accepts %s", (_name, grapheme) => {
    expect(isEmojiGrapheme(grapheme)).toBe(true);
  });

  it.each([
    ["digit", "1"],
    ["hash", "#"],
    ["asterisk", "*"],
    ["letter", "a"],
    ["punctuation", "!"],
    ["text-style heart, no selector", "\u2764"],
    ["trademark", "™"],
    ["copyright", "©"],
    ["emoji forced to text style", "😀\uFE0E"],
    ["keycap without selector", "1\u20E3"],
    ["half a flag", "🇸"],
    ["a bare joiner", "\u200D"],
    ["a bare selector", "\uFE0F"],
  ])("rejects %s", (_name, grapheme) => {
    expect(isEmojiGrapheme(grapheme)).toBe(false);
  });
});

describe("getEmojiOnlyTier", () => {
  it("is null without a tree", () => {
    expect(getEmojiOnlyTier(undefined)).toBeNull();
  });

  it("puts a lone emoji in the single tier, however long its sequence", () => {
    expect(tierOf("😀")).toBe("single");
    expect(tierOf("👨‍👩‍👧‍👦")).toBe("single");
    expect(tierOf("🇸🇪")).toBe("single");
    expect(tierOf("1️⃣")).toBe("single");
    expect(tierOf("👍🏽")).toBe("single");
  });

  it("puts two to ten emoji in the multi tier", () => {
    expect(tierOf("😀😀")).toBe("multi");
    expect(tierOf("🇸🇪🇧🇷")).toBe("multi");
    expect(tierOf("😀".repeat(MAX_BIG_EMOJI))).toBe("multi");
  });

  it("leaves a wall of emoji at normal size", () => {
    expect(tierOf("😀".repeat(MAX_BIG_EMOJI + 1))).toBeNull();
    expect(tierOf("😀".repeat(500))).toBeNull();
  });

  it("ignores spaces and newlines between emoji", () => {
    expect(tierOf("😀 🎉")).toBe("multi");
    expect(tierOf("😀\n🎉")).toBe("multi");
    expect(tierOf("  😀\t\n\n 🎉  ")).toBe("multi");
    expect(tierOf(" 😀 ")).toBe("single");
  });

  it("bounds the line breaks, counting CRLF once", () => {
    const breaks = (n: number, nl = "\n") => `😀${nl.repeat(n)}😀`;
    expect(tierOf(breaks(MAX_BIG_EMOJI_LINE_BREAKS))).toBe("multi");
    expect(tierOf(breaks(MAX_BIG_EMOJI_LINE_BREAKS + 1))).toBeNull();
    expect(tierOf(breaks(MAX_BIG_EMOJI_LINE_BREAKS, "\r\n"))).toBe("multi");
  });

  it("is null for an empty or whitespace-only post", () => {
    expect(tierOf("")).toBeNull();
    expect(tierOf("  \n ")).toBeNull();
  });

  it("counts a custom emoji whose shortcode has a matching tag", () => {
    expect(tierOf(":blob:", [["emoji", "blob", BLOB]])).toBe("single");
    expect(tierOf(":blob::blob:", [["emoji", "blob", BLOB]])).toBe("multi");
    expect(tierOf(":blob: :blob:\n:blob:", [["emoji", "blob", BLOB]])).toBe(
      "multi",
    );
  });

  it("mixes custom and native emoji", () => {
    expect(tierOf("😀 :blob: 🇸🇪", [["emoji", "blob", BLOB]])).toBe("multi");
    expect(tierOf(":blob:👨‍👩‍👧‍👦", [["emoji", "blob", BLOB]])).toBe("multi");
  });

  it("counts custom and native emoji against the same limit", () => {
    const tags = [["emoji", "blob", BLOB]];
    expect(tierOf(":blob:".repeat(5) + "😀".repeat(5), tags)).toBe("multi");
    expect(tierOf(":blob:".repeat(5) + "😀".repeat(6), tags)).toBeNull();
    expect(tierOf(":blob:".repeat(MAX_BIG_EMOJI + 1), tags)).toBeNull();
  });

  it("treats a shortcode with no matching tag as text", () => {
    expect(tierOf(":blob:")).toBeNull();
    expect(tierOf(":blob:", [["emoji", "other", BLOB]])).toBeNull();
    expect(tierOf("😀 :nope:", [["emoji", "blob", BLOB]])).toBeNull();
  });

  it("does not count a custom emoji whose URL cannot load", () => {
    expect(tierOf(":blob:", [["emoji", "blob", "javascript:alert(1)"]])).toBe(
      null,
    );
    expect(tierOf(":blob:", [["emoji", "blob", "not a url"]])).toBeNull();
    expect(tierOf(":blob:", [["emoji", "blob", ""]])).toBeNull();
    expect(tierOf(":blob:", [["emoji", "blob"]])).toBeNull();
  });

  it.each([
    ["text after", "😀 nice"],
    ["text before", "gm 😀"],
    ["punctuation", "😀!"],
    ["only punctuation", "!!!"],
    ["a digit", "1"],
    ["digits and symbols", "1 # *"],
    ["emoji then digit", "😀1"],
    ["text-style symbol", "\u2764"],
    ["a link", "😀 https://example.com"],
    ["an image link", "https://example.com/a.png"],
    ["a hashtag", "😀 #nostr"],
    ["a markdown wrapper", "**😀**"],
    ["an inline code wrapper", "`😀`"],
    ["a code fence", "```\n😀\n```"],
    ["a quote marker", "> 😀"],
  ])("is null with %s", (_name, content) => {
    expect(tierOf(content)).toBeNull();
  });

  it("is null when the post mentions or quotes something", () => {
    const npub =
      "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
    expect(tierOf(`😀 nostr:${npub}`)).toBeNull();
  });
});
