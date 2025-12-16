# NIP-65 Outbox Implementation: Future Improvements

This document outlines performance and UX improvements identified during the deep review of the outbox implementation. The "quick wins" (single author special case, in-memory LRU cache, relay selection progress indicator) have been implemented. These are the remaining optimizations for future consideration.

---

## 1. Request Deduplication

**Problem**: Multiple simultaneous queries for the same relay list create redundant network requests.

**Current Behavior**:
```typescript
// If 3 components request same relay list simultaneously:
async function fetchRelayList(pubkey: string) {
  return await fetch(`wss://relay/kind:10002/${pubkey}`);
}

// Result: 3 identical network requests
```

**Proposed Solution**:
```typescript
// Map of in-flight promises to prevent redundant fetches
private inFlightRequests = new Map<string, Promise<NostrEvent | null>>();

async fetchRelayList(pubkey: string): Promise<NostrEvent | null> {
  // Check if request already in flight
  const existing = this.inFlightRequests.get(pubkey);
  if (existing) {
    console.debug(`[RelayListCache] Deduplicating request for ${pubkey.slice(0, 8)}`);
    return existing;
  }

  // Create new promise and store it
  const promise = this.fetchFromNetwork(pubkey);
  this.inFlightRequests.set(pubkey, promise);

  // Clean up when done
  promise.finally(() => {
    this.inFlightRequests.delete(pubkey);
  });

  return promise;
}
```

**Expected Impact**:
- Reduce redundant network requests by ~60-80%
- Lower bandwidth usage and relay load
- Faster response times when multiple components need same data

**Implementation Location**: `src/services/relay-list-cache.ts`

---

## 2. Performance Metrics Collection

**Problem**: No telemetry to track cache hit rates, timing, or degradation patterns in production.

**Proposed Solution**:
```typescript
// In src/services/relay-list-cache.ts
interface PerformanceMetrics {
  memoryHits: number;
  dexieHits: number;
  networkFetches: number;
  totalRequests: number;
  avgMemoryTime: number;
  avgDexieTime: number;
  avgNetworkTime: number;
  lastReset: number;
}

class RelayListCache {
  private metrics: PerformanceMetrics = {
    memoryHits: 0,
    dexieHits: 0,
    networkFetches: 0,
    totalRequests: 0,
    avgMemoryTime: 0,
    avgDexieTime: 0,
    avgNetworkTime: 0,
    lastReset: Date.now(),
  };

  async getOutboxRelays(pubkey: string): Promise<string[] | null> {
    const start = performance.now();
    this.metrics.totalRequests++;

    // Check memory cache
    const memCached = this.memoryCache.get(pubkey);
    if (memCached && Date.now() - memCached.updatedAt < CACHE_TTL) {
      this.metrics.memoryHits++;
      this.updateAvgTime('memory', performance.now() - start);
      return memCached.write;
    }

    // Check Dexie
    const cached = await this.get(pubkey);
    if (cached) {
      this.metrics.dexieHits++;
      this.updateAvgTime('dexie', performance.now() - start);
      return cached.write;
    }

    // Network fetch
    this.metrics.networkFetches++;
    this.updateAvgTime('network', performance.now() - start);
    return null;
  }

  getMetrics(): PerformanceMetrics & {
    memoryCacheHitRate: number;
    dexieCacheHitRate: number;
    overallCacheHitRate: number;
  } {
    const total = this.metrics.totalRequests;
    return {
      ...this.metrics,
      memoryCacheHitRate: total > 0 ? this.metrics.memoryHits / total : 0,
      dexieCacheHitRate: total > 0 ? this.metrics.dexieHits / total : 0,
      overallCacheHitRate: total > 0
        ? (this.metrics.memoryHits + this.metrics.dexieHits) / total
        : 0,
    };
  }
}
```

**Expected Impact**:
- Visibility into cache effectiveness
- Data-driven optimization decisions
- Production performance monitoring
- Identify degradation patterns early

**Implementation Location**: `src/services/relay-list-cache.ts`

---

## 3. Fallback Warning System

**Problem**: Users don't know when their queries fall back to aggregator relays, causing confusion about incomplete results.

**Current Behavior**: Silent fallback with only console.debug logs

**Proposed Solution**:
```typescript
// In src/services/relay-selection.ts
interface RelaySelectionResult {
  relays: string[];
  reasoning: RelaySelectionReasoning[];
  isOptimized: boolean;
  fallbacksUsed?: {
    pubkey: string;
    reason: 'no-relay-list' | 'timeout' | 'invalid-list';
  }[];
}

