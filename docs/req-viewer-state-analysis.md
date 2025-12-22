# ReqViewer State Machine Analysis

**Date**: 2025-12-22
**Issue**: Disconnected relays are incorrectly shown as "LIVE" and counted as having sent EOSE

## Executive Summary

The ReqViewer state machine has a critical bug where relay disconnections are indistinguishable from EOSE messages, leading to incorrect status indicators. A query using 30 relays where all disconnect will show "LIVE" status with 0/30 relays connected.

## Architecture Overview

### Current Flow

```
User Query → useReqTimeline → pool.subscription → RelayGroup → Individual Relays
                    ↓                                                      ↓
             setEoseReceived(true) ←── "EOSE" string ←── catchError → DISCONNECTION
                    ↓
             Shows "LIVE" indicator
```

### Key Components

1. **ReqViewer** (`src/components/ReqViewer.tsx`):
   - UI component that displays query results and status
   - Lines 918-957: Status indicator logic based on `loading`, `eoseReceived`, `stream`
   - Lines 735-737: Connected relay count based on `connectionState === "connected"`

2. **useReqTimeline** (`src/hooks/useReqTimeline.ts`):
   - Hook that manages REQ subscription
   - Line 88: Sets `eoseReceived = true` when response is string "EOSE"
   - No awareness of relay disconnection state

3. **RelayPool** (applesauce-relay):
   - `pool.subscription()` delegates to RelayGroup
   - Uses retry/reconnect logic but doesn't expose per-relay EOSE state

4. **RelayGroup** (applesauce-relay/dist/group.js):
   - **CRITICAL BUG HERE**: Line with `catchError(() => of("EOSE"))`
   - Treats ANY error (including disconnection) as EOSE
   - Aggregates EOSE from all relays before emitting overall EOSE

5. **Relay** (applesauce-relay/dist/relay.js):
   - Individual relay connection
   - Has 10-second EOSE timeout that emits fake EOSE if none received
   - Emits observables: `connected$`, `challenge$`, `authenticated$`, `notice$`

## Critical Bug: Error Handling in RelayGroup

### The Problem

In `node_modules/applesauce-relay/dist/group.js`:

```javascript
const observable = project(relay).pipe(
  // Catch connection errors and return EOSE
  catchError(() => of("EOSE")),  // ← BUG: Disconnections become EOSE!
  map((value) => [relay, value])
);
```

**Why this is problematic**:
- A relay that never connected emits "EOSE"
- A relay that disconnects mid-query emits "EOSE"
- A relay with a WebSocket error emits "EOSE"
- These fake EOSE messages are indistinguishable from real ones

### EOSE Aggregation Logic

```javascript
const eose = this.relays$.pipe(
  switchMap((relays) =>
    main.pipe(
      filter(([_, value]) => value === "EOSE"),
      scan((received, [relay]) => [...received, relay], []),
      // Wait until ALL relays have "sent" EOSE
      takeWhile((received) => relays.some((r) => !received.includes(r))),
      ignoreElements(),
      endWith("EOSE") // ← Emits when all relays done (or errored)
    )
  )
);
```

