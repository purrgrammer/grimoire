# Outbox Relay Selection: Future Work

These improvements are lower priority and saved for future implementation after the core scoring and optimization work is complete.

---

## 5. Progressive Relay Selection

### Problem
Currently, relay selection waits for all relay list fetches before returning results. Users wait for the full timeout even when cached data is available.

### Proposed Solution

Return results in phases:
1. **Phase 1 (0-10ms)**: Return relays from memory cache immediately
2. **Phase 2 (10-100ms)**: Add relays from Dexie cache
3. **Phase 3 (100-1000ms)**: Add relays from network fetches

```typescript
export async function selectRelaysIncremental(
  eventStore: IEventStore,
  filter: NostrFilter,
  options?: RelaySelectionOptions,
  onUpdate?: (partial: RelaySelectionResult) => void
): Promise<RelaySelectionResult> {
  const authors = filter.authors || [];

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
    const subscription = eventStore
      .query({ kinds: [10002], authors: uncachedAuthors })
      .subscribe((event) => {
        relayListCache.set(event);
        if (onUpdate) {
          selectRelaysForFilter(eventStore, filter, options).then(onUpdate);
        }
      });

    await new Promise(resolve =>
      setTimeout(resolve, options?.timeout || 1000)
    );
    subscription.unsubscribe();
  }

  // Phase 3: Final selection
  return selectRelaysForFilter(eventStore, filter, options);
}
```

### Hook Integration

```typescript
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
    selectRelaysIncremental(eventStore, filter, options, setResult);
  }, [filter, options]);

  return result;
}
```

### Expected Impact
- Show initial results within 10-50ms (cached relays)
- Progressive enhancement as more relay lists arrive
- Better perceived performance

### Effort: Medium
### Priority: Lower (current streaming approach already shows results as they arrive)

---

## 6. NIP-66 Relay Discovery

### Problem
Grimoire uses a fixed set of fallback/aggregator relays. New relays are never discovered automatically.

### NIP-66 Overview
NIP-66 defines relay discovery via monitor relays that publish relay metadata:
- Kind 30166: Relay metadata (NIPs supported, network, country)
- Monitor relays: `wss://relay.nostr.watch`, `wss://monitorlizard.nostr1.com`

### Proposed Implementation

```typescript
// src/services/relay-discovery.ts

class RelayDiscoveryService {
  private discoveryRelays = [
    "wss://relay.nostr.watch/",
    "wss://monitorlizard.nostr1.com/",
  ];

  private relayCache = new Map<string, RelayMetadata>();
  private cacheExpiry = 60 * 60 * 1000; // 1 hour

  /**
   * Discover relays by supported NIPs
   */
  async getRelaysByNIPs(nips: number[]): Promise<string[]> {
    await this.ensureCacheLoaded();

    return Array.from(this.relayCache.entries())
      .filter(([_, meta]) =>
        nips.every(nip => meta.supportedNips.includes(nip))
      )
      .map(([url]) => url);
  }

  /**
   * Discover relays by country
   */
  async getRelaysByCountry(countryCode: string): Promise<string[]> {
    await this.ensureCacheLoaded();

    return Array.from(this.relayCache.entries())
      .filter(([_, meta]) => meta.countryCode === countryCode)
      .map(([url]) => url);
  }

  /**
   * Get online relays (recently seen active)
   */
  async getOnlineRelays(): Promise<string[]> {
    await this.ensureCacheLoaded();

    const now = Date.now();
    const recentThreshold = 5 * 60 * 1000; // 5 minutes

    return Array.from(this.relayCache.entries())
      .filter(([_, meta]) => now - meta.lastSeen < recentThreshold)
      .map(([url]) => url);
  }

  /**
   * Fetch relay metadata from monitor relays
   */
  private async fetchRelayMetadata(): Promise<void> {
    const filter = { kinds: [30166], limit: 500 };

    for (const monitorRelay of this.discoveryRelays) {
      try {
        const events = await pool.querySync([monitorRelay], filter);

        for (const event of events) {
          const url = getTagValue(event, "d");
          if (!url) continue;

          const metadata: RelayMetadata = {
            url: normalizeRelayURL(url),
            supportedNips: parseNipTags(event),
            network: getTagValue(event, "n") || "clearnet",
            countryCode: getTagValue(event, "l"),
            lastSeen: event.created_at * 1000,
          };

          this.relayCache.set(metadata.url, metadata);
        }
      } catch (error) {
        console.warn(`[RelayDiscovery] Failed to fetch from ${monitorRelay}:`, error);
      }
    }
  }
}

interface RelayMetadata {
  url: string;
  supportedNips: number[];
  network: "clearnet" | "tor" | "i2p";
  countryCode?: string;
  lastSeen: number;
}
```

### Use Cases

1. **Dynamic fallbacks**: Instead of hardcoded aggregators, discover relays that support NIP-50 (search)
2. **Geographic optimization**: Prefer relays in user's region for lower latency
3. **Feature detection**: Find relays supporting specific NIPs for advanced queries

### Integration with Relay Selection

```typescript
// In relay-selection.ts
async function selectRelaysForFilter(...) {
  // If all users have no relay lists, try NIP-66 discovery
  if (fallbackCount === allPointers.length) {
    const discoveredRelays = await relayDiscovery.getOnlineRelays();
    if (discoveredRelays.length > 0) {
      return {
        relays: discoveredRelays.slice(0, 10),
        reasoning: discoveredRelays.slice(0, 10).map(relay => ({
          relay,
          writers: [],
          readers: [],
          isFallback: true,
          isDiscovered: true, // New field
        })),
        isOptimized: false,
      };
    }
  }
}
```

### Expected Impact
- Better fallback relay selection
- Automatic discovery of new relays
- Geographic optimization potential

### Effort: High
### Priority: Low (current fallback aggregators work well)

---

## When to Implement

### Progressive Relay Selection (#5)
Implement when:
- Users report slow initial load times
- Cache hit rates are low
- There's demand for faster perceived performance

### NIP-66 Relay Discovery (#6)
Implement when:
- Fallback aggregators become unreliable
- Users want geographic relay preferences
- There's a need for automatic relay discovery

---

*Created: 2024-12-24*
*Status: Backlog*
