import { useState, useEffect, useMemo, useRef } from "react";
import type { Subscription } from "rxjs";
import { use$ } from "applesauce-react/hooks";
import pool from "@/services/relay-pool";
import { blocked$, filterBlockedRelays } from "@/services/blocked-relays";
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

/** Backoff before reopening a subscription the relay closed cleanly. */
const RESUBSCRIBE_DELAY_MS = 5_000;
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

  // A blocked relay never gets a subscription, so it can never report EOSE.
  // Left in the state map its row stays `pending`/`waiting` forever, the
  // all-relays-EOSE check below can never be satisfied, and the window sits in
  // LOADING until the 15s deadline — which then labels the relay as having
  // timed out rather than as one the user blocked. `blocked` is the reactive
  // trigger: the kind-10006 list usually arrives after mount, and a relay
  // pruned mid-flight has to leave this list too.
  const blocked = use$(blocked$);
  const activeRelays = useMemo(
    // `blocked` is read here rather than only depended on: it is what makes the
    // memo recompute when the list lands, and `filterBlockedRelays` reads the
    // same set from the service.
    () => (blocked?.size ? filterBlockedRelays(stableRelays) : stableRelays),
    [stableRelays, blocked],
  );
  const stableActiveRelays = useStableArray(activeRelays);

  // What actually identifies the query, as opposed to the relay set that
  // happens to serve it. Relay selection is revised repeatedly after mount —
  // late kind:10002 arrivals for `$contacts` are hundreds of pubkeys trickling
  // in, and the blocked list lands after startup too — and each revision
  // re-runs the subscribe effect below. Wiping the events on those is what the
  // feed flicker is: the list is replaced by a skeleton and repopulated, three
  // times on a measured `$contacts` load. Events are keyed by id and stay valid
  // whichever relay served them, so only a real query change clears them.
  const queryKey = useMemo(
    () => JSON.stringify([id, stableFilters, limit ?? null, stream ?? null]),
    [id, stableFilters, limit, stream],
  );
  const queryKeyRef = useRef<string | null>(null);

  /**
   * Live per-relay REQs, keyed by relay URL, outliving any single effect run.
   *
   * Held in a ref rather than rebuilt per effect because relay selection is
   * revised repeatedly after mount, and the subscriptions have to survive those
   * revisions. Torn down on unmount by the effect below, and on a query change
   * by the subscribe effect itself.
   */
  const subscriptionsRef = useRef(new Map<string, Subscription>());

  // Unmount only. Deliberately separate from the subscribe effect: that effect
  // re-runs whenever the relay set changes, and closing everything in its
  // cleanup is precisely the churn this design removes.
  useEffect(
    () => () => {
      for (const sub of subscriptionsRef.current.values()) sub.unsubscribe();
      subscriptionsRef.current.clear();
    },
    [],
  );

  // Add rows for relays that joined and drop rows for relays that left, but
  // KEEP the state of relays that were already there. Rebuilding the whole map
  // reset a relay that had already reached EOSE back to "waiting", so the
  // all-relays-EOSE check below could never settle and the window sat in
  // LOADING until the deadline — on every relay revision, of which a
  // `$contacts` load has several.
  useEffect(() => {
    setRelayStates((prev) => {
      const desired = new Set(activeRelays);
      const next = new Map<string, ReqRelayState>();
      let changed = prev.size !== desired.size;

      for (const url of activeRelays) {
        const existing = prev.get(url);
        if (existing) {
          next.set(url, existing);
          continue;
        }
        changed = true;
        next.set(url, {
          url,
          connectionState: "pending",
          subscriptionState: "waiting",
          eventCount: 0,
        });
      }

      return changed ? next : prev;
    });
  }, [stableActiveRelays]);

  // Sync connection states from RelayStateManager
  // This runs whenever globalRelayStates updates
  useEffect(() => {
    if (activeRelays.length === 0) return;

    setRelayStates((prev) => {
      const next = new Map(prev);
      let changed = false;

      // Sync state for all relays in our query
      for (const url of activeRelays) {
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
  }, [globalRelayStates, activeRelays]);

  // Subscribe to events
  useEffect(() => {
    if (activeRelays.length === 0) {
      setLoading(false);
      return;
    }

    const queryChanged = queryKeyRef.current !== queryKey;
    queryKeyRef.current = queryKey;

    // A different query is a different question: every relay has to be asked
    // again, and the events already collected answer something else.
    if (queryChanged) {
      for (const sub of subscriptionsRef.current.values()) sub.unsubscribe();
      subscriptionsRef.current.clear();
      queryStartedAt.current = Date.now();
      setEventsMap(new Map());
    }

    setError(null);

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
    // Per-relay subscriptions bypass the pool's group() filter, so blocked
    // relays have to be dropped here or this hook would open exactly the
    // sockets the rest of the app refuses to.
    // Close the relays that left the set. Their REQ is over either way; doing
    // it here rather than in the cleanup below is what lets the survivors keep
    // theirs.
    const desired = new Set(activeRelays);
    for (const [url, sub] of subscriptionsRef.current) {
      if (desired.has(url)) continue;
      sub.unsubscribe();
      subscriptionsRef.current.delete(url);
    }

    const openSubscription = (url: string) => {
      // deliberate per-relay subscription for per-relay EOSE; list filtered above.
      // eslint-disable-next-line no-restricted-syntax
      const relay = pool.relay(url);

      // Use per-relay chunked filters if available, otherwise use the full filter
      // Read from ref so filter map updates don't require subscription teardown
      const relayFilters = relayFilterMapRef.current?.[url];
      const filtersForRelay = relayFilters
        ? relayFilters.map((f) => ({ ...f, limit: limit || f.limit }))
        : filtersWithLimit;

      return relay
        .subscription(filtersForRelay, {
          reconnect: 5,
          // Not `true`: applesauce turns that into repeat({ delay: of(null) }),
          // which hammers a relay that closes the subscription after EOSE.
          resubscribe: { delay: RESUBSCRIBE_DELAY_MS },
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
    };

    // Open a REQ only for relays that do not already have one. This is the
    // whole point: a relay already streaming keeps its in-flight REQ when the
    // relay SET changes, instead of every relay being torn down and re-asked
    // on each revision of relay selection.
    let opened = 0;
    for (const url of activeRelays) {
      if (subscriptionsRef.current.has(url)) continue;
      subscriptionsRef.current.set(url, openSubscription(url));
      opened++;
    }

    // Only claim to be waiting if something is actually outstanding. A relay
    // set that merely SHRANK — which is what blocking a relay does to every
    // mounted hook — opens no REQ, and a relay that already EOSE'd will never
    // emit EOSE again. Resetting unconditionally left every open window
    // reporting PARTIAL until the 15s deadline, with nothing in flight.
    if (queryChanged || opened > 0) {
      setEoseReceived(false);
      setLoading(true);
    }

    // Without a bound, one silent relay pins the timeline in LOADING forever.
    // Subscriptions stay open, so late events still arrive.
    const eoseDeadline = setTimeout(() => {
      // Mark stragglers done. Keep this a pure updater — React may invoke it
      // twice — and settle `loading` outside it, unconditionally: if every
      // relay already errored there is nothing to change here, but the caller
      // must still stop showing a spinner.
      setRelayStates((prev) => {
        const next = new Map(prev);
        let changed = false;

        for (const [url, state] of prev) {
          if (
            state.subscriptionState === "eose" ||
            state.subscriptionState === "error"
          ) {
            continue;
          }

          next.set(url, {
            ...state,
            subscriptionState: "eose",
            eoseAt: Date.now(),
            eoseTimedOut: true,
          });
          changed = true;
        }

        return changed ? next : prev;
      });

      if (!eoseReceivedRef.current) {
        setEoseReceived(true);
        if (!stream) setLoading(false);
      }
    }, EOSE_TIMEOUT_MS);

    // Only the timer. Closing the subscriptions here would undo the whole
    // point: this effect re-runs on every relay revision, and tearing them
    // down each time is exactly the REQ churn being fixed. Teardown on unmount
    // is handled by its own effect below.
    return () => {
      clearTimeout(eoseDeadline);
    };
  }, [
    id,
    stableFilters,
    queryKey,
    stableActiveRelays,
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
