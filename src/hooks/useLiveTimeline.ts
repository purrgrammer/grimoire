import { useState, useEffect } from "react";
import { streamWithEose } from "@/lib/relay-subscription";
import type { NostrEvent, Filter } from "nostr-tools";
import { useEventStore, use$ } from "applesauce-react/hooks";
import { useStableValue, useStableArray } from "./useStable";

interface UseLiveTimelineOptions {
  limit?: number;
  stream?: boolean;
}

interface UseLiveTimelineReturn {
  events: NostrEvent[];
  loading: boolean;
  error: Error | null;
  eoseReceived: boolean;
}

/**
 * Hook that combines REQ streaming (like useReqTimeline) with EventStore reactivity (like useTimeline).
 * - Subscribes to relays using streamWithEose (populating the EventStore).
 * - Returns a memoized observable from eventStore using eventStore.timeline(filter).
 * @param id - Unique identifier for this timeline (for debugging/logging)
 * @param filters - Nostr filter object
 * @param relays - Array of relay URLs
 * @param options - Additional options like limit and stream
 * @returns Object containing events array (from store, sorted), loading state, and error
 */
export function useLiveTimeline(
  id: string,
  filters: Filter | Filter[],
  relays: string[],
  options: UseLiveTimelineOptions = { limit: 1000 },
): UseLiveTimelineReturn {
  const eventStore = useEventStore();
  const { limit, stream = false } = options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [eoseReceived, setEoseReceived] = useState(false);

  // Stabilize filters and relays to prevent unnecessary re-renders
  const stableFilters = useStableValue(filters);
  const stableRelays = useStableArray(relays);

  // 1. Subscription Effect - Fetch data and feed EventStore
  useEffect(() => {
    if (relays.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setEoseReceived(false);

    // Normalize filters to array
    const filterArray = Array.isArray(filters) ? filters : [filters];

    // Add limit to filters if specified
    const filtersWithLimit = filterArray.map((f) => ({
      ...f,
      limit: limit || f.limit,
    }));

    const observable = streamWithEose(relays, filtersWithLimit, {
      onEose: () => {
        setEoseReceived(true);
        if (!stream) {
          setLoading(false);
        }
      },
    });

    // Events are added to the EventStore by streamWithEose; the timeline query
    // below picks them up.
    const subscription = observable.subscribe(
      () => {},
      (err: Error) => {
        console.error("LiveTimeline: Error", err);
        setError(err);
        setLoading(false);
      },
      () => {
        // Only set loading to false if not streaming
        if (!stream) {
          setLoading(false);
        }
      },
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [id, stableFilters, stableRelays, limit, stream, eventStore]);

  // 2. Observable Effect - Read from EventStore
  const timelineEvents = use$(() => {
    // eventStore.timeline returns an Observable that emits sorted array of events matching filter
    // It updates whenever relevant events are added/removed from store
    return eventStore.timeline(filters);
  }, [stableFilters]);

  return {
    events: timelineEvents || [],
    loading,
    error,
    eoseReceived,
  };
}
