import { useState, useEffect, useMemo, useRef } from "react";
import pool from "@/services/relay-pool";
import type { NostrEvent, Filter } from "nostr-tools";
import { useEventStore } from "applesauce-react/hooks";
import { isNostrEvent } from "@/lib/type-guards";
import {
  useStableValue,
  useStableArray,
  useStableRelayFilterMap,
} from "./useStable";
import { useRelayState } from "./useRelayState";
import type { ReqRelayState, ReqOverallState } from "@/types/req-state";
import { deriveOverallState } from "@/lib/req-state-machine";

/** Maximum events kept in memory during streaming before eviction */
const MAX_STREAMING_EVENTS = 2000;

/** Replaces applesauce v5's Relay.eoseTimeout, removed in v6. */
const EOSE_TIMEOUT_MS = 15_000;
/** Fraction of events to evict when cap is hit (evict oldest 25%) */
const EVICTION_FRACTION = 0.25;

interface UseReqTimelineEnhancedOptions {
  limit?: number;
  stream?: boolean;
  /** Per-relay chunked filters from NIP-65 outbox splitting */
  relayFilterMap?: Record<string, Filter[]>;
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
  const { limit, stream = false, relayFilterMap } = options;
  const stableRelayFilterMap = useStableRelayFilterMap(relayFilterMap);

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

  // Keep relay filter map in a ref so subscription callbacks always
  // read the latest value without requiring subscription teardown
  const relayFilterMapRef = useRef(stableRelayFilterMap);
  useEffect(() => {
    relayFilterMapRef.current = stableRelayFilterMap;
  }, [stableRelayFilterMap]);

  // Derive a key that only changes when the SET of relays in the filter map changes,
  // not when filter content changes (pubkey redistribution). This prevents subscription
  // churn when relay reasoning updates but the relay set stays the same.
  const relaySetFromFilterMap = useMemo(() => {
    if (!stableRelayFilterMap) return undefined;
    return Object.keys(stableRelayFilterMap).sort().join(",");
  }, [stableRelayFilterMap]);

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

      // Use per-relay chunked filters if available, otherwise use the full filter
      // Read from ref so filter map updates don't require subscription teardown
      const relayFilters = relayFilterMapRef.current?.[url];
      const filtersForRelay = relayFilters
        ? relayFilters.map((f) => ({ ...f, limit: limit || f.limit }))
        : filtersWithLimit;

      return relay
        .subscription(filtersForRelay, {
          reconnect: 5, // v5: retries renamed to reconnect
          resubscribe: true,
        })
        .subscribe(
          (response) => {
            // Response can be an event or 'EOSE' string
            if (typeof response === "string" && response === "EOSE") {
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

              // Store in EventStore (global) and local map
              eventStore.add(event);

              // Fix 1a: Skip duplicate events already in our map
              setEventsMap((prev) => {
                if (prev.has(event.id)) return prev;
                const next = new Map(prev);
                next.set(event.id, event);

                // Fix 3: Cap events during streaming to prevent unbounded growth
                if (stream && next.size > MAX_STREAMING_EVENTS) {
                  const entries = Array.from(next.entries());
                  entries.sort((a, b) => a[1].created_at - b[1].created_at);
                  const evictCount = Math.floor(
                    MAX_STREAMING_EVENTS * EVICTION_FRACTION,
                  );
                  for (let i = 0; i < evictCount; i++) {
                    next.delete(entries[i][0]);
                  }
                }

                return next;
              });

              // Fix 1b + 5: Only update relay state on actual state transitions
              setRelayStates((prev) => {
                const state = prev.get(url);

                // Fix 5: Don't add unknown relays to the state map
                if (!state) return prev;

                const now = Date.now();
                const newSubState =
                  state.subscriptionState === "eose" ? "eose" : "receiving";

                // Only create new Map when subscription state actually transitions
                // (waiting → receiving). Counter-only updates are applied in-place
                // and become visible on the next state transition.
                if (state.subscriptionState === newSubState) {
                  state.eventCount += 1;
                  state.lastEventAt = now;
                  return prev; // No re-render for counter-only updates
                }

                // State transition — create new Map
                const next = new Map(prev);
                next.set(url, {
                  ...state,
                  subscriptionState: newSubState,
                  eventCount: state.eventCount + 1,
                  firstEventAt: state.firstEventAt ?? now,
                  lastEventAt: now,
                });
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
          },
        );
    });

    // Without a bound, one silent relay pins the timeline in LOADING forever.
    // Subscriptions stay open, so late events still arrive.
    const eoseDeadline = setTimeout(() => {
      setRelayStates((prev) => {
        let changed = false;
        const next = new Map(prev);

        for (const [url, state] of prev) {
          const unresolved =
            state.subscriptionState !== "eose" &&
            state.subscriptionState !== "error";
          if (!unresolved) continue;

          next.set(url, {
            ...state,
            subscriptionState: "eose",
            eoseAt: Date.now(),
            eoseTimedOut: true,
          });
          changed = true;
        }

        if (!changed) return prev;

        if (!eoseReceivedRef.current) {
          setEoseReceived(true);
          if (!stream) setLoading(false);
        }

        return next;
      });
    }, EOSE_TIMEOUT_MS);

    // Cleanup: unsubscribe from all relays
    return () => {
      clearTimeout(eoseDeadline);
      subscriptions.forEach((sub) => sub.unsubscribe());
    };
  }, [
    id,
    stableFilters,
    stableRelays,
    relaySetFromFilterMap,
    limit,
    stream,
    eventStore,
  ]);

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
