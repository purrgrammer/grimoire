/**
 * Relay List Cache Service
 *
 * Caches relay lists in Dexie for fast access:
 * - NIP-65 relay lists (kind 10002) - outbox/inbox relays
 * - NIP-17 inbox relays (kind 10050) - private DM inbox relays
 *
 * Reduces network requests and improves cold start performance.
 *
 * Auto-caches kind 10002 and 10050 events from EventStore when subscribed.
 */

import type { NostrEvent } from "@/types/nostr";
import { getInboxes, getOutboxes } from "applesauce-core/helpers";
import { normalizeRelayURL } from "@/lib/relay-url";
import db, { CachedRelayList } from "./db";
import type { IEventStore } from "applesauce-core/event-store";
import type { Subscription } from "rxjs";
import { merge } from "rxjs";

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_MEMORY_CACHE = 100; // LRU cache size
const DM_RELAY_LIST_KIND = 10050; // NIP-17 DM inbox relays

/**
 * Parse inbox relay URLs from kind 10050 event
 * Tags are in format: ["relay", "wss://relay.example.com"]
 */
function parseInboxRelays(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === "relay" && tag[1])
    .map((tag) => tag[1]);
}

class RelayListCache {
  private eventStoreSubscription: Subscription | null = null;
  private memoryCache = new Map<string, CachedRelayList>();
  private cacheOrder: string[] = [];

  /**
   * Subscribe to EventStore to auto-cache kind 10002 and 10050 events
   */
  subscribeToEventStore(eventStore: IEventStore): void {
    if (this.eventStoreSubscription) {
      console.warn("[RelayListCache] Already subscribed to EventStore");
      return;
    }

    // Subscribe to both kind 10002 (NIP-65) and kind 10050 (NIP-17 inbox)
    this.eventStoreSubscription = merge(
      eventStore.filters({ kinds: [10002] }),
      eventStore.filters({ kinds: [DM_RELAY_LIST_KIND] }),
    ).subscribe((event: NostrEvent) => {
      // Cache each relay list event as it arrives
      this.set(event);
    });

    console.log(
      "[RelayListCache] Subscribed to EventStore for kind 10002 and 10050 events",
    );
  }

  /**
   * Unsubscribe from EventStore
   */
  unsubscribe(): void {
    if (this.eventStoreSubscription) {
      this.eventStoreSubscription.unsubscribe();
      this.eventStoreSubscription = null;
      console.log("[RelayListCache] Unsubscribed from EventStore");
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
   * Handles both kind 10002 (NIP-65) and kind 10050 (NIP-17 inbox)
   */
  async set(event: NostrEvent): Promise<void> {
    try {
      if (event.kind !== 10002 && event.kind !== DM_RELAY_LIST_KIND) {
        console.warn(
          `[RelayListCache] Attempted to cache invalid event kind ${event.kind}`,
        );
        return;
      }

      // Get existing cache entry (if any) to merge with
      const existing = await db.relayLists.get(event.pubkey);

      let normalizedRead: string[] = existing?.read || [];
      let normalizedWrite: string[] = existing?.write || [];
      let normalizedInbox: string[] | undefined = existing?.inbox;

      if (event.kind === 10002) {
        // Parse NIP-65 relay list (outbox/inbox)
        const readRelays = getInboxes(event);
        const writeRelays = getOutboxes(event);

        normalizedRead = readRelays
          .map((url) => {
            try {
              return normalizeRelayURL(url);
            } catch {
              console.warn(`[RelayListCache] Invalid read relay URL: ${url}`);
              return null;
            }
          })
          .filter((url): url is string => url !== null);

        normalizedWrite = writeRelays
          .map((url) => {
            try {
              return normalizeRelayURL(url);
            } catch {
              console.warn(`[RelayListCache] Invalid write relay URL: ${url}`);
              return null;
            }
          })
          .filter((url): url is string => url !== null);
      } else if (event.kind === DM_RELAY_LIST_KIND) {
        // Parse NIP-17 inbox relays (kind 10050)
        const inboxRelays = parseInboxRelays(event);

        normalizedInbox = inboxRelays
          .map((url) => {
            try {
              return normalizeRelayURL(url);
            } catch {
              console.warn(`[RelayListCache] Invalid inbox relay URL: ${url}`);
              return null;
            }
          })
          .filter((url): url is string => url !== null);
      }

      // Store in Dexie and memory cache
      const cachedEntry: CachedRelayList = {
        pubkey: event.pubkey,
        event,
        read: normalizedRead,
        write: normalizedWrite,
        inbox: normalizedInbox,
        updatedAt: Date.now(),
      };

      await db.relayLists.put(cachedEntry);

      // Also populate memory cache
      this.memoryCache.set(event.pubkey, cachedEntry);
      this.cacheOrder.push(event.pubkey);
      this.evictOldest();

      const logParts = [`${event.pubkey.slice(0, 8)}`];
      if (normalizedWrite.length > 0)
        logParts.push(`${normalizedWrite.length} write`);
      if (normalizedRead.length > 0)
        logParts.push(`${normalizedRead.length} read`);
      if (normalizedInbox && normalizedInbox.length > 0)
        logParts.push(`${normalizedInbox.length} inbox`);

      console.debug(
        `[RelayListCache] Cached relay list for ${logParts.join(", ")}`,
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
      console.log("[RelayListCache] Cleared all cached relay lists");
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
