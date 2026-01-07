# Outbox Relay Selection Improvements Plan

This document outlines the implementation plan for improving Grimoire's NIP-65 outbox relay selection to maximize reliability and performance.

**Priority**: Reliability (getting events from the right relays) > Performance (speed/efficiency)

---

## Overview

We're implementing 4 improvements that work together:

1. **Relay Performance Scoring** - Track response time, connection time, stability
2. **Adaptive Timeouts** - Use historical performance to set per-relay timeouts
3. **Per-Relay Filter Optimization** - Send only relevant authors to each relay
4. **Custom Scoring Function** - Combine scoring + coverage in relay selection

---

## 1. Relay Performance Scoring

### Goal
Track relay performance metrics over time to prefer fast, reliable relays.

### Metrics to Track (inspired by noStrudel)

```typescript
interface RelayPerformanceMetrics {
  url: string;

  // Response time (how fast relay answers queries)
  responseTimeMs: number;        // Exponential moving average
  responseTimeCount: number;     // Number of samples

  // Connection time (how fast WebSocket connects)
  connectTimeMs: number;         // Exponential moving average
  connectTimeCount: number;      // Number of samples

  // Stability (how long before relay disconnects)
  avgSessionDurationMs: number;  // Average time connected before disconnect
  sessionCount: number;          // Number of sessions

  // Success rate
  successfulQueries: number;
  failedQueries: number;

  // Timestamps
  lastUpdated: number;
  lastSuccess: number;
  lastFailure: number;
}
```

### Scoring Algorithm

```typescript
function calculateRelayScore(metrics: RelayPerformanceMetrics): number {
  // Response time score: 0-10 points
  // 1 point per 100ms under 1000ms, max 10
  const responseScore = Math.max(0, Math.min(10,
    (1000 - metrics.responseTimeMs) / 100
  ));

  // Connection time score: 0-10 points
  // Same formula as response time
  const connectScore = Math.max(0, Math.min(10,
    (1000 - metrics.connectTimeMs) / 100
  ));

  // Stability score: 0-10 points
  // Based on average session duration
  // 1 point per 30s of stability, max 10 (5 min)
  const stabilityScore = Math.max(0, Math.min(10,
    metrics.avgSessionDurationMs / 30000
  ));

  // Success rate score: 0-10 points
  const totalQueries = metrics.successfulQueries + metrics.failedQueries;
  const successRate = totalQueries > 0
    ? metrics.successfulQueries / totalQueries
    : 0.5; // Default to 50% for unknown relays
  const successScore = successRate * 10;

  // Combined score (weighted)
  // Response time is most important for UX
  return (
    responseScore * 0.4 +
    connectScore * 0.2 +
    stabilityScore * 0.2 +
    successScore * 0.2
  );
}
```

### Files to Create/Modify

**New file: `src/services/relay-scoreboard.ts`**
```typescript
import db from "./db";
import pool from "./relay-pool";

class RelayScoreboard {
  private metrics = new Map<string, RelayPerformanceMetrics>();
  private saveInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.load();
    this.connectToPool();
    this.startAutoSave();
  }

  // Record a successful query response
  recordResponse(url: string, responseTimeMs: number): void;

  // Record connection establishment
  recordConnect(url: string, connectTimeMs: number): void;

  // Record session end (for stability tracking)
  recordSessionEnd(url: string, durationMs: number): void;

  // Record query result
  recordQueryResult(url: string, success: boolean): void;

  // Get score for a relay (0-10)
  getScore(url: string): number;

  // Get all metrics for debugging
  getMetrics(url: string): RelayPerformanceMetrics | undefined;

  // Persist to Dexie
  async save(): Promise<void>;

  // Load from Dexie
  async load(): Promise<void>;

  // Hook into relay pool events
  private connectToPool(): void;
}

export const relayScoreboard = new RelayScoreboard();
export default relayScoreboard;
```

**Modify: `src/services/db.ts`**
- Add new table: `relayPerformance`
- Add DB version migration

```typescript
export interface RelayPerformanceEntry {
  url: string;
  responseTimeMs: number;
  responseTimeCount: number;
  connectTimeMs: number;
  connectTimeCount: number;
  avgSessionDurationMs: number;
  sessionCount: number;
  successfulQueries: number;
  failedQueries: number;
  lastUpdated: number;
  lastSuccess: number;
  lastFailure: number;
}

// Add to DB schema version 15:
this.version(15).stores({
  // ... existing tables ...
  relayPerformance: "&url",
});
```

### Integration Points

