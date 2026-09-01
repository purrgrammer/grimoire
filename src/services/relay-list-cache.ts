/**
 * Relay List Cache Service
 *
 * Caches NIP-65 relay lists (kind:10002) in Dexie for fast access.
 * Reduces network requests and improves cold start performance.
 *
 * Auto-caches kind:10002 events from EventStore when subscribed.
 */

import type { NostrEvent } from "@/types/nostr";
import { getInboxes, getOutboxes } from "applesauce-core/helpers";
import { normalizeRelayURL } from "@/lib/relay-url";
import db, { CachedRelayList } from "./db";
import type { IEventStore } from "applesauce-core/event-store";
import type { Subscription } from "rxjs";

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
/**
 * LRU size, in pubkeys.
 *
 * Sized against a follow list, because that is what fills it: resolving one
 * puts a relay list in the store for every person followed, and a 100-entry
 * cache measured 425 relay lists against it in a single session — so the entry
 * for any given profile had almost always been evicted by the time anything
 * asked for it. An entry is one kind-10002 event plus two small arrays, so a
 * thousand of them is a couple of megabytes.
 *
 * This is a latency knob, not a correctness one: `loaders.ts` reads the
 * EventStore when the cache misses, and the async accessors fall through to
 * Dexie. Raising it only saves those lookups.
 */
const MAX_MEMORY_CACHE = 1000;

class RelayListCache {
  private eventStoreSubscription: Subscription | null = null;
  private memoryCache = new Map<string, CachedRelayList>();
  private cacheOrder: string[] = [];

  /**
   * Subscribe to EventStore to auto-cache kind:10002 events
   */
  subscribeToEventStore(eventStore: IEventStore): void {
    if (this.eventStoreSubscription) {
      console.warn("[RelayListCache] Already subscribed to EventStore");
      return;
    }

    // Subscribe to kind:10002 events
    this.eventStoreSubscription = eventStore
      .filters({ kinds: [10002] })
      .subscribe((event: NostrEvent) => {
        // Cache each kind:10002 event as it arrives
        this.set(event);
      });
  }

  /**
   * Unsubscribe from EventStore
   */
  unsubscribe(): void {
    if (this.eventStoreSubscription) {
      this.eventStoreSubscription.unsubscribe();
      this.eventStoreSubscription = null;
    }
  }

