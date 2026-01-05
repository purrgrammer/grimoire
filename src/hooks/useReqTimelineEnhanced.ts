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
  const eoseReceivedRef = useRef<boolean>(false);

  // Keep ref in sync with state
  useEffect(() => {
    eoseReceivedRef.current = eoseReceived;
  }, [eoseReceived]);

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
    if (relays.length === 0) return;

    setRelayStates((prev) => {
      const next = new Map(prev);
      let changed = false;

      // Sync state for all relays in our query
      for (const url of relays) {
        const globalState = globalRelayStates[url];
        const currentState = prev.get(url);

        // Initialize if relay not in map yet (shouldn't happen, but defensive)
        if (!currentState) {
          next.set(url, {
            url,
            connectionState: globalState?.connectionState || "pending",
            subscriptionState: "waiting",
            eventCount: 0,
            connectedAt: globalState?.lastConnected,
            disconnectedAt: globalState?.lastDisconnected,
          });
          changed = true;
          console.log(
            "REQ Enhanced: Initialized missing relay state",
            url,
            globalState?.connectionState,
          );
        } else if (
          globalState &&
          globalState.connectionState !== currentState.connectionState
        ) {
          // Update connection state if changed
          next.set(url, {
            ...currentState,
            connectionState: globalState.connectionState as any,
            connectedAt: globalState.lastConnected,
            disconnectedAt: globalState.lastDisconnected,
          });
          changed = true;
          console.log(
            "REQ Enhanced: Connection state changed",
            url,
            currentState.connectionState,
            "→",
            globalState.connectionState,
          );
        }
      }

      return changed ? next : prev;
    });
  }, [globalRelayStates, relays]);

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

    // CRITICAL FIX: Subscribe to each relay INDIVIDUALLY to get per-relay EOSE
    // Previously used pool.subscription() which only emits EOSE when ALL relays finish
    // Now we track each relay separately for accurate per-relay EOSE detection
    const subscriptions = relays.map((url) => {
      const relay = pool.relay(url);

      return relay
        .subscription(filtersWithLimit, {
          reconnect: 5, // v5: retries renamed to reconnect
          resubscribe: true,
        })
        .subscribe(
          (response) => {
            // Response can be an event or 'EOSE' string
            if (typeof response === "string" && response === "EOSE") {
              console.log("REQ Enhanced: EOSE received from", url);

              // Mark THIS specific relay as having received EOSE
              setRelayStates((prev) => {
                const state = prev.get(url);
                if (!state || state.subscriptionState === "eose") {
                  return prev; // No change needed
                }

                const next = new Map(prev);
                next.set(url, {
                  ...state,
                  subscriptionState: "eose",
                  eoseAt: Date.now(),
                });

                // Check if ALL relays have reached EOSE
                const allEose = Array.from(next.values()).every(
                  (s) =>
                    s.subscriptionState === "eose" ||
                    s.connectionState === "error" ||
                    s.connectionState === "disconnected",
                );

                if (allEose && !eoseReceivedRef.current) {
                  console.log("REQ Enhanced: All relays finished");
                  setEoseReceived(true);
                  if (!stream) {
                    setLoading(false);
                  }
                }

                return next;
              });
            } else if (isNostrEvent(response)) {
              // Event received - store and track per relay
              const event = response as NostrEvent & { _relay?: string };

              // Store in EventStore and local map
              eventStore.add(event);
              setEventsMap((prev) => {
                const next = new Map(prev);
                next.set(event.id, event);
                return next;
              });

              // Update relay state for this specific relay
              // Use url from subscription, not event._relay (which might be wrong)
              setRelayStates((prev) => {
                const state = prev.get(url);
                const now = Date.now();
                const next = new Map(prev);

                if (!state) {
                  // Relay not in map - initialize it (defensive)
                  console.warn(
                    "REQ Enhanced: Event from unknown relay, initializing",
                    url,
                  );
                  next.set(url, {
                    url,
                    connectionState: "connected",
                    subscriptionState: "receiving",
                    eventCount: 1,
                    firstEventAt: now,
                    lastEventAt: now,
                  });
                } else {
                  // Update existing relay state
                  next.set(url, {
                    ...state,
                    subscriptionState: "receiving",
                    eventCount: state.eventCount + 1,
                    firstEventAt: state.firstEventAt ?? now,
                    lastEventAt: now,
                  });
                }

                return next;
              });
            } else {
              console.warn(
                "REQ Enhanced: Unexpected response type from",
                url,
                response,
              );
            }
          },
          (err: Error) => {
            console.error("REQ Enhanced: Error from", url, err);
            // Mark this relay as errored
            setRelayStates((prev) => {
              const state = prev.get(url);
              if (!state) return prev;

              const next = new Map(prev);
              next.set(url, {
                ...state,
                subscriptionState: "error",
                errorMessage: err.message,
                errorType: "connection",
              });
              return next;
            });
          },
          () => {
            // This relay's observable completed
            console.log("REQ Enhanced: Relay completed", url);
          },
        );
    });

    // Cleanup: unsubscribe from all relays
    return () => {
      subscriptions.forEach((sub) => sub.unsubscribe());
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
