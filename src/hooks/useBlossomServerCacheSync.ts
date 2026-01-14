/**
 * Hook to keep blossom server cache in sync with EventStore
 *
 * Subscribes to kind:10063 events and automatically caches them in Dexie.
 * Should be used once at app root level.
 */

import { useEffect } from "react";
import { useEventStore } from "applesauce-react/hooks";
import blossomServerCache from "@/services/blossom-server-cache";

export function useBlossomServerCacheSync() {
  const eventStore = useEventStore();

  useEffect(() => {
    // Subscribe to EventStore for auto-caching
    blossomServerCache.subscribeToEventStore(eventStore);

    // Cleanup on unmount
    return () => {
      blossomServerCache.unsubscribe();
    };
  }, [eventStore]);
}
