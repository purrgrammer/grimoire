# ReqViewer State Machine Improvement Plan

**Date**: 2025-12-22
**Goal**: Production-quality REQ status tracking with accurate relay state information

## Overview

This plan details the implementation of a robust state machine for ReqViewer that accurately tracks per-relay and overall query status, handles edge cases, and provides production-quality user feedback.

**See**: `req-viewer-state-analysis.md` for detailed problem analysis.

## Solution Architecture

### Hybrid Approach: Connection State + Event Tracking

We'll combine two sources of truth:
1. **RelayStateManager**: Tracks WebSocket connection state per relay
2. **Event Metadata**: Tracks which relay sent which events (via `_relay` property)

This hybrid approach avoids duplicate subscriptions while providing accurate status tracking.

## Implementation Progress

### COMPLETED: Phase 1: Core Infrastructure
- [x] Task 1.1: Create Per-Relay State Tracking Types (`src/types/req-state.ts`)
- [x] Task 1.2: Create State Derivation Logic (`src/lib/req-state-machine.ts`)
- [x] Task 1.3: Create Enhanced Timeline Hook (`src/hooks/useReqTimelineEnhanced.ts`)
- [x] Unit tests for state machine (`src/lib/req-state-machine.test.ts`)

### COMPLETED: Phase 2: UI Integration
- [x] Task 2.1: Update ReqViewer Status Indicator with 8-state machine
- [x] Task 2.2: Enhance Relay Dropdown with Per-Relay Status and 2-column grid tooltip
- [x] Task 2.3: Add Empty/Error States (Failed, Offline, Partial)

### PENDING: Phase 3: Testing & Polish
- [ ] Task 3.1: Add Unit Tests for `useReqTimelineEnhanced` hook
- [ ] Task 3.2: Add Integration Tests for `ReqViewer` UI
- [ ] Task 3.3: Complete Manual Testing Checklist

### FUTURE: Phase 4: Future Enhancements
- [ ] Task 4.1: Relay Performance Metrics (Latency tracking)
- [ ] Task 4.2: Smart Relay Selection (Integrate with RelayLiveness)
- [ ] Task 4.3: Query Optimization Suggestions

---

## Original Implementation Tasks (Reference)

#### Task 1.1: Create Per-Relay State Tracking Types

**File**: `src/types/req-state.ts` (NEW)

```typescript
/**
 * Connection state from RelayStateManager
 */
export type RelayConnectionState =
  | 'pending'      // Not yet attempted
  | 'connecting'   // Connection in progress
  | 'connected'    // WebSocket connected
  | 'disconnected' // Disconnected (expected or unexpected)
  | 'error';       // Connection error

/**
 * Subscription state specific to this REQ
 */
export type RelaySubscriptionState =
  | 'waiting'    // Connected but no events yet
  | 'receiving'  // Events being received
  | 'eose'       // EOSE received (real or timeout)
  | 'error';     // Subscription error

/**
 * Per-relay state for a single REQ subscription
 */
export interface ReqRelayState {
  url: string;

  // Connection state (from RelayStateManager)
  connectionState: RelayConnectionState;

  // Subscription state (tracked by us)
  subscriptionState: RelaySubscriptionState;

  // Event tracking
  eventCount: number;
  firstEventAt?: number;
  lastEventAt?: number;

  // Timing
  connectedAt?: number;
  eoseAt?: number;
  disconnectedAt?: number;

  // Error handling
  errorMessage?: string;
  errorType?: 'connection' | 'protocol' | 'timeout' | 'auth';
}

/**
 * Overall query state derived from individual relay states
 */
export type ReqOverallStatus =
  | 'discovering'  // Selecting relays (NIP-65)
  | 'connecting'   // Waiting for first relay to connect
  | 'loading'      // Loading initial events
  | 'live'         // Streaming after EOSE, relays connected
  | 'partial'      // Some relays ok, some failed
  | 'closed'       // All relays completed and closed
  | 'failed'       // All relays failed
  | 'offline';     // All relays disconnected after being live

/**
 * Aggregated state for the entire query
 */
export interface ReqOverallState {
  status: ReqOverallStatus;

  // Relay counts
  totalRelays: number;
  connectedCount: number;
  receivingCount: number;
  eoseCount: number;
  errorCount: number;
  disconnectedCount: number;

  // Timing
  queryStartedAt: number;
  firstEventAt?: number;
  allEoseAt?: number;

  // Flags
  hasReceivedEvents: boolean;
  hasActiveRelays: boolean;
  allRelaysFailed: boolean;
}
```

