import { useEffect, useMemo, useRef } from "react";
import type { Observable } from "rxjs";
import {
  EmojiSearchService,
  type EmojiSearchResult,
} from "@/services/emoji-search";
import { UNICODE_EMOJIS } from "@/lib/unicode-emojis";
import eventStore from "@/services/event-store";
import type { NostrEvent } from "@/types/nostr";
import { useAccount } from "./useAccount";

export interface UseEmojiSearchOptions {
  /** Event to extract context emojis from (e.g., current conversation) */
  contextEvent?: NostrEvent;
  /** Custom emoji events to index (kind 10030 or 30030) */
  customEmojiEvents?: NostrEvent[];
  /** Custom observable source for emoji events */
  emojiSource$?: Observable<NostrEvent[]>;
  /** Whether to include Unicode emojis (default: true) */
  includeUnicode?: boolean;
  /** Whether to include user's emoji list from EventStore (default: true) */
  includeUserEmojis?: boolean;
  /** Maximum results to return (default: 24) */
  limit?: number;
}

/**
 * Hook to provide emoji search functionality with automatic indexing
 * of Unicode emojis and user's custom emojis from the event store.
 *
 * Supports injectable sources for custom emoji sets.
 *
 * @example
 * // Default: Unicode + user's custom emojis
 * const { searchEmojis } = useEmojiSearch();
 *
 * @example
 * // With context event (extracts emoji tags from event)
 * const { searchEmojis } = useEmojiSearch({ contextEvent: event });
 *
 * @example
 * // Custom emoji source only
 * const { searchEmojis } = useEmojiSearch({
 *   emojiSource$: customEmojis$,
 *   includeUnicode: false,
 *   includeUserEmojis: false,
 * });
 */
export function useEmojiSearch(options: UseEmojiSearchOptions = {}) {
  const {
    contextEvent,
    customEmojiEvents,
    emojiSource$,
    includeUnicode = true,
    includeUserEmojis = true,
    limit = 24,
  } = options;

  const serviceRef = useRef<EmojiSearchService | null>(null);
  const { pubkey } = useAccount();

  // Create service instance (singleton per component mount)
  if (!serviceRef.current) {
    serviceRef.current = new EmojiSearchService();
  }

  const service = serviceRef.current;

  // Load Unicode emojis if enabled
  useEffect(() => {
    if (includeUnicode) {
      service.addUnicodeEmojis(UNICODE_EMOJIS);
    }
  }, [includeUnicode, service]);

  // Add custom emoji events if provided
  useEffect(() => {
    if (customEmojiEvents && customEmojiEvents.length > 0) {
      for (const event of customEmojiEvents) {
        if (event.kind === 10030) {
          service.addUserEmojiList(event);
        } else if (event.kind === 30030) {
          service.addEmojiSet(event);
        }
      }
    }
  }, [customEmojiEvents, service]);

  // Subscribe to custom emoji source if provided
  useEffect(() => {
    if (!emojiSource$) return;

    const subscription = emojiSource$.subscribe({
      next: (events) => {
        for (const event of events) {
          if (event.kind === 10030) {
            service.addUserEmojiList(event);
          } else if (event.kind === 30030) {
            service.addEmojiSet(event);
          }
        }
      },
      error: (error) => {
        console.error("Failed to load emojis from custom source:", error);
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [emojiSource$, service]);

  // Add context emojis when context event changes
  useEffect(() => {
    if (contextEvent) {
      service.addContextEmojis(contextEvent);
    }
  }, [contextEvent, service]);

  // Subscribe to user's emoji list (kind 10030) and emoji sets (kind 30030)
  useEffect(() => {
    if (!includeUserEmojis || !pubkey) {
      return;
    }

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
  }, [pubkey, service, includeUserEmojis]);

  // Memoize search function
  const searchEmojis = useMemo(
    () =>
      async (query: string): Promise<EmojiSearchResult[]> => {
        return await service.search(query, { limit });
      },
    [service, limit],
  );

  return {
    searchEmojis,
    service,
  };
}