1. **Pool connection events**: Track connect time when WebSocket opens
2. **Subscription EOSE**: Track response time from REQ to EOSE
3. **Relay disconnect**: Track session duration
4. **Query errors**: Track success/failure rate

---

## 2. Adaptive Timeouts

### Goal
Use historical performance data to set smart per-relay timeouts for relay list fetches.

### Algorithm

```typescript
function getAdaptiveTimeout(url: string): number {
  const metrics = relayScoreboard.getMetrics(url);

  if (!metrics || metrics.responseTimeCount < 3) {
    // Not enough data - use default
    return 1000;
  }

  // Base timeout: 2x average response time
  let timeout = metrics.responseTimeMs * 2;

  // Adjust based on success rate
  const totalQueries = metrics.successfulQueries + metrics.failedQueries;
  if (totalQueries > 5) {
    const successRate = metrics.successfulQueries / totalQueries;
    if (successRate < 0.5) {
      // Unreliable relay - shorter timeout
      timeout = Math.min(timeout, 500);
    }
  }

  // Clamp to reasonable bounds
  return Math.max(300, Math.min(2000, timeout));
}
```

### Files to Modify

**Modify: `src/services/relay-selection.ts`**

```typescript
import relayScoreboard from "./relay-scoreboard";

// Replace fixed timeout with adaptive
async function fetchRelayList(
  pubkey: string,
  defaultTimeoutMs: number,
): Promise<void> {
  // Get cached relay list to find which relays to query
  const cachedRelays = await relayListCache.getOutboxRelays(pubkey);

  // Use adaptive timeout based on known relays
  // If we know which relay we'll query, use its specific timeout
  // Otherwise use the default
  const timeout = cachedRelays && cachedRelays.length > 0
    ? Math.max(...cachedRelays.map(r => getAdaptiveTimeout(r)))
    : defaultTimeoutMs;

  // ... rest of fetch logic with adaptive timeout
}
```

---

## 3. Per-Relay Filter Optimization

### Goal
Send only the relevant subset of authors to each relay, reducing bandwidth and improving relay processing.

### Current Behavior

```typescript
// Current: Same filter to all relays
const relays = selectOptimalRelays(pointers, options);
// All relays get: { authors: [A, B, C, D, E], kinds: [1] }
```

### Proposed Behavior

```typescript
// New: Per-relay filters
interface RelayFilterMap {
  relay: string;
  filter: NostrFilter;
  authors: string[]; // Authors this relay covers
}

function createPerRelayFilters(
  selectedPointers: ProfilePointer[],
  baseFilter: NostrFilter
): RelayFilterMap[] {
  const relayToAuthors = new Map<string, Set<string>>();

  // Group authors by relay
  for (const pointer of selectedPointers) {
    for (const relay of pointer.relays || []) {
      if (!relayToAuthors.has(relay)) {
        relayToAuthors.set(relay, new Set());
      }
      relayToAuthors.get(relay)!.add(pointer.pubkey);
    }
  }

  // Create per-relay filters
  return Array.from(relayToAuthors.entries()).map(([relay, authors]) => ({
    relay,
    authors: Array.from(authors),
    filter: {
      ...baseFilter,
      authors: Array.from(authors),
    },
  }));
}
```

### Return Type Change

```typescript
// Current
interface RelaySelectionResult {
  relays: string[];
  reasoning: RelaySelectionReasoning[];
  isOptimized: boolean;
}

// New: Add per-relay filter maps
interface RelaySelectionResult {
  relays: string[];
  reasoning: RelaySelectionReasoning[];
  isOptimized: boolean;
  perRelayFilters?: RelayFilterMap[];  // Optional for backward compat
}
```

### Consumer Changes

Consumers that use per-relay filters can subscribe more efficiently:

```typescript
// In useReqTimeline or similar:
if (selectionResult.perRelayFilters) {
  // Subscribe to each relay with its specific filter
  for (const { relay, filter } of selectionResult.perRelayFilters) {
    pool.subscribe([relay], filter, handlers);
  }
} else {
  // Fallback: same filter to all relays
  pool.subscribe(selectionResult.relays, filter, handlers);
}
```

---

## 4. Custom Scoring Function