**Tests**: `src/types/req-state.test.ts`
- Type checking only, no runtime tests needed

---

#### Task 1.2: Create State Derivation Logic

**File**: `src/lib/req-state-machine.ts` (NEW)

```typescript
import type { ReqRelayState, ReqOverallState, ReqOverallStatus } from '@/types/req-state';

/**
 * Derive overall query status from individual relay states
 */
export function deriveOverallState(
  relayStates: Map<string, ReqRelayState>,
  overallEoseReceived: boolean,
  isStreaming: boolean,
  queryStartedAt: number,
): ReqOverallState {
  const states = Array.from(relayStates.values());

  // Count relay states
  const totalRelays = states.length;
  const connectedCount = states.filter(s => s.connectionState === 'connected').length;
  const receivingCount = states.filter(s => s.subscriptionState === 'receiving').length;
  const eoseCount = states.filter(s => s.subscriptionState === 'eose').length;
  const errorCount = states.filter(s => s.connectionState === 'error').length;
  const disconnectedCount = states.filter(s => s.connectionState === 'disconnected').length;

  // Calculate flags
  const hasReceivedEvents = states.some(s => s.eventCount > 0);
  const hasActiveRelays = connectedCount > 0;
  const allRelaysFailed = totalRelays > 0 && errorCount === totalRelays;
  const allDisconnected = totalRelays > 0 &&
    (disconnectedCount + errorCount) === totalRelays;

  // Timing
  const firstEventAt = states
    .map(s => s.firstEventAt)
    .filter((t): t is number => t !== undefined)
    .sort((a, b) => a - b)[0];

  const allEoseAt = overallEoseReceived ? Date.now() : undefined;

  // Derive status
  const status: ReqOverallStatus = (() => {
    // No relays selected yet
    if (totalRelays === 0) {
      return 'discovering';
    }

    // All relays failed to connect
    if (allRelaysFailed && !hasReceivedEvents) {
      return 'failed';
    }

    // No relays connected, none have sent events
    if (!hasActiveRelays && !hasReceivedEvents) {
      return 'connecting';
    }

    // Had events, had connections, but all disconnected now
    if (allDisconnected && hasReceivedEvents && overallEoseReceived) {
      if (isStreaming) {
        return 'offline'; // Was live, now offline
      } else {
        return 'closed'; // Completed and closed
      }
    }

    // EOSE not received yet, loading initial data
    if (!overallEoseReceived) {
      return 'loading';
    }

    // EOSE received, streaming mode, relays still connected
    if (overallEoseReceived && isStreaming && hasActiveRelays) {
      return 'live';
    }

    // EOSE received, but not all relays healthy
    if (overallEoseReceived && (errorCount > 0 || disconnectedCount > 0)) {
      if (hasActiveRelays) {
        return 'partial'; // Some working, some not
      } else {
        return 'offline'; // All disconnected after EOSE
      }
    }

    // EOSE received, not streaming, all done
    if (overallEoseReceived && !isStreaming) {
      return 'closed';
    }

    // Default fallback
    return 'loading';
  })();

  return {
    status,
    totalRelays,
    connectedCount,
    receivingCount,
    eoseCount,
    errorCount,
    disconnectedCount,
    hasReceivedEvents,
    hasActiveRelays,
    allRelaysFailed,
    queryStartedAt,
    firstEventAt,
    allEoseAt,
  };
}

/**
 * Get user-friendly status text
 */
export function getStatusText(state: ReqOverallState): string {
  switch (state.status) {
    case 'discovering':
      return 'DISCOVERING RELAYS';
    case 'connecting':
      return 'CONNECTING';
    case 'loading':
      return state.hasReceivedEvents ? 'LOADING' : 'WAITING';
    case 'live':
      return 'LIVE';
    case 'partial':
      return `PARTIAL (${state.connectedCount}/${state.totalRelays})`;
    case 'offline':
      return 'OFFLINE';
    case 'closed':
      return 'CLOSED';
    case 'failed':
      return 'FAILED';
  }
}

/**
 * Get status indicator color
 */
export function getStatusColor(status: ReqOverallStatus): string {
  switch (status) {
    case 'discovering':
    case 'connecting':
    case 'loading':
      return 'text-yellow-500';
    case 'live':
    case 'partial':
      return 'text-green-500';
    case 'closed':
      return 'text-muted-foreground';
    case 'offline':
    case 'failed':
      return 'text-red-500';
  }
}

/**
 * Should status indicator pulse/animate?
 */
export function shouldAnimate(status: ReqOverallStatus): boolean {
  return ['discovering', 'connecting', 'loading', 'live'].includes(status);
}
```

