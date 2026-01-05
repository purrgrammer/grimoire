import { useState, useEffect, useMemo } from "react";
import pool from "@/services/relay-pool";
import type { NostrEvent, Filter } from "nostr-tools";
import { useEventStore } from "applesauce-react/hooks";
import { isNostrEvent } from "@/lib/type-guards";
import { useStableValue, useStableArray } from "./useStable";

interface UseReqTimelineOptions {
  limit?: number;
  stream?: boolean;
}

interface UseReqTimelineReturn {
  events: NostrEvent[];
  loading: boolean;
  error: Error | null;
  eoseReceived: boolean;
}

/**
 * Hook for REQ command - queries ONLY specified relays using pool.req()
 * Stores results in memory (not EventStore) and returns them sorted by created_at
 * @param id - Unique identifier for this timeline (for caching)
 * @param filters - Nostr filter object
 * @param relays - Array of relay URLs (ONLY these relays will be queried)
 * @param options - Additional options like limit and stream (keep connection open after EOSE)
 * @returns Object containing events array (sorted newest first), loading state, and error
 */
export function useReqTimeline(
  id: string,
  filters: Filter | Filter[],
  relays: string[],
  options: UseReqTimelineOptions = { limit: 50 },
): UseReqTimelineReturn {
  const eventStore = useEventStore();
  const { limit, stream = false } = options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [eoseReceived, setEoseReceived] = useState(false);
  const [eventsMap, setEventsMap] = useState<Map<string, NostrEvent>>(
    new Map(),
  );

  // Sort events by created_at (newest first) and deduplicate by ID
  const events = useMemo(() => {
    return Array.from(eventsMap.values()).sort(
      (a, b) => b.created_at - a.created_at,
    );
  }, [eventsMap]);

  // Stabilize filters and relays to prevent unnecessary re-renders
  const stableFilters = useStableValue(filters);
  const stableRelays = useStableArray(relays);

  useEffect(() => {
    if (relays.length === 0) {
      setLoading(false);
      return;
    }

    console.log("REQ: Starting query", { relays, filters, limit, stream });

    setLoading(true);
    setError(null);
    setEoseReceived(false);
    setEventsMap(new Map());

    // Normalize filters to array
    const filterArray = Array.isArray(filters) ? filters : [filters];

    // Add limit to filters if specified
    const filtersWithLimit = filterArray.map((f) => ({
      ...f,
      limit: limit || f.limit,
    }));

    const observable = pool.subscription(relays, filtersWithLimit, {
      reconnect: 5, // v5: retries renamed to reconnect
      resubscribe: true,
      eventStore,
    });

    const subscription = observable.subscribe(
      (response) => {
        // Response can be an event or 'EOSE' string
        if (typeof response === "string") {
          console.log("REQ: EOSE received");
          setEoseReceived(true);
          if (!stream) {
            setLoading(false);
          }
        } else if (isNostrEvent(response)) {
          // It's an event - store in memory, deduplicate by ID
          eventStore.add(response);
          setEventsMap((prev) => {
            const next = new Map(prev);
            next.set(response.id, response);
            return next;
          });
        } else {
          console.warn("REQ: Unexpected response type:", response);
        }
      },
      (err: Error) => {
        console.error("REQ: Error", err);
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

  return {
    events: events || [],
    loading,
    error,
    eoseReceived,
  };
}