  /**
   * Get cached relay list for a pubkey
   * Returns undefined if not cached or stale
   */
  async get(pubkey: string): Promise<CachedRelayList | undefined> {
    try {
      const cached = await db.relayLists.get(pubkey);

      // Check if stale (>24 hours)
      if (cached && Date.now() - cached.updatedAt < CACHE_TTL) {
        return cached;
      }

      // Stale or not found
      if (cached) {
        console.debug(
          `[RelayListCache] Cached relay list for ${pubkey.slice(0, 8)} is stale (${Math.floor((Date.now() - cached.updatedAt) / 1000 / 60)}min old)`,
        );
      }

      return undefined;
    } catch (error) {
      console.error(
        `[RelayListCache] Error reading cache for ${pubkey.slice(0, 8)}:`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Store relay list event in cache
   */
  async set(event: NostrEvent): Promise<void> {
    try {
      if (event.kind !== 10002) {
        console.warn(
          `[RelayListCache] Attempted to cache non-10002 event (kind ${event.kind})`,
        );
        return;
      }

      // Parse relays from event
      const readRelays = getInboxes(event);
      const writeRelays = getOutboxes(event);

      // Normalize URLs and filter invalid ones
      const normalizedRead = readRelays
        .map((url) => {
          try {
            return normalizeRelayURL(url);
          } catch {
            console.warn(`[RelayListCache] Invalid read relay URL: ${url}`);
            return null;
          }
        })
        .filter((url): url is string => url !== null);

      const normalizedWrite = writeRelays
        .map((url) => {
          try {
            return normalizeRelayURL(url);
          } catch {
            console.warn(`[RelayListCache] Invalid write relay URL: ${url}`);
            return null;
          }
        })
        .filter((url): url is string => url !== null);

      // Store in Dexie and memory cache
      const cachedEntry: CachedRelayList = {
        pubkey: event.pubkey,
        event,
        read: normalizedRead,
        write: normalizedWrite,
        updatedAt: Date.now(),
      };

      // Memory first, then Dexie: the synchronous readers below run on the
      // same tick an event arrives, and awaiting the write before publishing
      // it leaves them a hole to miss through.
      this.memoryCache.set(event.pubkey, cachedEntry);
      // `updateLRU`, not `push` — re-caching a pubkey used to append a second
      // entry, so `cacheOrder` outgrew `memoryCache` and eviction shifted a
      // stale duplicate, dropping a pubkey that was still current.
      this.updateLRU(event.pubkey);
      this.evictOldest();

      await db.relayLists.put(cachedEntry);

      console.debug(
        `[RelayListCache] Cached relay list for ${event.pubkey.slice(0, 8)} (${normalizedWrite.length} write, ${normalizedRead.length} read)`,
      );
    } catch (error) {
      console.error(
        `[RelayListCache] Error caching relay list for ${event.pubkey.slice(0, 8)}:`,
        error,
      );
    }
  }

  /**
   * Update LRU order for a pubkey
   */
  private updateLRU(pubkey: string): void {
    const index = this.cacheOrder.indexOf(pubkey);
    if (index > -1) {
      this.cacheOrder.splice(index, 1);
    }
    this.cacheOrder.push(pubkey);
  }

  /**
   * Evict oldest entries from memory cache if over limit
   */
  private evictOldest(): void {
    while (this.cacheOrder.length > MAX_MEMORY_CACHE) {
      const oldest = this.cacheOrder.shift();
      if (oldest) {
        this.memoryCache.delete(oldest);
      }
    }
  }

  /**
   * Get outbox relays from memory cache only (synchronous, fast)
   * Used for real-time operations where async Dexie lookup would be too slow
   * Returns null if not in memory cache
   */
  getOutboxRelaysSync(pubkey: string): string[] | null {
    const memCached = this.memoryCache.get(pubkey);
    if (memCached && Date.now() - memCached.updatedAt < CACHE_TTL) {
      this.updateLRU(pubkey);
      return memCached.write;
    }
    return null;
  }

  /**
   * Get outbox (write) relays for a pubkey from cache
   */
  async getOutboxRelays(pubkey: string): Promise<string[] | null> {
    // Check memory cache first (< 1ms)
    const memCached = this.memoryCache.get(pubkey);
    if (memCached && Date.now() - memCached.updatedAt < CACHE_TTL) {
      this.updateLRU(pubkey);
      return memCached.write;
    }

    // Then check Dexie (5-10ms)
    const cached = await this.get(pubkey);
    if (cached) {
      // Populate memory cache for next time
      this.memoryCache.set(pubkey, cached);
      this.cacheOrder.push(pubkey);
      this.evictOldest();
      return cached.write;
    }

    return null;
  }

  /**
   * Get inbox (read) relays for a pubkey from cache
   */
  async getInboxRelays(pubkey: string): Promise<string[] | null> {
    // Check memory cache first (< 1ms)
    const memCached = this.memoryCache.get(pubkey);
    if (memCached && Date.now() - memCached.updatedAt < CACHE_TTL) {
      this.updateLRU(pubkey);
      return memCached.read;
    }

    // Then check Dexie (5-10ms)
    const cached = await this.get(pubkey);
    if (cached) {
      // Populate memory cache for next time
      this.memoryCache.set(pubkey, cached);
      this.cacheOrder.push(pubkey);
      this.evictOldest();
      return cached.read;
    }

    return null;
  }

  /**
   * Check if we have a valid cache entry for a pubkey
   */
  async has(pubkey: string): Promise<boolean> {
    const cached = await this.get(pubkey);
    return cached !== undefined;
  }

  /**
   * Invalidate (delete) cache entry for a pubkey
   */
  async invalidate(pubkey: string): Promise<void> {
    try {
      await db.relayLists.delete(pubkey);
      // Also remove from memory cache
      this.memoryCache.delete(pubkey);
      const index = this.cacheOrder.indexOf(pubkey);
      if (index > -1) {
        this.cacheOrder.splice(index, 1);
      }
      console.debug(
        `[RelayListCache] Invalidated cache for ${pubkey.slice(0, 8)}`,
      );
    } catch (error) {
      console.error(
        `[RelayListCache] Error invalidating cache for ${pubkey.slice(0, 8)}:`,
        error,
      );
    }
  }

  /**
   * Clear all cached relay lists
   */
  async clear(): Promise<void> {
    try {
      await db.relayLists.clear();
      // Also clear memory cache
      this.memoryCache.clear();
      this.cacheOrder = [];
    } catch (error) {
      console.error("[RelayListCache] Error clearing cache:", error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    count: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    memoryCacheSize: number;
    memoryCacheLimit: number;
  }> {
    try {
      const count = await db.relayLists.count();
      const all = await db.relayLists.toArray();

      if (all.length === 0) {
        return {
          count: 0,
          oldestEntry: null,
          newestEntry: null,
          memoryCacheSize: this.memoryCache.size,
          memoryCacheLimit: MAX_MEMORY_CACHE,
        };
      }

      const timestamps = all.map((entry) => entry.updatedAt);
      const oldest = Math.min(...timestamps);
      const newest = Math.max(...timestamps);

      return {
        count,
        oldestEntry: oldest,
        newestEntry: newest,
        memoryCacheSize: this.memoryCache.size,
        memoryCacheLimit: MAX_MEMORY_CACHE,
      };
    } catch (error) {
      console.error("[RelayListCache] Error getting stats:", error);
      return {
        count: 0,
        oldestEntry: null,
        newestEntry: null,
        memoryCacheSize: this.memoryCache.size,
        memoryCacheLimit: MAX_MEMORY_CACHE,
      };
    }
  }
}

// Singleton instance
export const relayListCache = new RelayListCache();
export default relayListCache;