**Tests**: `src/lib/req-state-machine.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { deriveOverallState } from './req-state-machine';
import type { ReqRelayState } from '@/types/req-state';

describe('deriveOverallState', () => {
  const queryStartedAt = Date.now();

  describe('discovering state', () => {
    it('should return discovering when no relays', () => {
      const state = deriveOverallState(new Map(), false, false, queryStartedAt);
      expect(state.status).toBe('discovering');
    });
  });

  describe('connecting state', () => {
    it('should return connecting when relays pending', () => {
      const relays = new Map<string, ReqRelayState>([
        ['wss://relay1.com', {
          url: 'wss://relay1.com',
          connectionState: 'pending',
          subscriptionState: 'waiting',
          eventCount: 0,
        }],
      ]);
      const state = deriveOverallState(relays, false, false, queryStartedAt);
      expect(state.status).toBe('connecting');
    });
  });

  describe('failed state', () => {
    it('should return failed when all relays error with no events', () => {
      const relays = new Map<string, ReqRelayState>([
        ['wss://relay1.com', {
          url: 'wss://relay1.com',
          connectionState: 'error',
          subscriptionState: 'error',
          eventCount: 0,
        }],
        ['wss://relay2.com', {
          url: 'wss://relay2.com',
          connectionState: 'error',
          subscriptionState: 'error',
          eventCount: 0,
        }],
      ]);
      const state = deriveOverallState(relays, false, false, queryStartedAt);
      expect(state.status).toBe('failed');
      expect(state.allRelaysFailed).toBe(true);
    });
  });

  describe('loading state', () => {
    it('should return loading when connected but no EOSE', () => {
      const relays = new Map<string, ReqRelayState>([
        ['wss://relay1.com', {
          url: 'wss://relay1.com',
          connectionState: 'connected',
          subscriptionState: 'receiving',
          eventCount: 5,
        }],
      ]);
      const state = deriveOverallState(relays, false, false, queryStartedAt);
      expect(state.status).toBe('loading');
      expect(state.hasReceivedEvents).toBe(true);
    });
  });

  describe('live state', () => {
    it('should return live when EOSE + streaming + connected', () => {
      const relays = new Map<string, ReqRelayState>([
        ['wss://relay1.com', {
          url: 'wss://relay1.com',
          connectionState: 'connected',
          subscriptionState: 'eose',
          eventCount: 10,
        }],
      ]);
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      expect(state.status).toBe('live');
      expect(state.hasActiveRelays).toBe(true);
    });
  });

  describe('offline state', () => {
    it('should return offline when all disconnected after EOSE in streaming', () => {
      const relays = new Map<string, ReqRelayState>([
        ['wss://relay1.com', {
          url: 'wss://relay1.com',
          connectionState: 'disconnected',
          subscriptionState: 'eose',
          eventCount: 10,
        }],
        ['wss://relay2.com', {
          url: 'wss://relay2.com',
          connectionState: 'disconnected',
          subscriptionState: 'eose',
          eventCount: 5,
        }],
      ]);
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      expect(state.status).toBe('offline');
      expect(state.hasActiveRelays).toBe(false);
      expect(state.hasReceivedEvents).toBe(true);
    });
  });

  describe('partial state', () => {
    it('should return partial when some relays ok, some failed', () => {
      const relays = new Map<string, ReqRelayState>([
        ['wss://relay1.com', {
          url: 'wss://relay1.com',
          connectionState: 'connected',
          subscriptionState: 'eose',
          eventCount: 10,
        }],
        ['wss://relay2.com', {
          url: 'wss://relay2.com',
          connectionState: 'error',
          subscriptionState: 'error',
          eventCount: 0,
        }],
      ]);
      const state = deriveOverallState(relays, true, true, queryStartedAt);
      expect(state.status).toBe('partial');
      expect(state.connectedCount).toBe(1);
      expect(state.errorCount).toBe(1);
    });
  });

  describe('closed state', () => {
    it('should return closed when EOSE + not streaming', () => {
      const relays = new Map<string, ReqRelayState>([
        ['wss://relay1.com', {
          url: 'wss://relay1.com',
          connectionState: 'disconnected',
          subscriptionState: 'eose',
          eventCount: 10,
        }],
      ]);
      const state = deriveOverallState(relays, true, false, queryStartedAt);
      expect(state.status).toBe('closed');
    });
  });
});
```

