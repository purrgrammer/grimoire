/**
 * Blossom Server Cache Service
 *
 * Caches BUD-03 blossom server lists (kind:10063) in Dexie for fast access.
 * Reduces network requests and improves cold start performance.
 *
 * Auto-caches kind:10063 events from EventStore when subscribed.
 */

import type { NostrEvent } from "@/types/nostr";
import { getServersFromEvent } from "./blossom";
import db, { CachedBlossomServerList } from "./db";
import type { IEventStore } from "applesauce-core/event-store";
import type { Subscription } from "rxjs";

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_MEMORY_CACHE = 100; // LRU cache size

class BlossomServerCache {
  private eventStoreSubscription: Subscription | null = null;
  private memoryCache = new Map<string, CachedBlossomServerList>();
  private cacheOrder: string[] = [];

  /**
   * Subscribe to EventStore to auto-cache kind:10063 events
   */
  subscribeToEventStore(eventStore: IEventStore): void {
    if (this.eventStoreSubscription) {
      console.warn("[BlossomServerCache] Already subscribed to EventStore");
      return;
    }

    // Subscribe to kind:10063 events
    this.eventStoreSubscription = eventStore
      .filters({ kinds: [10063] })
      .subscribe((event: NostrEvent) => {
        // Cache each kind:10063 event as it arrives
        this.set(event);
      });

    console.log(
      "[BlossomServerCache] Subscribed to EventStore for kind:10063 events",
    );
  }

  /**
   * Unsubscribe from EventStore
   */
  unsubscribe(): void {
    if (this.eventStoreSubscription) {
      this.eventStoreSubscription.unsubscribe();
      this.eventStoreSubscription = null;
      console.log("[BlossomServerCache] Unsubscribed from EventStore");
    }
  }

  /**
   * Get cached blossom server list for a pubkey
   * Returns undefined if not cached or stale
   */
  async get(pubkey: string): Promise<CachedBlossomServerList | undefined> {
    try {
      const cached = await db.blossomServers.get(pubkey);

      // Check if stale (>24 hours)
      if (cached && Date.now() - cached.updatedAt < CACHE_TTL) {
        return cached;
      }

      // Stale or not found
      if (cached) {
        console.debug(
          `[BlossomServerCache] Cached server list for ${pubkey.slice(0, 8)} is stale (${Math.floor((Date.now() - cached.updatedAt) / 1000 / 60)}min old)`,
        );
      }

      return undefined;
    } catch (error) {
      console.error(
        `[BlossomServerCache] Error reading cache for ${pubkey.slice(0, 8)}:`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Store blossom server list event in cache
   */
  async set(event: NostrEvent): Promise<void> {
    try {
      if (event.kind !== 10063) {
        console.warn(
          `[BlossomServerCache] Attempted to cache non-10063 event (kind ${event.kind})`,
        );
        return;
      }

      // Parse servers from event
      const servers = getServersFromEvent(event);

      // Store in Dexie and memory cache
      const cachedEntry: CachedBlossomServerList = {
        pubkey: event.pubkey,
        event,
        servers,
        updatedAt: Date.now(),
      };

      await db.blossomServers.put(cachedEntry);

      // Also populate memory cache
      this.memoryCache.set(event.pubkey, cachedEntry);
      this.cacheOrder.push(event.pubkey);
      this.evictOldest();

      console.debug(
        `[BlossomServerCache] Cached ${servers.length} server(s) for ${event.pubkey.slice(0, 8)}`,
      );
    } catch (error) {
      console.error(
        `[BlossomServerCache] Error caching server list for ${event.pubkey.slice(0, 8)}:`,
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
   * Get blossom servers from memory cache only (synchronous, fast)
   * Used for real-time operations where async Dexie lookup would be too slow
   * Returns null if not in memory cache
   */
  getServersSync(pubkey: string): string[] | null {
    const memCached = this.memoryCache.get(pubkey);
    if (memCached && Date.now() - memCached.updatedAt < CACHE_TTL) {
      this.updateLRU(pubkey);
      return memCached.servers;
    }
    return null;
  }

  /**
   * Get blossom servers for a pubkey from cache
   */
  async getServers(pubkey: string): Promise<string[] | null> {
    // Check memory cache first (< 1ms)
    const memCached = this.memoryCache.get(pubkey);
    if (memCached && Date.now() - memCached.updatedAt < CACHE_TTL) {
      this.updateLRU(pubkey);
      return memCached.servers;
    }

    // Then check Dexie (5-10ms)
    const cached = await this.get(pubkey);
    if (cached) {
      // Populate memory cache for next time
      this.memoryCache.set(pubkey, cached);
      this.cacheOrder.push(pubkey);
      this.evictOldest();
      return cached.servers;
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
      await db.blossomServers.delete(pubkey);
      // Also remove from memory cache
      this.memoryCache.delete(pubkey);
      const index = this.cacheOrder.indexOf(pubkey);
      if (index > -1) {
        this.cacheOrder.splice(index, 1);
      }
      console.debug(
        `[BlossomServerCache] Invalidated cache for ${pubkey.slice(0, 8)}`,
      );
    } catch (error) {
      console.error(
        `[BlossomServerCache] Error invalidating cache for ${pubkey.slice(0, 8)}:`,
        error,
      );
    }
  }

  /**
   * Clear all cached blossom server lists
   */
  async clear(): Promise<void> {
    try {
      await db.blossomServers.clear();
      // Also clear memory cache
      this.memoryCache.clear();
      this.cacheOrder = [];
      console.log("[BlossomServerCache] Cleared all cached server lists");
    } catch (error) {
      console.error("[BlossomServerCache] Error clearing cache:", error);
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
      const count = await db.blossomServers.count();
      const all = await db.blossomServers.toArray();

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
      console.error("[BlossomServerCache] Error getting stats:", error);
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
export const blossomServerCache = new BlossomServerCache();
export default blossomServerCache;