### Goal
Combine coverage optimization (applesauce's greedy algorithm) with performance scoring.

### Implementation

**Modify: `src/services/relay-selection.ts`**

```typescript
import relayScoreboard from "./relay-scoreboard";
import liveness from "./relay-liveness";

// Custom scoring function for selectOptimalRelays
function scoreRelay(
  relay: string,
  coverage: number,      // How many uncovered users this relay covers
  popularity: number,    // How many total users use this relay
): number {
  // Base score: coverage efficiency
  const coverageScore = coverage / Math.max(1, popularity);

  // Performance score from scoreboard (0-10, normalized to 0-1)
  const perfScore = relayScoreboard.getScore(relay) / 10;

  // Health multiplier from liveness
  const isHealthy = liveness.isHealthy(relay);
  const healthMultiplier = isHealthy ? 1.0 : 0.3; // Penalize unhealthy relays

  // Combined score
  // Coverage is weighted higher (we need the events)
  // Performance helps break ties and prefer faster relays
  return (
    coverageScore * 0.6 +
    perfScore * 0.4
  ) * healthMultiplier;
}

// Usage in selectRelaysForFilter:
const selectedAuthors = selectOptimalRelays(processedAuthorPointers, {
  maxConnections: authorRelayBudget,
  maxRelaysPerUser,
  score: scoreRelay,  // Custom scoring function
});
```

### Benefits

1. **Reliability**: Still prioritizes coverage (getting all authors)
2. **Performance**: Prefers faster relays when coverage is equal
3. **Health-aware**: Deprioritizes (but doesn't exclude) unhealthy relays

---

## Implementation Order

### Step 1: Relay Performance Scoring
1. Create `RelayPerformanceEntry` interface in `db.ts`
2. Add DB version 15 with `relayPerformance` table
3. Create `relay-scoreboard.ts` service
4. Hook into pool events to collect metrics
5. Add tests for scoring algorithm

### Step 2: Custom Scoring Function
1. Import scoreboard in `relay-selection.ts`
2. Create `scoreRelay` function
3. Pass to `selectOptimalRelays` calls
4. Add tests for custom scoring

### Step 3: Adaptive Timeouts
1. Create `getAdaptiveTimeout` function in `relay-scoreboard.ts`
2. Modify `fetchRelayList` to use adaptive timeouts
3. Add tests for timeout calculation

### Step 4: Per-Relay Filter Optimization
1. Create `RelayFilterMap` type
2. Add `createPerRelayFilters` function
3. Add `perRelayFilters` to `RelaySelectionResult`
4. Update `useOutboxRelays` hook to expose per-relay filters
5. Optionally update consumers to use per-relay subscriptions

---

## Testing Strategy

### Unit Tests

```typescript
// relay-scoreboard.test.ts
describe("RelayScoreboard", () => {
  describe("calculateRelayScore", () => {
    it("scores fast relays higher", () => {
      const fast = makeMetrics({ responseTimeMs: 100 });
      const slow = makeMetrics({ responseTimeMs: 900 });
      expect(calculateRelayScore(fast)).toBeGreaterThan(calculateRelayScore(slow));
    });

    it("scores reliable relays higher", () => {
      const reliable = makeMetrics({ successfulQueries: 95, failedQueries: 5 });
      const flaky = makeMetrics({ successfulQueries: 50, failedQueries: 50 });
      expect(calculateRelayScore(reliable)).toBeGreaterThan(calculateRelayScore(flaky));
    });
  });

  describe("getAdaptiveTimeout", () => {
    it("uses 2x average response time", () => {
      scoreboard.recordResponse("wss://fast.relay/", 200);
      scoreboard.recordResponse("wss://fast.relay/", 200);
      scoreboard.recordResponse("wss://fast.relay/", 200);
      expect(getAdaptiveTimeout("wss://fast.relay/")).toBe(400);
    });

    it("caps timeout for unreliable relays", () => {
      // Record many failures
      for (let i = 0; i < 10; i++) {
        scoreboard.recordQueryResult("wss://flaky.relay/", false);
      }
      expect(getAdaptiveTimeout("wss://flaky.relay/")).toBeLessThanOrEqual(500);
    });
  });
});
```

### Integration Tests

- Test that scoring persists across page reloads
- Test that pool events are properly captured
- Test relay selection with real filter scenarios

---

## Rollout Plan

1. **Phase 1**: Ship scoring + custom function behind feature flag
2. **Phase 2**: Enable by default, monitor metrics
3. **Phase 3**: Add adaptive timeouts
4. **Phase 4**: Add per-relay filters (optional consumer adoption)

---

## Success Metrics

- **Response time**: Measure time from REQ to first event
- **Coverage**: Measure % of expected events received
- **Connection count**: Measure average relays connected per query
- **Cache hit rate**: Track scoreboard lookups vs. new relays

---

*Created: 2024-12-24*
*Status: Planning*