---

#### Task 1.3: Create Enhanced Timeline Hook

**File**: `src/hooks/useReqTimelineEnhanced.ts` (NEW)

```typescript
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
 * Combines:
 * - Group subscription for events (with deduplication)
 * - RelayStateManager for connection state
 * - Event metadata for relay-specific tracking
 *
 * @param id - Unique identifier for this timeline
 * @param filters - Nostr filter(s)
 * @param relays - Array of relay URLs
 * @param options - Stream mode, limit, etc.
 */
export function useReqTimelineEnhanced(
  id: string,
  filters: Filter | Filter[],
  relays: string[],
  options: UseReqTimelineEnhancedOptions = { limit: 50 }
): UseReqTimelineEnhancedReturn {
  const eventStore = useEventStore();
  const { limit, stream = false } = options;

  // Existing state from useReqTimeline
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [eoseReceived, setEoseReceived] = useState(false);
  const [eventsMap, setEventsMap] = useState<Map<string, NostrEvent>>(new Map());

  // New: Per-relay state tracking
  const [relayStates, setRelayStates] = useState<Map<string, ReqRelayState>>(new Map());
  const queryStartedAt = useRef<number>(Date.now());

  // Get global relay connection states
  const { relays: globalRelayStates } = useRelayState();

  // Sort events by created_at
  const events = useMemo(() => {
    return Array.from(eventsMap.values()).sort(
      (a, b) => b.created_at - a.created_at
    );
  }, [eventsMap]);

  // Stabilize inputs
  const stableFilters = useStableValue(filters);
  const stableRelays = useStableArray(relays);

  // Initialize relay states when relays change
  useEffect(() => {
    queryStartedAt.current = Date.now();

    const initialStates = new Map<string, ReqRelayState>();
    for (const url of relays) {
      initialStates.set(url, {
        url,
        connectionState: 'pending',
        subscriptionState: 'waiting',
        eventCount: 0,
      });
    }
    setRelayStates(initialStates);
  }, [stableRelays]);

  // Sync connection states from RelayStateManager
  useEffect(() => {
    setRelayStates(prev => {
      const next = new Map(prev);
      let changed = false;

      for (const [url, state] of prev) {
        const globalState = globalRelayStates[url];
        if (globalState && globalState.connectionState !== state.connectionState) {
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

    setLoading(true);
    setError(null);
    setEoseReceived(false);
    setEventsMap(new Map());

    // Normalize filters
    const filterArray = Array.isArray(filters) ? filters : [filters];
    const filtersWithLimit = filterArray.map(f => ({
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
        if (typeof response === "string") {
          // EOSE received
          setEoseReceived(true);
          if (!stream) {
            setLoading(false);
          }

          // Mark all connected relays as having received EOSE
          // Note: We can't tell which relay sent EOSE due to applesauce bug
          // So we mark all connected ones
          setRelayStates(prev => {
            const next = new Map(prev);
            for (const [url, state] of prev) {
              if (state.connectionState === 'connected') {
                next.set(url, {
                  ...state,
                  subscriptionState: 'eose',
                  eoseAt: Date.now(),
                });
              }
            }
            return next;
          });
        } else if (isNostrEvent(response)) {
          // Event received
          const event = response as NostrEvent & { _relay?: string };
          const relayUrl = event._relay;

          // Store event
          eventStore.add(event);
          setEventsMap(prev => {
            const next = new Map(prev);
            next.set(event.id, event);
            return next;
          });

          // Update relay state
          if (relayUrl) {
            setRelayStates(prev => {
              const state = prev.get(relayUrl);
              if (!state) return prev;

              const now = Date.now();
              const next = new Map(prev);
              next.set(relayUrl, {
                ...state,
                subscriptionState: 'receiving',
                eventCount: state.eventCount + 1,
                firstEventAt: state.firstEventAt ?? now,
                lastEventAt: now,
              });
              return next;
            });
          }
        }
      },
      (err: Error) => {
        console.error("REQ: Error", err);
        setError(err);
        setLoading(false);
      },
      () => {
        if (!stream) {
          setLoading(false);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [id, stableFilters, stableRelays, limit, stream, eventStore]);

  // Derive overall state
  const overallState = useMemo(() => {
    return deriveOverallState(
      relayStates,
      eoseReceived,
      stream,
      queryStartedAt.current
    );
  }, [relayStates, eoseReceived, stream]);

  return {
    events,
    loading,
    error,
    eoseReceived,
    relayStates,
    overallState,
  };
}
```

