import { useState, useEffect, useCallback } from "react";
import emojiFrequencyService from "@/services/emoji-frequency";
import type { EmojiFrequency } from "@/services/db";

/**
 * Hook for accessing emoji frequency data and recording usage
 *
 * Provides:
 * - Top frequently used emojis
 * - Function to record emoji usage
 * - Whether user has any history (for cold start UI)
 */
export function useEmojiFrequency(limit: number = 8) {
  const [topEmojis, setTopEmojis] = useState<EmojiFrequency[]>([]);
  const [hasHistory, setHasHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [emojis, history] = await Promise.all([
          emojiFrequencyService.getTopEmojis(limit),
          emojiFrequencyService.hasHistory(),
        ]);
        setTopEmojis(emojis);
        setHasHistory(history);
      } catch (error) {
        console.error("[useEmojiFrequency] Failed to load data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [limit]);

  // Record usage and refresh top emojis
  const recordUsage = useCallback(
    async (
      key: string,
      source: "unicode" | "custom",
      shortcode: string,
      url?: string,
    ) => {
      await emojiFrequencyService.recordUsage(key, source, shortcode, url);

      // Refresh top emojis after recording
      const updated = await emojiFrequencyService.getTopEmojis(limit);
      setTopEmojis(updated);
      setHasHistory(true);
    },
    [limit],
  );

  // Convenience method for recording unicode emoji
  const recordUnicodeUsage = useCallback(
    async (emoji: string, shortcode: string) => {
      await recordUsage(emoji, "unicode", shortcode);
    },
    [recordUsage],
  );

  // Convenience method for recording custom emoji
  const recordCustomUsage = useCallback(
    async (shortcode: string, url: string) => {
      await recordUsage(`:${shortcode}:`, "custom", shortcode, url);
    },
    [recordUsage],
  );

  return {
    topEmojis,
    hasHistory,
    isLoading,
    recordUsage,
    recordUnicodeUsage,
    recordCustomUsage,
  };
}