**Result**: The overall EOSE is emitted when:
- ✅ All relays sent real EOSE and are streaming
- ✅ All relays sent real EOSE and closed connection
- ❌ All relays disconnected (caught and turned into fake EOSE)
- ❌ Mix of real EOSE and disconnections (can't tell the difference)

## Edge Cases & Failure Scenarios

### Scenario 1: All Relays Disconnect Immediately
**Setup**: Query with 10 relays, all are offline or reject connection
**Current Behavior**:
- Each relay: `catchError` → emits "EOSE"
- useReqTimeline: Sets `eoseReceived = true`
- ReqViewer: Shows "LIVE" indicator (green, pulsing)
- Connection count: 0/10
- User sees: "LIVE" with 0 connected relays

**Expected Behavior**: Show "ERROR" or "NO RELAYS" status

### Scenario 2: Slow Relays with Timeout
**Setup**: Query with relay that takes 15 seconds to respond
**Current Behavior**:
- After 10s: EOSE timeout fires → emits fake "EOSE"
- Relay still connected, might send more events later
- User sees: "LIVE" but relay is counted as "done"

**Expected Behavior**: Continue waiting or show "PARTIAL" status

### Scenario 3: Mixed Success/Failure
**Setup**: 30 relays, 10 succeed with EOSE, 15 disconnect, 5 timeout
**Current Behavior**:
- All 30 eventually emit "EOSE" (real or fake)
- Overall EOSE emitted
- Shows "LIVE" with 10/30 connected
- User can't tell which relays actually completed vs failed

**Expected Behavior**: Show per-relay status and overall "PARTIAL" indicator

### Scenario 4: Mid-Query Disconnection
**Setup**: Relay sends 50 events, then disconnects before EOSE
**Current Behavior**:
- Disconnection → `catchError` → fake "EOSE"
- Events are shown, looks like query completed successfully
- No indication that query was interrupted

**Expected Behavior**: Show warning that relay disconnected mid-query

### Scenario 5: Streaming Mode with Gradual Disconnections
**Setup**: Query in streaming mode, relays disconnect one by one
**Current Behavior**:
- Each disconnection → fake "EOSE"
- Eventually all relays have "EOSE"
- Shows "LIVE" with 0/30 connected (THE REPORTED BUG!)

**Expected Behavior**: Show "OFFLINE" or "NO ACTIVE RELAYS" when all disconnect

### Scenario 6: Single Relay Query
**Setup**: Query with explicit relay that doesn't respond
**Current Behavior**:
- After 10s timeout → fake "EOSE"
- Shows "CLOSED" (not streaming)
- No indication relay never responded

**Expected Behavior**: Show "TIMEOUT" or "NO RESPONSE" status

### Scenario 7: AUTH Required But Not Provided
**Setup**: Relay requires authentication, no account active
**Current Behavior**:
- Relay returns "auth-required" CLOSED message
- Caught and turned into "EOSE"
- Looks like query completed with no results

**Expected Behavior**: Show "AUTH REQUIRED" status

## State Machine Requirements

### Required States

**Query-Level States**:
- `DISCOVERING`: Selecting relays (NIP-65 outbox discovery)
- `CONNECTING`: Waiting for first relay to connect
- `LOADING`: At least one relay connected, waiting for initial EOSE
- `LIVE`: At least one relay streaming after EOSE
- `PARTIAL`: Some relays completed, some failed/disconnected
- `CLOSED`: All relays sent EOSE and closed (non-streaming)
- `FAILED`: All relays failed to connect or errored
- `TIMEOUT`: No relays responded within timeout
- `AUTH_REQUIRED`: Some/all relays require authentication

**Per-Relay States** (tracked separately):
- `PENDING`: Relay in list but not yet connected
- `CONNECTING`: Connection attempt in progress
- `CONNECTED`: WebSocket open, REQ sent
- `RECEIVING`: Events being received
- `EOSE_RECEIVED`: EOSE message received (still connected)
- `CLOSED`: Clean closure after EOSE
- `DISCONNECTED`: Unexpected disconnection
- `ERROR`: Connection error or protocol error
- `TIMEOUT`: No response within timeout
- `AUTH_REQUIRED`: Relay requires authentication

### State Transition Rules

**Query Level**:
```
DISCOVERING → CONNECTING (when relays selected)
CONNECTING → LOADING (when first relay connects)
CONNECTING → FAILED (when all relay connections fail, timeout)

LOADING → LIVE (when EOSE received, stream=true, >0 relays connected)
LOADING → PARTIAL (when some EOSE, some failed, stream=true)
LOADING → CLOSED (when all EOSE received, stream=false)
LOADING → FAILED (when all relays fail before EOSE)

LIVE → PARTIAL (when some relays disconnect)
LIVE → FAILED (when all relays disconnect)

PARTIAL → LIVE (when previously failed relays reconnect)
PARTIAL → FAILED (when remaining relays disconnect)
```

**Per-Relay** (tracked in RelayStateManager):
```
PENDING → CONNECTING (when connection initiated)
CONNECTING → CONNECTED (when WebSocket open, REQ sent)
CONNECTING → ERROR (when connection fails)
CONNECTING → TIMEOUT (when connection takes too long)

CONNECTED → RECEIVING (when first event received)
CONNECTED → EOSE_RECEIVED (when EOSE received, no prior events)
CONNECTED → ERROR (when connection lost)

RECEIVING → EOSE_RECEIVED (when EOSE received)
RECEIVING → DISCONNECTED (when connection lost before EOSE)
RECEIVING → ERROR (when protocol error)

EOSE_RECEIVED → CLOSED (when relay closes connection after EOSE)
EOSE_RECEIVED → DISCONNECTED (when relay keeps connection open in streaming)
```

## Data Requirements

### Information We Need But Don't Have

1. **Per-Relay EOSE Status**:
   - Which relays sent real EOSE?
   - Which relays disconnected without EOSE?
   - Which relays timed out?
   - Which relays are still streaming?

2. **Per-Relay Event Counts**:
   - How many events did each relay send?
   - Useful for showing progress and diagnosing issues

3. **Error Details**:
   - Why did relay fail? (connection refused, timeout, protocol error, auth required)
   - Currently lost in `catchError(() => of("EOSE"))`

4. **Timing Information**:
   - When did relay connect?
   - When did first event arrive?
   - When did EOSE arrive?
   - How long did query take per relay?

5. **Relay Health Context**:
   - Is relay in RelayLiveness backoff state?
   - Has relay been failing consistently?
   - Should we even attempt connection?

### Information We Have But Don't Use

From **RelayStateManager** (`src/services/relay-state-manager.ts`):
- ✅ `connectionState`: "connected" | "connecting" | "disconnected" | "error"
- ✅ `lastConnected`, `lastDisconnected`: Timestamps
- ✅ `errors[]`: Array of error messages with types
- ✅ `stats.connectionsCount`: How many times relay connected

From **RelayLiveness** (`src/services/relay-liveness.ts`):
- ✅ Failure counts per relay
- ✅ Backoff states
- ✅ Last success/failure times
- ✅ Should prevent connection attempts to dead relays

**Problem**: useReqTimeline doesn't integrate with either of these!

## Nostr Protocol Semantics

### REQ Lifecycle (NIP-01)

1. Client sends: `["REQ", <subscription_id>, <filter1>, <filter2>, ...]`
2. Relay responds with zero or more: `["EVENT", <subscription_id>, <event>]`
3. Relay sends: `["EOSE", <subscription_id>]` when initial query complete
4. Client can keep subscription open for streaming
5. Client closes: `["CLOSE", <subscription_id>]`
6. Relay can close: `["CLOSED", <subscription_id>, <reason>]`

### EOSE Semantics

**What EOSE means**:
- ✅ "I have sent all stored events matching your filter"
- ✅ "Initial query phase is complete"
- ✅ Connection is still open (unless relay closes immediately after)

**What EOSE does NOT mean**:
- ❌ "No more events will be sent" (streaming continues)
- ❌ "Connection is closing"
- ❌ "Query was successful" (could have returned 0 events)

### CLOSED Semantics

**Why relays send CLOSED**:
- `auth-required`: AUTH event required before query
- `rate-limited`: Too many requests
- `error`: Generic error (parsing, internal, etc.)
- `invalid`: Filter validation failed

**Client should**:
- Distinguish CLOSED from EOSE
- Handle auth-required by prompting user
- Handle rate-limiting with backoff
- Show errors to user

## Applesauce Behavior Analysis

### Retry/Reconnect Logic

**relay.subscription()** options:
- `retries` (deprecated): Number of retry attempts
- `reconnect` (default: true, 10 retries): Retry on connection failures
- `resubscribe` (default: false): Resubscribe if relay sends CLOSED

**Current usage in useReqTimeline.ts**:
```typescript
pool.subscription(relays, filtersWithLimit, {
  retries: 5,
  reconnect: 5,
  resubscribe: true,
  eventStore,
});
```

**Behavior**:
- Retries connection failures up to 5 times
- Resubscribes if relay sends CLOSED (like auth-required)
- Uses exponential backoff (see `Relay.createReconnectTimer`)

**Issue**: All this retry logic happens inside applesauce, invisible to useReqTimeline. We can't show "RETRYING" status or retry count to user.

### Group Subscription Behavior

**relay.subscription()** in RelayGroup:
```javascript
subscription(filters, opts) {
  return this.internalSubscription(
    (relay) => relay.subscription(filters, opts),
    opts?.eventStore == null ? identity : filterDuplicateEvents(opts?.eventStore)
  );
}
```

**Key behaviors**:
1. Creates observable for each relay
2. Merges all observables
3. Deduplicates events via EventStore
4. Catches errors and converts to "EOSE" (THE BUG)
5. Emits overall "EOSE" when all relays done

**Missing**:
- No per-relay state tracking
- No way to query "which relays have sent EOSE?"
- No way to query "which relays are still connected?"
- Error information is lost

## Technical Constraints

### What We Can't Change

1. **Applesauce-relay library behavior**:
   - We can't modify the `catchError(() => of("EOSE"))` in RelayGroup
   - This is in node_modules, upstream library
   - Would need to fork or submit PR

2. **Observable-based API**:
   - pool.subscription returns `Observable<SubscriptionResponse>`
   - Response is either `NostrEvent` or string `"EOSE"`
   - Can't change this interface without forking

3. **Relay connection pooling**:
   - RelayPool manages all relay connections globally
   - Multiple components can share same relay connection
   - Can't have per-query relay isolation

### What We Can Work With

1. **RelayStateManager**:
   - Already tracks per-relay connection state
   - Updates in real-time via observables
   - Available via `useRelayState()` hook
   - CAN BE ENHANCED to track per-query state

2. **EventStore**:
   - Already receives all events
   - Could be instrumented to track per-relay events
   - Has access to relay URL via event metadata

3. **Custom observables**:
   - We can tap into the subscription observable
   - Track events and EOSE per relay ourselves
   - Build parallel state tracking

4. **Relay URL in events**:
   - Events marked with relay URL via `markFromRelay()` operator
   - Can track which relay sent which events

## Proposed Solutions

### Solution 1: Per-Relay Subscription Tracking (Recommended)

**Approach**: Track individual relay subscriptions in parallel with the group subscription.

**Implementation**:
```typescript
interface RelaySubscriptionState {
  url: string;
  status: 'pending' | 'connecting' | 'receiving' | 'eose' | 'closed' | 'error';
  eventCount: number;
  firstEventAt?: number;
  eoseAt?: number;
  error?: Error;
}

function useReqTimelineEnhanced(id, filters, relays, options) {
  const [relayStates, setRelayStates] = useState<Map<string, RelaySubscriptionState>>();

  // Subscribe to individual relays
  useEffect(() => {
    const subs = relays.map(url => {
      const relay = pool.relay(url);
      return relay.req(filters).subscribe({
        next: (response) => {
          if (response === 'EOSE') {
            setRelayStates(prev => prev.set(url, { ...prev.get(url), status: 'eose', eoseAt: Date.now() }));
          } else {
            setRelayStates(prev => prev.set(url, {
              ...prev.get(url),
              status: 'receiving',
              eventCount: (prev.get(url)?.eventCount ?? 0) + 1
            }));
          }
        },
        error: (err) => {
          setRelayStates(prev => prev.set(url, { ...prev.get(url), status: 'error', error: err }));
        }
      });
    });

    return () => subs.forEach(sub => sub.unsubscribe());
  }, [relays, filters]);

  // Derive overall state from individual relay states
  const overallState = useMemo(() => {
    const states = Array.from(relayStates.values());
    const connected = states.filter(s => ['receiving', 'eose'].includes(s.status));
    const eose = states.filter(s => s.status === 'eose');
    const errors = states.filter(s => s.status === 'error');

    if (connected.length === 0 && errors.length === states.length) return 'FAILED';
    if (eose.length === states.length) return 'CLOSED';
    if (eose.length > 0 && connected.length > 0) return 'LIVE';
    if (connected.length > 0) return 'LOADING';
    return 'CONNECTING';
  }, [relayStates]);

  return { events, relayStates, overallState };
}
```

**Pros**:
- ✅ Accurate per-relay tracking
- ✅ Can distinguish real EOSE from errors
- ✅ Works around applesauce bug without forking
- ✅ Provides rich debugging information

**Cons**:
- ❌ Duplicate subscriptions (one per relay + one group)
- ❌ More memory usage
- ❌ Potential for state synchronization issues

### Solution 2: Enhanced Group Observable Wrapper

**Approach**: Wrap the group subscription and parse relay URL from event metadata.

**Implementation**:
```typescript
function useReqTimelineWithTracking(id, filters, relays, options) {
  const [relayEose, setRelayEose] = useState<Set<string>>(new Set());
  const { relays: relayStates } = useRelayState();

  useEffect(() => {
    const observable = pool.subscription(relays, filters, options).pipe(
      tap(response => {
        if (typeof response === 'string' && response === 'EOSE') {
          // This is the aggregated EOSE, check which relays are still connected
          const stillConnected = relays.filter(url =>
            relayStates[url]?.connectionState === 'connected'
          );
          // If no relays connected, treat as failure not EOSE
          if (stillConnected.length === 0) {
            setError(new Error('All relays disconnected'));
            return;
          }
        } else if (isNostrEvent(response)) {
          // Track which relay sent this event
          const relayUrl = (response as any)._relay; // Added by markFromRelay()
          if (relayUrl && !relayEose.has(relayUrl)) {
            // Mark relay as active/receiving
          }
        }
      })
    );

    return observable.subscribe(/* ... */);
  }, [relays, filters]);
}
```

**Pros**:
- ✅ Single subscription (no duplication)
- ✅ Uses existing infrastructure
- ✅ Leverages RelayStateManager

**Cons**:
- ❌ Can't distinguish real EOSE from fake (happens in applesauce)
- ❌ Relies on relay URL being added to events
- ❌ Still shows "EOSE" when all relays disconnect

### Solution 3: Fork Applesauce-Relay (Not Recommended)

**Approach**: Fork applesauce-relay and fix the catchError bug.

**Changes needed**:
```typescript
// In group.js, change:
catchError(() => of("EOSE"))

// To:
catchError((err) => of({ type: 'ERROR', relay, error: err }))

// And update EOSE aggregation to only count real EOSE
```

**Pros**:
- ✅ Fixes root cause
- ✅ Proper error handling
- ✅ Could be upstreamed

**Cons**:
- ❌ Maintenance burden of fork
- ❌ Need to track upstream changes
- ❌ Breaks applesauce API contract

### Solution 4: Hybrid Approach (RECOMMENDED)

**Combine** Solution 1 + Solution 2:
1. Use RelayStateManager to track connection state
2. Subscribe to group observable for events (deduplication)
3. Build per-relay state machine based on:
   - Connection state from RelayStateManager
   - Events received (tracked by relay URL in metadata)
   - Overall EOSE from group subscription
4. Derive accurate overall state

**Implementation** in new file `src/hooks/useReqTimelineEnhanced.ts`:
```typescript
interface ReqRelayState {
  url: string;
  connectionState: 'pending' | 'connecting' | 'connected' | 'disconnected' | 'error';
  subscriptionState: 'waiting' | 'receiving' | 'eose' | 'timeout' | 'error';
  eventCount: number;
  firstEventAt?: number;
  lastEventAt?: number;
  errorMessage?: string;
}

interface ReqOverallState {
  status: 'discovering' | 'connecting' | 'loading' | 'live' | 'partial' | 'closed' | 'failed';
  connectedCount: number;
  eoseCount: number;
  errorCount: number;
  totalRelays: number;
}

export function useReqTimelineEnhanced(
  id: string,
  filters: Filter | Filter[],
  relays: string[],
  options: UseReqTimelineOptions = {}
) {
  // State
  const [relayStates, setRelayStates] = useState<Map<string, ReqRelayState>>(new Map());
  const [overallEose, setOverallEose] = useState(false);

  // Get relay connection states
  const { relays: globalRelayStates } = useRelayState();

  // Subscribe to events
  const observable = pool.subscription(relays, filters, options);

  useEffect(() => {
    // Initialize relay states
    setRelayStates(new Map(relays.map(url => [
      url,
      {
        url,
        connectionState: 'pending',
        subscriptionState: 'waiting',
        eventCount: 0,
      }
    ])));

    const sub = observable.subscribe({
      next: (response) => {
        if (response === 'EOSE') {
          setOverallEose(true);
        } else {
          const event = response as NostrEvent;
          const relayUrl = (event as any)._relay;

          setRelayStates(prev => {
            const state = prev.get(relayUrl);
            if (!state) return prev;

            const next = new Map(prev);
            next.set(relayUrl, {
              ...state,
              subscriptionState: 'receiving',
              eventCount: state.eventCount + 1,
              firstEventAt: state.firstEventAt ?? Date.now(),
              lastEventAt: Date.now(),
            });
            return next;
          });
        }
      },
      error: (err) => {
        // Overall subscription error
      },
    });

    return () => sub.unsubscribe();
  }, [relays, filters]);

  // Sync connection state from RelayStateManager
  useEffect(() => {
    setRelayStates(prev => {
      const next = new Map(prev);
      for (const [url, state] of prev) {
        const globalState = globalRelayStates[url];
        if (globalState) {
          next.set(url, {
            ...state,
            connectionState: globalState.connectionState as any,
          });
        }
      }
      return next;
    });
  }, [globalRelayStates]);

  // Derive overall state
  const overallState: ReqOverallState = useMemo(() => {
    const states = Array.from(relayStates.values());
    const connected = states.filter(s => s.connectionState === 'connected');
    const receivedData = states.filter(s => s.eventCount > 0);
    const errors = states.filter(s => s.connectionState === 'error');

    const status = (() => {
      if (relays.length === 0) return 'discovering';
      if (connected.length === 0 && errors.length === states.length) return 'failed';
      if (connected.length === 0 && receivedData.length === 0) return 'connecting';
      if (!overallEose) return 'loading';
      if (connected.length === 0 && overallEose) return 'closed';
      if (connected.length > 0 && overallEose && options.stream) return 'live';
      if (connected.length < relays.length && overallEose) return 'partial';
      return 'closed';
    })();

    return {
      status,
      connectedCount: connected.length,
      eoseCount: states.filter(s => s.subscriptionState === 'eose').length,
      errorCount: errors.length,
      totalRelays: relays.length,
    };
  }, [relayStates, overallEose, relays.length, options.stream]);

  return {
    events,
    relayStates,
    overallState,
    loading: !overallEose,
    eoseReceived: overallEose,
  };
}
```

**Pros**:
- ✅ No duplicate subscriptions
- ✅ Accurate connection tracking
- ✅ Rich per-relay information
- ✅ Works with existing infrastructure
- ✅ Can show "LIVE" only when relays actually connected

**Cons**:
- ❌ Can't distinguish real EOSE from timeout/error (upstream issue)
- ❌ More complex state management
- ❌ Depends on event metadata having relay URL

## Recommendation

**Implement Solution 4 (Hybrid Approach)** as the most pragmatic path forward:

1. Create `useReqTimelineEnhanced` hook with per-relay state tracking
2. Update ReqViewer to use enhanced hook
3. Improve status indicator logic to use overall state
4. Add per-relay status display in relay dropdown
5. Show accurate indicators for edge cases

**Future work**:
- Submit PR to applesauce-relay to fix catchError bug
- Add per-relay EOSE tracking to applesauce (upstream enhancement)
- Implement relay health scoring to avoid dead relays

## Implementation Priority

### Phase 1: Critical Fixes (Immediate)
1. Implement `useReqTimelineEnhanced` hook
2. Update ReqViewer status indicator logic
3. Add per-relay state display
4. Handle "all relays disconnected" case

### Phase 2: Enhanced UX (Next)
5. Add per-relay event counts
6. Show relay timing information
7. Add retry/reconnection indicators
8. Integrate with RelayLiveness for smarter relay selection

### Phase 3: Advanced Features (Future)
9. Partial EOSE indicator (some relays done, some still loading)
10. Relay performance metrics
11. Automatic relay ranking and selection
12. Query optimization suggestions

## Testing Strategy

### Unit Tests
- State machine transitions
- Edge case handling
- EOSE aggregation logic

### Integration Tests
- Real relay connections
- Timeout scenarios
- Mixed success/failure scenarios

### Manual Testing Scenarios
1. Query with all offline relays
2. Query with mixed offline/online
3. Query with slow relay (>10s response)
4. Mid-query disconnections
5. Streaming mode with gradual disconnections
6. Single relay queries
7. AUTH-required relays
8. Rate-limited relays

## Metrics to Track

### User-Visible
- Time to first event
- Time to EOSE per relay
- Events per relay
- Success/failure ratio

### Debug/Observability
- Relay response times
- Failure reasons
- Retry attempts
- Reconnection events

## Related Issues

- RelayLiveness not being checked before connection attempts
- No visual feedback during relay discovery phase
- No indication of AUTH requirements
- No rate limiting awareness

## References

- NIP-01: https://github.com/nostr-protocol/nips/blob/master/01.md
- Applesauce-relay docs: (internal node_modules)
- RelayStateManager: `src/services/relay-state-manager.ts`
- useReqTimeline: `src/hooks/useReqTimeline.ts`
- ReqViewer: `src/components/ReqViewer.tsx`
