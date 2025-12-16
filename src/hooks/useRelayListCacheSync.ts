/**
 * Hook to keep relay list cache in sync with EventStore
 *
 * Subscribes to kind:10002 events and automatically caches them in Dexie.
 * Should be used once at app root level.
 */

import { useEffect } from "react";
import { useEventStore } from "applesauce-react/hooks";
import relayListCache from "@/services/relay-list-cache";

export function useRelayListCacheSync() {
  const eventStore = useEventStore();

  useEffect(() => {
    // Subscribe to EventStore for auto-caching
    relayListCache.subscribeToEventStore(eventStore);

    // Cleanup on unmount
    return () => {
      relayListCache.unsubscribe();
    };
  }, [eventStore]);
}
