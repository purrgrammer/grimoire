import { describe, it, expect } from "vitest";
import { withEmojiTags, sanitizeCachedProfile } from "./useProfile";
import type { ProfileContent } from "applesauce-core/helpers";
import type { EmojiTag } from "@/lib/emoji-helpers";

/**
 * The crash: `getProfileContent` returns the kind 0's JSON verbatim, so a
 * profile publishing an `emojis` field of its own reached `EmojiText` as
 * whatever type its author chose — and a string cleared every length check on
 * the way to `.map`.
 */
const poisoned = {
  name: "spider",
  emojis: "🔥",
} as unknown as ProfileContent;

const tags: EmojiTag[] = [{ shortcode: "H", url: "https://example.com/h.png" }];

describe("withEmojiTags", () => {
  it("drops an `emojis` field the content carried", () => {
    expect(withEmojiTags(poisoned, []).emojis).toBeUndefined();
  });

  it("replaces it with the event's own emoji tags", () => {
    expect(withEmojiTags(poisoned, tags).emojis).toEqual(tags);
  });

  it("keeps the rest of the profile", () => {
    expect(withEmojiTags(poisoned, []).name).toBe("spider");
  });

  it("does not mutate the memoized content object", () => {
    withEmojiTags(poisoned, tags);
    expect((poisoned as unknown as { emojis: string }).emojis).toBe("🔥");
  });
});

describe("sanitizeCachedProfile", () => {
  // Rows written before this was enforced still hold what the content carried.
  it("strips a non-array `emojis` read back out of Dexie", () => {
    expect(sanitizeCachedProfile(poisoned).emojis).toBeUndefined();
  });

  it("leaves a real emoji array alone", () => {
    const good = { name: "spider", emojis: tags };
    expect(sanitizeCachedProfile(good)).toBe(good);
  });
});
