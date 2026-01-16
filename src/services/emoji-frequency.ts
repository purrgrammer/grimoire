import db, { type EmojiFrequency } from "./db";
import { DEFAULT_POPULAR_EMOJIS } from "@/lib/emoji-defaults";

/**
 * Service for tracking and retrieving emoji usage frequency
 *
 * Stores frequency data in IndexedDB via Dexie for persistence across sessions.
 * Provides cold start defaults when no history exists.
 */
class EmojiFrequencyService {
  /**
   * Record an emoji usage event
   *
   * @param key - Unique identifier (emoji char for unicode, `:shortcode:` for custom)
   * @param source - Whether this is a unicode or custom emoji
   * @param shortcode - The shortcode (without colons)
   * @param url - For custom emoji, the image URL
   */
  async recordUsage(
    key: string,
    source: "unicode" | "custom",
    shortcode: string,
    url?: string,
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    try {
      const existing = await db.emojiFrequency.get(key);

      if (existing) {
        // Increment existing entry
        await db.emojiFrequency.update(key, {
          count: existing.count + 1,
          lastUsed: now,
          // Update URL in case it changed (for custom emoji)
          ...(url && { url }),
        });
      } else {
        // Create new entry
        await db.emojiFrequency.add({
          key,
          count: 1,
          lastUsed: now,
          source,
          shortcode,
          url,
        });
      }
    } catch (error) {
      console.error("[EmojiFrequencyService] Failed to record usage:", error);
    }
  }

  /**
   * Get top N frequently used emojis
   *
   * Returns cold start defaults if no history exists.
   *
   * @param limit - Maximum number of emojis to return
   */
  async getTopEmojis(limit: number = 8): Promise<EmojiFrequency[]> {
    try {
      // Query sorted by count descending, then by lastUsed descending
      const stored = await db.emojiFrequency
        .orderBy("count")
        .reverse()
        .limit(limit * 2) // Fetch more to allow for secondary sorting
        .toArray();

      if (stored.length === 0) {
        // Cold start: return defaults
        return DEFAULT_POPULAR_EMOJIS.slice(0, limit).map((e, i) => ({
          key: e.emoji,
          count: DEFAULT_POPULAR_EMOJIS.length - i, // Pseudo-count for ordering
          lastUsed: 0,
          source: "unicode" as const,
          shortcode: e.shortcode,
        }));
      }

      // Secondary sort by lastUsed for entries with same count
      stored.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.lastUsed - a.lastUsed;
      });

      return stored.slice(0, limit);
    } catch (error) {
      console.error("[EmojiFrequencyService] Failed to get top emojis:", error);
      // Return defaults on error
      return DEFAULT_POPULAR_EMOJIS.slice(0, limit).map((e, i) => ({
        key: e.emoji,
        count: DEFAULT_POPULAR_EMOJIS.length - i,
        lastUsed: 0,
        source: "unicode" as const,
        shortcode: e.shortcode,
      }));
    }
  }

  /**
   * Get frequency count for a specific emoji
   *
   * @param key - The emoji key
   * @returns The usage count, or 0 if not found
   */
  async getFrequency(key: string): Promise<number> {
    try {
      const entry = await db.emojiFrequency.get(key);
      return entry?.count ?? 0;
    } catch (error) {
      console.error("[EmojiFrequencyService] Failed to get frequency:", error);
      return 0;
    }
  }

  /**
   * Get all frequency data as a Map for batch operations
   *
   * Useful for boosting search results without multiple DB queries.
   */
  async getAllFrequencies(): Promise<Map<string, number>> {
    try {
      const entries = await db.emojiFrequency.toArray();
      return new Map(entries.map((e) => [e.key, e.count]));
    } catch (error) {
      console.error(
        "[EmojiFrequencyService] Failed to get all frequencies:",
        error,
      );
      return new Map();
    }
  }

  /**
   * Check if user has any emoji history
   */
  async hasHistory(): Promise<boolean> {
    try {
      const count = await db.emojiFrequency.count();
      return count > 0;
    } catch (error) {
      console.error("[EmojiFrequencyService] Failed to check history:", error);
      return false;
    }
  }

  /**
   * Clear all frequency data
   *
   * Useful for settings/reset functionality.
   */
  async clearAll(): Promise<void> {
    try {
      await db.emojiFrequency.clear();
      console.log("[EmojiFrequencyService] Cleared all emoji frequency data");
    } catch (error) {
      console.error(
        "[EmojiFrequencyService] Failed to clear frequency data:",
        error,
      );
    }
  }
}

// Export singleton instance
const emojiFrequencyService = new EmojiFrequencyService();
export default emojiFrequencyService;