**Tests**: `src/hooks/useReqTimelineEnhanced.test.ts`
- Mock pool.subscription
- Test state transitions
- Test relay state tracking
- Test overall state derivation

---

### Phase 2: UI Integration

#### Task 2.1: Update ReqViewer Status Indicator

**File**: `src/components/ReqViewer.tsx`

**Changes**:
1. Import enhanced hook and state machine helpers
2. Replace `useReqTimeline` with `useReqTimelineEnhanced`
3. Update status indicator (lines 916-957) to use `overallState.status`
4. Update connection count to show connected vs total

```typescript
// Before
const { events, loading, error, eoseReceived } = useReqTimeline(
  `req-${JSON.stringify(filter)}-${closeOnEose}`,
  resolvedFilter,
  finalRelays,
  { limit: resolvedFilter.limit || 50, stream }
);

// After
const { events, loading, error, eoseReceived, relayStates, overallState } =
  useReqTimelineEnhanced(
    `req-${JSON.stringify(filter)}-${closeOnEose}`,
    resolvedFilter,
    finalRelays,
    { limit: resolvedFilter.limit || 50, stream }
  );

// Status indicator
<Radio
  className={`size-3 ${getStatusColor(overallState.status)} ${
    shouldAnimate(overallState.status) ? 'animate-pulse' : ''
  }`}
/>
<span className={`${getStatusColor(overallState.status)} font-semibold`}>
  {getStatusText(overallState)}
</span>

// Connection count
<span>
  {overallState.connectedCount}/{overallState.totalRelays}
</span>
```

---

#### Task 2.2: Enhance Relay Dropdown with Per-Relay Status

**File**: `src/components/ReqViewer.tsx`

**Changes**: Update relay dropdown (lines 998-1050) to show per-relay subscription state