// In selectRelaysForFilter:
if (!cachedRelayList) {
  console.warn(`[RelaySelection] No relay list for ${pubkey.slice(0, 8)}, using fallback`);

  result.fallbacksUsed = result.fallbacksUsed || [];
  result.fallbacksUsed.push({
    pubkey,
    reason: 'no-relay-list'
  });
}
```

**UI Component** (`src/components/ReqViewer.tsx`):
```tsx
{reasoning && reasoning.some(r => r.isFallback) && (
  <div className="flex items-center gap-2 text-yellow-600 text-sm mt-2">
    <AlertTriangle className="size-4" />
    <span>
      Using fallback relays for {reasoning.filter(r => r.isFallback).length} users
      (relay lists unavailable)
    </span>
  </div>
)}
```

**Expected Impact**:
- Users understand why results may be incomplete
- Encourages fixing relay list issues
- Better debugging experience
- Transparency about query execution

**Implementation Locations**:
- `src/services/relay-selection.ts`
- `src/components/ReqViewer.tsx`

---

## 4. Speculative Prefetching

**Problem**: Cold start delays occur frequently because relay lists aren't cached until needed.

**Proposed Solution**:
```typescript
// In src/services/relay-list-cache.ts
class RelayListCache {
  /**
   * Prefetch relay lists for a set of pubkeys in the background
   * Useful for warming cache with user's follows
   */
  async prefetch(pubkeys: string[]): Promise<void> {
    console.log(`[RelayListCache] Prefetching ${pubkeys.length} relay lists`);

    // Filter out already cached
    const uncached = await Promise.all(
      pubkeys.map(async (pubkey) => {
        const has = await this.has(pubkey);
        return has ? null : pubkey;
      })
    );

    const toPrefetch = uncached.filter((p): p is string => p !== null);

    if (toPrefetch.length === 0) {
      console.debug('[RelayListCache] All relay lists already cached');
      return;
    }

    // Fetch in background (don't await - fire and forget)
    const eventStore = getEventStore();
    eventStore.query({ kinds: [10002], authors: toPrefetch });
  }
}

// Hook for automatic prefetching
// In src/hooks/usePrefetchRelayLists.ts
export function usePrefetchRelayLists() {
  const profile = useCurrentProfile();

  useEffect(() => {
    if (!profile) return;

    // Get user's follows from contact list (kind 3)
    const contacts = profile.tags
      .filter(tag => tag[0] === 'p')
      .map(tag => tag[1]);

    if (contacts.length > 0) {
      console.log(`[Prefetch] Warming cache with ${contacts.length} follows`);
      relayListCache.prefetch(contacts.slice(0, 50)); // Limit to top 50
    }
  }, [profile]);
}
```

**Integration**: Call `usePrefetchRelayLists()` in App.tsx or after login

**Expected Impact**:
- Reduce cold start delays by ~80% for common queries
- Better UX for new users
- Proactive cache warming
- Minimal bandwidth cost (background fetch)

**Implementation Locations**:
- `src/services/relay-list-cache.ts`
- `src/hooks/usePrefetchRelayLists.ts`

---

## 5. Adaptive Timeout

**Problem**: Fixed 1000ms timeout is too long for consistently slow relays but may be too short for slow networks.

**Proposed Solution**:
```typescript
// In src/services/relay-selection.ts
interface RelayHealthMetrics {
  avgResponseTime: number;
  successRate: number;
  lastSuccess: number;
  failureCount: number;
}

class RelayHealthTracker {
  private metrics = new Map<string, RelayHealthMetrics>();

  recordSuccess(pubkey: string, responseTime: number) {
    const existing = this.metrics.get(pubkey) || {
      avgResponseTime: 0,
      successRate: 1,
      lastSuccess: Date.now(),
      failureCount: 0,
    };

    // Exponential moving average
    existing.avgResponseTime =
      0.7 * existing.avgResponseTime + 0.3 * responseTime;
    existing.successRate =
      0.9 * existing.successRate + 0.1 * 1;
    existing.lastSuccess = Date.now();

    this.metrics.set(pubkey, existing);
  }

  recordFailure(pubkey: string) {
    const existing = this.metrics.get(pubkey) || {
      avgResponseTime: 1000,
      successRate: 0,
      lastSuccess: 0,
      failureCount: 0,
    };

    existing.successRate = 0.9 * existing.successRate + 0.1 * 0;
    existing.failureCount++;

    this.metrics.set(pubkey, existing);
  }

