/**
 * Hook to keep generic replaceable event cache in sync with EventStore
 *
 * Subscribes to configured kinds (contacts, relay lists, blossom servers, emoji lists, etc.)
 * and automatically caches them in Dexie.
 *
 * Should be used once at app root level.
 */

import { useEffect } from "react";
import { useEventStore } from "applesauce-react/hooks";
import replaceableEventCache from "@/services/replaceable-event-cache";

export function useReplaceableEventCacheSync() {
  const eventStore = useEventStore();

  useEffect(() => {
    // Subscribe to EventStore for auto-caching
    replaceableEventCache.subscribeToEventStore(eventStore);

    // Cleanup on unmount
    return () => {
      replaceableEventCache.unsubscribe();
    };
  }, [eventStore]);
}
