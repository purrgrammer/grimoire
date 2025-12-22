import { useState, useEffect, useMemo, useRef } from "react";
import pool from "@/services/relay-pool";
import type { NostrEvent, Filter } from "nostr-tools";
import { useEventStore } from "applesauce-react/hooks";
import { isNostrEvent } from "@/lib/type-guards";
import { useStableValue, useStableArray } from "./useStable";
import { useRelayState } from "./useRelayState";
import type { ReqRelayState, ReqOverallState } from "@/types/req-state";
import { deriveOverallState } from "@/lib/req-state-machine";

interface UseReqTimelineEnhancedOptions {
  limit?: number;
  stream?: boolean;
}

interface UseReqTimelineEnhancedReturn {
  events: NostrEvent[];
  loading: boolean;
  error: Error | null;
  eoseReceived: boolean;

  // Enhanced state tracking
  relayStates: Map<string, ReqRelayState>;
  overallState: ReqOverallState;
}

/**
 * Enhanced REQ timeline hook with per-relay state tracking
 *
 * This hook extends the original useReqTimeline with accurate per-relay
 * state tracking and overall status derivation. It solves the "LIVE with 0 relays"
 * bug by tracking connection state and event counts separately per relay.
 *
 * Architecture:
 * - Uses pool.subscription() for event streaming (with deduplication)
 * - Syncs connection state from RelayStateManager
 * - Tracks events per relay via event._relay metadata
 * - Derives overall state from individual relay states
 *
 * @param id - Unique identifier for this timeline (for caching)
 * @param filters - Nostr filter(s)
 * @param relays - Array of relay URLs
 * @param options - Stream mode, limit, etc.
 */
export function useReqTimelineEnhanced(
  id: string,
  filters: Filter | Filter[],
  relays: string[],
  options: UseReqTimelineEnhancedOptions = { limit: 50 },
): UseReqTimelineEnhancedReturn {
  const eventStore = useEventStore();
  const { limit, stream = false } = options;

  // Core state (compatible with original useReqTimeline)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [eoseReceived, setEoseReceived] = useState(false);
  const [eventsMap, setEventsMap] = useState<Map<string, NostrEvent>>(
    new Map(),
  );

  // Enhanced: Per-relay state tracking
  const [relayStates, setRelayStates] = useState<Map<string, ReqRelayState>>(
    new Map(),
  );
  const queryStartedAt = useRef<number>(Date.now());

  // Get global relay connection states from RelayStateManager
  const { relays: globalRelayStates } = useRelayState();

  // Sort events by created_at (newest first)
  const events = useMemo(() => {
    return Array.from(eventsMap.values()).sort(
      (a, b) => b.created_at - a.created_at,
    );
  }, [eventsMap]);

  // Stabilize inputs to prevent unnecessary re-renders
  const stableFilters = useStableValue(filters);
  const stableRelays = useStableArray(relays);

  // Initialize relay states when relays change
  useEffect(() => {
    queryStartedAt.current = Date.now();

    const initialStates = new Map<string, ReqRelayState>();
    for (const url of relays) {
      initialStates.set(url, {
        url,
        connectionState: "pending",
        subscriptionState: "waiting",
        eventCount: 0,
      });
    }
    setRelayStates(initialStates);
  }, [stableRelays]);

  // Sync connection states from RelayStateManager
  // This runs whenever globalRelayStates updates
  useEffect(() => {
    setRelayStates((prev) => {
      const next = new Map(prev);
      let changed = false;

      for (const [url, state] of prev) {
        const globalState = globalRelayStates[url];
        if (
          globalState &&
          globalState.connectionState !== state.connectionState
        ) {
          next.set(url, {
            ...state,
            connectionState: globalState.connectionState as any,
            connectedAt: globalState.lastConnected,
            disconnectedAt: globalState.lastDisconnected,
          });
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [globalRelayStates]);

  // Subscribe to events
  useEffect(() => {
    if (relays.length === 0) {
      setLoading(false);
      return;
    }

    console.log("REQ Enhanced: Starting query", {
      relays,
      filters,
      limit,
      stream,
    });

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
      retries: 5,
      reconnect: 5,
      resubscribe: true,
      eventStore,
    });

    const subscription = observable.subscribe(
      (response) => {
        // Response can be an event or 'EOSE' string
        if (typeof response === "string") {
          console.log("REQ Enhanced: EOSE received");
          setEoseReceived(true);
          if (!stream) {
            setLoading(false);
          }

          // Mark all connected relays as having received EOSE
          // Note: We can't tell which specific relay sent EOSE due to
          // applesauce-relay's catchError bug that converts errors to EOSE.
          // We mark all connected relays as a best-effort approximation.
          setRelayStates((prev) => {
            const next = new Map(prev);
            let changed = false;

            for (const [url, state] of prev) {
              if (
                state.connectionState === "connected" &&
                state.subscriptionState !== "eose"
              ) {
                next.set(url, {
                  ...state,
                  subscriptionState: "eose",
                  eoseAt: Date.now(),
                });
                changed = true;
              }
            }

            return changed ? next : prev;
          });
        } else if (isNostrEvent(response)) {
          // Event received - store and track per relay
          const event = response as NostrEvent & { _relay?: string };
          const relayUrl = event._relay;

          // Store in EventStore and local map
          eventStore.add(event);
          setEventsMap((prev) => {
            const next = new Map(prev);
            next.set(event.id, event);
            return next;
          });

          // Update relay state for this specific relay
          if (relayUrl) {
            setRelayStates((prev) => {
              const state = prev.get(relayUrl);
              if (!state) return prev;

              const now = Date.now();
              const next = new Map(prev);
              next.set(relayUrl, {
                ...state,
                subscriptionState: "receiving",
                eventCount: state.eventCount + 1,
                firstEventAt: state.firstEventAt ?? now,
                lastEventAt: now,
              });
              return next;
            });
          }
        } else {
          console.warn("REQ Enhanced: Unexpected response type:", response);
        }
      },
      (err: Error) => {
        console.error("REQ Enhanced: Error", err);
        setError(err);
        setLoading(false);
      },
      () => {
        // Observable completed
        if (!stream) {
          setLoading(false);
        }
      },
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [id, stableFilters, stableRelays, limit, stream, eventStore]);

  // Derive overall state from individual relay states
  const overallState = useMemo(() => {
    return deriveOverallState(
      relayStates,
      eoseReceived,
      stream,
      queryStartedAt.current,
    );
  }, [relayStates, eoseReceived, stream]);

  return {
    events: events || [],
    loading,
    error,
    eoseReceived,
    relayStates,
    overallState,
  };
}
