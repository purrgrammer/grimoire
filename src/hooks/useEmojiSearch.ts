import { useEffect, useMemo, useRef, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import {
  EmojiSearchService,
  type EmojiSearchResult,
} from "@/services/emoji-search";
import { UNICODE_EMOJIS } from "@/lib/unicode-emojis";
import eventStore from "@/services/event-store";
import accounts from "@/services/accounts";
import emojiFrequencyService from "@/services/emoji-frequency";
import type { NostrEvent } from "@/types/nostr";

/**
 * Hook to provide emoji search functionality with automatic indexing
 * of Unicode emojis and user's custom emojis from the event store
 */
export function useEmojiSearch(contextEvent?: NostrEvent) {
  const serviceRef = useRef<EmojiSearchService | null>(null);
  const activeAccount = use$(accounts.active$);

  // Create service instance (singleton per component mount)
  if (!serviceRef.current) {
    serviceRef.current = new EmojiSearchService();
    // Load Unicode emojis immediately
    serviceRef.current.addUnicodeEmojis(UNICODE_EMOJIS);
  }

  const service = serviceRef.current;

  // Add context emojis when context event changes
  useEffect(() => {
    if (contextEvent) {
      service.addContextEmojis(contextEvent);
    }
  }, [contextEvent, service]);

  // Subscribe to user's emoji list (kind 10030) and emoji sets (kind 30030)
  useEffect(() => {
    if (!activeAccount?.pubkey) {
      return;
    }

    const pubkey = activeAccount.pubkey;

    // Subscribe to user's emoji list (kind 10030 - replaceable)
    const userEmojiList$ = eventStore.replaceable(10030, pubkey);
    const userEmojiSub = userEmojiList$.subscribe({
      next: (event) => {
        if (event) {
          service.addUserEmojiList(event);

          // Also load referenced emoji sets from "a" tags
          const aTags = event.tags.filter(
            (t) => t[0] === "a" && t[1]?.startsWith("30030:"),
          );
          for (const aTag of aTags) {
            const [, coordinate] = aTag;
            const [kind, setPubkey, identifier] = coordinate.split(":");
            if (kind && setPubkey && identifier !== undefined) {
              // Subscribe to each referenced emoji set
              const emojiSet$ = eventStore.replaceable(
                parseInt(kind, 10),
                setPubkey,
                identifier,
              );
              emojiSet$.subscribe({
                next: (setEvent) => {
                  if (setEvent) {
                    service.addEmojiSet(setEvent);
                  }
                },
              });
            }
          }
        }
      },
      error: (error) => {
        console.error("Failed to load user emoji list:", error);
      },
    });

    // Also subscribe to any emoji sets authored by the user
    const userEmojiSets$ = eventStore.timeline([
      { kinds: [30030], authors: [pubkey], limit: 50 },
    ]);
    const userEmojiSetsSub = userEmojiSets$.subscribe({
      next: (events) => {
        for (const event of events) {
          service.addEmojiSet(event);
        }
      },
      error: (error) => {
        console.error("Failed to load user emoji sets:", error);
      },
    });

    return () => {
      userEmojiSub.unsubscribe();
      userEmojiSetsSub.unsubscribe();
      // Clear custom emojis but keep unicode
      service.clearCustom();
    };
  }, [activeAccount?.pubkey, service]);

  // Load frequency data for prioritizing frequently used emoji
  const [frequencyMap, setFrequencyMap] = useState<Map<string, number>>(
    new Map(),
  );

  useEffect(() => {
    emojiFrequencyService.getAllFrequencies().then(setFrequencyMap);
  }, []);

  // Memoize search function with frequency-aware results
  const searchEmojis = useMemo(
    () =>
      async (query: string): Promise<EmojiSearchResult[]> => {
        const limit = 24;
        const results = await service.search(query, { limit });

        // When query is empty or very short, prioritize frequently used emoji
        if (!query.trim()) {
          // Sort by frequency, then by original order
          const sorted = [...results].sort((a, b) => {
            const aKey = a.source === "unicode" ? a.url : `:${a.shortcode}:`;
            const bKey = b.source === "unicode" ? b.url : `:${b.shortcode}:`;
            const aFreq = frequencyMap.get(aKey) || 0;
            const bFreq = frequencyMap.get(bKey) || 0;

            // Higher frequency first
            if (bFreq !== aFreq) return bFreq - aFreq;

            // Then by source priority (user > context > sets > unicode)
            const priority: Record<string, number> = {
              user: 0,
              context: 1,
              unicode: 3,
            };
            const aPriority = a.source.startsWith("set:")
              ? 2
              : (priority[a.source] ?? 2);
            const bPriority = b.source.startsWith("set:")
              ? 2
              : (priority[b.source] ?? 2);
            return aPriority - bPriority;
          });

          return sorted.slice(0, limit);
        }

        return results;
      },
    [service, frequencyMap],
  );

  // Refresh frequency data after emoji usage
  const refreshFrequencies = useMemo(
    () => async () => {
      const updated = await emojiFrequencyService.getAllFrequencies();
      setFrequencyMap(updated);
    },
    [],
  );

  return {
    searchEmojis,
    service,
    refreshFrequencies,
  };
}
