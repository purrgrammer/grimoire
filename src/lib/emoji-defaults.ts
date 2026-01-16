/**
 * Default popular emoji for cold start (no usage history)
 * Based on common reactions across Nostr and social platforms
 */
export const DEFAULT_POPULAR_EMOJIS = [
  { shortcode: "thumbsup", emoji: "\u{1F44D}" }, // 👍
  { shortcode: "heart", emoji: "\u{2764}\u{FE0F}" }, // ❤️
  { shortcode: "fire", emoji: "\u{1F525}" }, // 🔥
  { shortcode: "joy", emoji: "\u{1F602}" }, // 😂
  { shortcode: "zap", emoji: "\u{26A1}" }, // ⚡ (Nostr-specific)
  { shortcode: "100", emoji: "\u{1F4AF}" }, // 💯
  { shortcode: "rocket", emoji: "\u{1F680}" }, // 🚀
  { shortcode: "eyes", emoji: "\u{1F440}" }, // 👀
] as const;

/**
 * Extended set of popular emoji shortcodes for search boost
 * These get a small relevance boost in search results
 */
export const POPULAR_EMOJI_SHORTCODES = new Set([
  "thumbsup",
  "+1",
  "heart",
  "fire",
  "joy",
  "rofl",
  "smile",
  "zap",
  "100",
  "rocket",
  "eyes",
  "pray",
  "clap",
  "tada",
  "thinking",
  "skull",
  "sparkles",
  "star",
  "raised_hands",
]);
