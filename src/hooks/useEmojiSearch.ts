import { useEffect, useCallback } from "react";
import emojiSearchService, {
  type EmojiSearchResult,
} from "@/services/emoji-search";
import type { NostrEvent } from "@/types/nostr";

/**
 * Hook to provide emoji search functionality.
 *
 * The singleton EmojiSearchService is initialized and kept in sync by
 * useEmojiSearchSync (called once in AppShell). This hook is a thin
 * wrapper that exposes search and handles per-component context emojis.
 */
export function useEmojiSearch(contextEvent?: NostrEvent) {
  // Add context emojis when context event changes (per-component, transient)
  useEffect(() => {
    if (contextEvent) {
      emojiSearchService.addContextEmojis(contextEvent);
    }
  }, [contextEvent]);

  const searchEmojis = useCallback(
    async (query: string): Promise<EmojiSearchResult[]> => {
      return emojiSearchService.search(query, { limit: 200 });
    },
    [],
  );

  return {
    searchEmojis,
    service: emojiSearchService,
  };
}