```typescript
<DropdownMenuContent align="end" className="w-96 max-h-96 overflow-y-auto">
  {/* Connection Status */}
  <div className="py-1 border-b border-border">
    <div className="px-3 py-1 text-xs font-semibold text-muted-foreground">
      Relay Status
    </div>
    {Array.from(relayStates.values()).map((relayState) => {
      const globalState = relayStates[relayState.url];
      const connIcon = getConnectionIcon(globalState);

      return (
        <DropdownMenuItem
          key={relayState.url}
          className="flex items-center justify-between gap-2 font-mono text-xs"
        >
          <RelayLink
            url={relayState.url}
            showInboxOutbox={false}
            className="flex-1 min-w-0"
          />

          {/* Event count */}
          <div className="flex items-center gap-1 text-muted-foreground">
            {relayState.eventCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-0.5">
                    <FileText className="size-3" />
                    <span>{relayState.eventCount}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {relayState.eventCount} events received
                </TooltipContent>
              </Tooltip>
            )}

            {/* Subscription state badge */}
            {relayState.subscriptionState === 'receiving' && (
              <span className="text-[10px] text-green-500">RECEIVING</span>
            )}
            {relayState.subscriptionState === 'eose' && (
              <span className="text-[10px] text-blue-500">EOSE</span>
            )}
            {relayState.subscriptionState === 'error' && (
              <span className="text-[10px] text-red-500">ERROR</span>
            )}

            {/* Connection icon */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-help">{connIcon.icon}</div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{connIcon.label}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </DropdownMenuItem>
      );
    })}
  </div>

  {/* Relay Selection (NIP-65) */}
  {/* ... existing code ... */}
</DropdownMenuContent>
```

---

#### Task 2.3: Add Empty/Error States

**File**: `src/components/ReqViewer.tsx`

**Changes**: Add specific UI for failed/offline states

```typescript
{/* All Relays Failed */}
{overallState.status === 'failed' && (
  <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
    <div className="text-muted-foreground">
      <WifiOff className="size-12 mx-auto mb-3 text-red-500" />
      <h3 className="text-lg font-semibold mb-2">All Relays Failed</h3>
      <p className="text-sm max-w-md">
        Could not connect to any of the {overallState.totalRelays} relays.
        Check your network connection or try different relays.
      </p>
    </div>
  </div>
)}

{/* All Relays Offline (after being live) */}
{overallState.status === 'offline' && overallState.hasReceivedEvents && (
  <div className="border-b border-border px-4 py-2 bg-yellow-500/10">
    <span className="text-xs font-mono text-yellow-600">
      ⚠️ All relays disconnected. Showing cached results.
    </span>
  </div>
)}

{/* Partial Connection Warning */}
{overallState.status === 'partial' && (
  <div className="border-b border-border px-4 py-2 bg-yellow-500/10">
    <span className="text-xs font-mono text-yellow-600">
      ⚠️ Only {overallState.connectedCount}/{overallState.totalRelays} relays connected
    </span>
  </div>
)}
```

---

### Phase 3: Testing & Polish

#### Task 3.1: Add Unit Tests

**Files**:
- `src/lib/req-state-machine.test.ts` (already outlined above)
- `src/hooks/useReqTimelineEnhanced.test.ts`

**Test Coverage**:
- All state transitions
- Edge cases from analysis document
- Event tracking
- Connection state synchronization

---

#### Task 3.2: Add Integration Tests

**File**: `src/components/ReqViewer.test.tsx` (NEW)

**Scenarios**:
1. All relays offline → shows "FAILED"
2. Mixed success/failure → shows "PARTIAL"
3. Streaming with disconnections → shows "OFFLINE"
4. Single relay timeout → appropriate status

---

#### Task 3.3: Manual Testing Checklist

**File**: `docs/req-viewer-test-scenarios.md` (NEW)

Create manual test scenarios:
- [ ] Query with 30 relays, all offline
- [ ] Query with 10 relays, 5 succeed, 5 fail
- [ ] Query with 1 relay that times out (>10s)
- [ ] Streaming query, disconnect relays one by one
- [ ] Streaming query, all relays disconnect
- [ ] Non-streaming query, normal completion
- [ ] Query with AUTH-required relay
- [ ] Query with slow relay (8-12s response)
- [ ] Query with mix of fast/slow/failed relays

