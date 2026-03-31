/**
 * Hook to keep emoji search service in sync with EventStore
 *
 * Loads cached emojis from Dexie on startup (instant availability),
 * then subscribes to kind:10030 and kind:30030 events for live updates.
 * Should be used once at app root level (AppShell).
 */

import { useEffect } from "react";
import { useEventStore } from "applesauce-react/hooks";
import { useAccount } from "./useAccount";
import emojiSearchService from "@/services/emoji-search";

export function useEmojiSearchSync() {
  const eventStore = useEventStore();
  const { pubkey } = useAccount();

  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;

    // Load from Dexie first (instant), then subscribe for fresh data
    emojiSearchService.loadCachedForUser(pubkey).then(() => {
      if (!cancelled) {
        emojiSearchService.subscribeForUser(pubkey, eventStore);
      }
    });

    return () => {
      cancelled = true;
      emojiSearchService.unsubscribeUser();
    };
  }, [pubkey, eventStore]);
}