  getTimeout(pubkey: string): number {
    const metrics = this.metrics.get(pubkey);
    if (!metrics) return 1000; // Default

    // Adaptive: 2x average response time, minimum 300ms, maximum 2000ms
    const adaptive = Math.max(300, Math.min(2000, metrics.avgResponseTime * 2));

    // Reduce timeout for consistently slow relays
    if (metrics.avgResponseTime > 800 && metrics.successRate < 0.5) {
      return Math.min(500, adaptive);
    }

    return adaptive;
  }
}
```

**Expected Impact**:
- Faster queries for reliable relays (300-500ms vs 1000ms)
- Reduce wasted time on slow relays
- Better resource utilization
- Adaptive to network conditions

**Implementation Location**: `src/services/relay-selection.ts`

---

## 6. Incremental Relay Selection

**Problem**: Users wait for all relay lists before seeing any results, even if some are cached.

**Proposed Solution**:
```typescript
// In src/services/relay-selection.ts
export async function selectRelaysIncremental(
  eventStore: IEventStore,
  filter: NostrFilter,
  options?: RelaySelectionOptions,
  onUpdate?: (partial: RelaySelectionResult) => void
): Promise<RelaySelectionResult> {
  const authors = filter.authors || [];
  const pTags = filter["#p"] || [];

  // Phase 1: Return cached relays immediately
  const cachedPointers = await Promise.all(
    authors.map(async (pubkey) => {
      const cached = await relayListCache.getOutboxRelays(pubkey);
      return cached ? { pubkey, relays: cached } : null;
    })
  );

  const initialRelays = cachedPointers
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .flatMap(p => p.relays);

  if (initialRelays.length > 0 && onUpdate) {
    onUpdate({
      relays: initialRelays,
      reasoning: [],
      isOptimized: true,
    });
  }

  // Phase 2: Fetch missing relay lists
  const uncachedAuthors = authors.filter((_, i) => !cachedPointers[i]);

  if (uncachedAuthors.length > 0) {
    // Fetch and update as they arrive
    const subscription = eventStore
      .query({ kinds: [10002], authors: uncachedAuthors })
      .subscribe((event) => {
        relayListCache.set(event);

        // Trigger incremental update
        if (onUpdate) {
          selectRelaysForFilter(eventStore, filter, options)
            .then(onUpdate);
        }
      });

    // Wait for timeout, then complete
    await new Promise(resolve =>
      setTimeout(resolve, options?.timeout || 1000)
    );
    subscription.unsubscribe();
  }

  // Phase 3: Final selection
  return selectRelaysForFilter(eventStore, filter, options);
}
```

**Hook Integration**:
```typescript
// In src/hooks/useOutboxRelays.ts
export function useOutboxRelaysIncremental(
  filter: NostrFilter,
  options?: RelaySelectionOptions
) {
  const [result, setResult] = useState<RelaySelectionResult>({
    relays: options?.fallbackRelays || [],
    reasoning: [],
    isOptimized: false,
  });

  useEffect(() => {
    selectRelaysIncremental(
      eventStore,
      filter,
      options,
      setResult // Update as relay lists arrive
    );
  }, [filter, options]);

  return result;
}
```

**Expected Impact**:
- Show initial results within 10-50ms (cached relays)
- Progressive enhancement as more relay lists arrive
- Better perceived performance
- Users can start seeing events immediately

**Implementation Locations**:
- `src/services/relay-selection.ts`
- `src/hooks/useOutboxRelays.ts`

---

## 7. Cache Warming UI

**Problem**: Users have no way to manually refresh stale relay lists or warm the cache proactively.

**Proposed Solution**:
```tsx
// In src/components/settings/RelayListSettings.tsx
export function RelayListSettings() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    relayListCache.getStats().then(setStats);
  }, []);

  const handleRefreshAll = async () => {
    setRefreshing(true);

    // Clear cache
    await relayListCache.clear();

    // Prefetch follows
    const profile = await getCurrentProfile();
    if (profile) {
      const follows = getFollows(profile);
      await relayListCache.prefetch(follows.slice(0, 100));
    }

    setRefreshing(false);

    // Update stats
    const newStats = await relayListCache.getStats();
    setStats(newStats);
  };

  const handleRefreshStale = async () => {
    // Only refresh entries older than 12 hours
    const allEntries = await db.relayLists.toArray();
    const stale = allEntries
      .filter(entry => Date.now() - entry.updatedAt > 12 * 60 * 60 * 1000)
      .map(entry => entry.pubkey);

    if (stale.length > 0) {
      await relayListCache.prefetch(stale);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Relay List Cache</h3>

      {stats && (
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Cached Users</div>
            <div className="text-2xl font-bold">{stats.count}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Memory Cache</div>
            <div className="text-2xl font-bold">
              {stats.memoryCacheSize} / {stats.memoryCacheLimit}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleRefreshAll}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh All"}
        </Button>
        <Button
          onClick={handleRefreshStale}
          variant="outline"
        >
          Refresh Stale Only
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Cache entries expire after 24 hours. Refresh to get latest relay lists.
      </p>
    </div>
  );
}
```

**Expected Impact**:
- User control over cache freshness
- Manual warming for important follows
- Visibility into cache state
- Proactive performance management

**Implementation Location**: `src/components/settings/RelayListSettings.tsx`

---

## 8. Diagnostic Panel

**Problem**: When queries fail or perform poorly, users and developers have no visibility into relay selection reasoning.

**Proposed Solution**:
```tsx
// In src/components/ReqViewer.tsx
interface RelayDiagnosticsProps {
  reasoning: RelaySelectionReasoning[];
  isOptimized: boolean;
  phase: RelaySelectionPhase;
}

function RelayDiagnostics({ reasoning, isOptimized, phase }: RelayDiagnosticsProps) {
  const [expanded, setExpanded] = useState(false);

  const metrics = relayListCache.getMetrics();

  return (
    <div className="border-t pt-4 mt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold hover:underline"
      >
        <ChevronRight className={`size-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        Relay Selection Diagnostics
      </button>

      {expanded && (
        <div className="mt-4 space-y-4 text-sm">
          {/* Selection Status */}
          <div>
            <div className="font-semibold">Selection Status</div>
            <div className="text-muted-foreground">
              Phase: {phase} • Optimized: {isOptimized ? 'Yes' : 'No (using fallbacks)'}
            </div>
          </div>

          {/* Cache Performance */}
          <div>
            <div className="font-semibold">Cache Performance</div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div>
                <div className="text-muted-foreground text-xs">Memory Hits</div>
                <div className="font-mono">{(metrics.memoryCacheHitRate * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Dexie Hits</div>
                <div className="font-mono">{(metrics.dexieCacheHitRate * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Network Fetches</div>
                <div className="font-mono">{metrics.networkFetches}</div>
              </div>
            </div>
          </div>

          {/* Selected Relays */}
          <div>
            <div className="font-semibold">Selected Relays</div>
            <div className="mt-2 space-y-1">
              {reasoning.map((r, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-xs">
                  <span className={r.isFallback ? 'text-yellow-500' : 'text-green-500'}>
                    {r.isFallback ? '⚠' : '✓'}
                  </span>
                  <span className="truncate">{r.relay}</span>
                  <span className="text-muted-foreground">
                    ({r.writers.length}w {r.readers.length}r)
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Coverage Analysis */}
          <div>
            <div className="font-semibold">Coverage Analysis</div>
            <div className="text-muted-foreground">
              {reasoning.filter(r => !r.isFallback).length} optimized relays,
              {' '}{reasoning.filter(r => r.isFallback).length} fallback relays
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Expected Impact**:
- Visibility into relay selection process
- Easier debugging of query issues
- Performance metrics at a glance
- Educational for understanding NIP-65

**Implementation Location**: `src/components/ReqViewer.tsx`

---

## Priority Recommendations

Based on impact vs. effort analysis:

### High Priority (Implement Next)
1. **Request Deduplication** - Low effort, high impact on redundant queries
2. **Fallback Warning System** - Low effort, significant UX improvement
3. **Performance Metrics Collection** - Medium effort, critical for production monitoring

### Medium Priority
4. **Speculative Prefetching** - Medium effort, large impact for cold start reduction
5. **Diagnostic Panel** - Medium effort, valuable for debugging and transparency

### Lower Priority (Nice to Have)
6. **Adaptive Timeout** - High effort, moderate impact
7. **Incremental Relay Selection** - High effort, moderate UX improvement
8. **Cache Warming UI** - Low effort, but user-initiated edge case

---

## Performance Impact Summary

| Improvement | Expected Gain | Current | Target |
|-------------|---------------|---------|--------|
| Request Deduplication | -60% redundant requests | N/A | N/A |
| Speculative Prefetching | -80% cold start delays | 1040ms | ~200ms |
| Adaptive Timeout | -40% wasted time | 1000ms | 300-500ms |
| Incremental Selection | Perceived perf | 1040ms | 10-50ms first response |
| Performance Metrics | Monitoring | None | Full telemetry |

---

## Testing Recommendations

For each improvement:
1. Add unit tests for core logic
2. Add integration tests for timing/caching behavior
3. Manual testing with slow networks (throttle to 3G)
4. Measure before/after metrics with realistic data
5. Test fallback scenarios (cache miss, timeout, error)

---

*Document created: 2025-01-XX*
*Quick wins implemented: Single author special case, in-memory LRU cache, relay selection progress indicator*
*Future work: These improvements are prioritized but not yet scheduled for implementation*
