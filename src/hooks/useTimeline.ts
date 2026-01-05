import { useState, useEffect } from "react";
import type { NostrEvent, Filter } from "nostr-tools";
import { useEventStore, use$ } from "applesauce-react/hooks";
import { createTimelineLoader } from "@/services/loaders";
import pool from "@/services/relay-pool";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { useStableValue, useStableArray } from "./useStable";

interface UseTimelineOptions {
  limit?: number;
}

interface UseTimelineReturn {
  events: NostrEvent[];
  loading: boolean;
  error: Error | null;
}

/**
 * Hook for subscribing to a timeline of events from relays
 * Uses applesauce loaders for efficient event loading and caching
 * @param id - Unique identifier for this timeline (for caching)
 * @param filters - Nostr filter object
 * @param relays - Array of relay URLs
 * @param options - Additional options like limit
 * @returns Object containing events array, loading state, and error
 */
export function useTimeline(
  id: string,
  filters: Filter | Filter[],
  relays: string[],
  options: UseTimelineOptions = { limit: 20 },
): UseTimelineReturn {
  const { limit } = options;
  const eventStore = useEventStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Stabilize filters and relays to prevent unnecessary re-renders
  const stableFilters = useStableValue(filters);
  const stableRelays = useStableArray(relays);

  // Load events into store
  useEffect(() => {
    if (relays.length === 0) return;

    const loader = createTimelineLoader(
      pool,
      relays.concat(AGGREGATOR_RELAYS),
      filters,
      {
        eventStore,
        limit,
      },
    );

    setLoading(true);
    setError(null);

    const subscription = loader().subscribe({
      error: (err: Error) => {
        console.error("Timeline error:", err);
        setError(err);
        setLoading(false);
      },
      complete: () => {
        setLoading(false);
      },
    });

    return () => subscription.unsubscribe();
  }, [id, stableRelays, limit, eventStore, stableFilters]);

  // Watch store for matching events
  const timeline = use$(() => {
    return eventStore.timeline(filters, false);
  }, [id]);

  const hasItems = timeline ? timeline.length > 0 : false;
  return {
    events: timeline || [],
    loading: hasItems ? false : loading,
    error,
  };
}