---

### Phase 4: Future Enhancements

#### Task 4.1: Relay Performance Metrics

Track and display:
- Average response time per relay
- Success/failure rate
- Event count distribution
- EOSE latency

#### Task 4.2: Smart Relay Selection

Integrate with RelayLiveness:
- Skip relays in backoff state
- Prefer historically fast relays
- Warn about consistently failing relays

#### Task 4.3: Query Optimization Suggestions

Analyze query and suggest:
- "Query too broad, consider adding time range"
- "Consider using NIP-65 outbox relays"
- "Relay X frequently fails, consider removing"

---

## Implementation Schedule

### Week 1: Core Infrastructure
- Day 1-2: Tasks 1.1, 1.2 (types + state machine)
- Day 3-4: Task 1.3 (enhanced hook)
- Day 5: Unit tests (Task 3.1)

### Week 2: UI Integration
- Day 1-2: Task 2.1 (status indicator)
- Day 3: Task 2.2 (relay dropdown)
- Day 4: Task 2.3 (empty states)
- Day 5: Integration tests (Task 3.2)

### Week 3: Testing & Polish
- Day 1-2: Manual testing (Task 3.3)
- Day 3-4: Bug fixes and refinements
- Day 5: Documentation and code review

---

## Success Criteria

### Must Have (Phase 1-2)
- [x] "LIVE" only shows when relays actually connected
- [x] Distinguish between CLOSED, OFFLINE, and FAILED states
- [x] Show accurate connected relay count
- [x] Per-relay status in dropdown
- [x] Handle "all relays disconnected" case correctly

### Should Have (Phase 3)
- [ ] Unit tests covering all state transitions
- [ ] Integration tests for key scenarios
- [ ] Manual test scenarios documented and passing

### Nice to Have (Phase 4)
- [ ] Relay performance metrics
- [ ] Smart relay selection based on history
- [ ] Query optimization suggestions

---

## Risks & Mitigation

### Risk 1: Can't distinguish real EOSE from timeout/error
**Impact**: Medium
**Mitigation**: Track connection state + events received to infer state

### Risk 2: Event metadata might not have `_relay` property
**Impact**: High
**Mitigation**: Verify `markFromRelay()` operator is working, fallback to all-connected logic

### Risk 3: State synchronization lag between hooks
**Impact**: Low
**Mitigation**: Use stable references, debounce updates if needed

### Risk 4: Performance impact of per-relay tracking
**Impact**: Low
**Mitigation**: Use Map for O(1) lookups, memoize derived state

---

## Rollout Plan

### Phase 1: Soft Launch
1. Merge behind feature flag
2. Test internally with various queries
3. Gather feedback from team

### Phase 2: Beta
1. Enable for subset of users
2. Monitor for issues
3. Collect user feedback

### Phase 3: General Availability
1. Enable for all users
2. Document new status indicators
3. Create help articles

---

## Documentation Updates

### User-Facing
- Update help docs with new status indicators
- Explain what each status means
- Add troubleshooting guide for failed queries

### Developer-Facing
- Document ReqRelayState and ReqOverallState types
- Document state machine transitions
- Add ADR (Architecture Decision Record)

---

## Related Work

### Upstream Issues
- Submit PR to applesauce-relay for catchError bug
- Propose per-relay EOSE tracking API enhancement

### Technical Debt
- Migrate other timeline hooks to enhanced version
- Consolidate timeline state management
- Improve relay health tracking

---

## Monitoring & Metrics

### Success Metrics
- Reduction in user-reported "LIVE with 0 relays" issues
- Improved query success rate (user perception)
- Reduced confusion about query status

### Technical Metrics
- State machine transition frequency
- Per-relay success/failure rates
- Average query completion time
- EOSE latency distribution

---

## References

- Analysis: `docs/req-viewer-state-analysis.md`
- NIP-01: https://github.com/nostr-protocol/nips/blob/master/01.md
- Applesauce-relay: node_modules/applesauce-relay/dist/
- RelayStateManager: `src/services/relay-state-manager.ts`
