/**
 * Hook to keep DM relay list cache in sync with EventStore
 *
 * Subscribes to kind:10050 events and automatically caches them in Dexie.
 * Should be used once at app root level.
 */

import { useEffect } from "react";
import { useEventStore } from "applesauce-react/hooks";
import { dmRelayListCache } from "@/services/dm-relay-list-cache";

export function useDMRelayListCacheSync() {
  const eventStore = useEventStore();

  useEffect(() => {
    // Subscribe to EventStore for auto-caching
    dmRelayListCache.subscribeToEventStore(eventStore);

    // Cleanup on unmount
    return () => {
      dmRelayListCache.unsubscribe();
    };
  }, [eventStore]);
}
