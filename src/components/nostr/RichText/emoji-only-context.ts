import { createContext, useContext } from "react";
import type { EmojiOnlyTier } from "@/lib/emoji-only";

interface EmojiOnlyState {
  /** The size tier of the body being rendered, or null if it is normal size. */
  tier: EmojiOnlyTier | null;
  /**
   * Called by an emoji node whose image did not load. An enlarged body made of
   * a shortcode's fallback text is a 48px line holding 14px words, so the body
   * goes back to normal size instead.
   */
  onImageError: () => void;
}

/**
 * Tells the emoji nodes of a `RichText` body that the body around them is
 * enlarged, so custom emoji images can size themselves to match.
 */
export const EmojiOnlyContext = createContext<EmojiOnlyState>({
  tier: null,
  onImageError: () => {},
});

export function useEmojiOnly() {
  return useContext(EmojiOnlyContext);
}
