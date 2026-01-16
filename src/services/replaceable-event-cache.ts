/**
 * Generic Replaceable Event Cache Service
 *
 * Caches configured replaceable/parameterized events in Dexie for fast access.
 * Stores raw events - parsing happens on-demand using applesauce helpers.
 *
 * Supports:
 * - Normal replaceable events (10000-19999) - one per pubkey+kind
 * - Parameterized replaceable events (30000-39999) - multiple per pubkey+kind (by d-tag)
 * - Contact lists (kind 3) - special case, treated as replaceable
 *
 * Auto-caches events from EventStore when subscribed.
 */

import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers/event";
import { getInboxes, getOutboxes } from "applesauce-core/helpers";
import { normalizeRelayURL } from "@/lib/relay-url";
import { getServersFromEvent } from "./blossom";
import db, { CachedReplaceableEvent } from "./db";
import type { IEventStore } from "applesauce-core/event-store";
import type { Subscription } from "rxjs";

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_MEMORY_CACHE = 200; // LRU cache size

/**
 * Kinds to cache (add more as needed)
 * - 3: Contact list (kind:3, NIP-02)
 * - 10002: Relay list (kind:10002, NIP-65)
 * - 10063: Blossom server list (kind:10063, BUD-03)
 * - 10030: User emoji list (kind:10030, NIP-30)
 */
export const CACHED_KINDS = [3, 10002, 10063, 10030];

/**
 * Kinds to always fetch and keep synced for active user
 * These will be:
 * - Hydrated from cache on startup
 * - Auto-fetched from relays when user logs in
 * - Kept up-to-date via addressLoader subscriptions
 */
export const ACTIVE_USER_KINDS = [
  3, // Contacts - for $contacts alias resolution
  10002, // Relay list - for outbox relay selection
  10063, // Blossom servers - for media uploads
  // 10030,  // Emoji list - optional, uncomment to enable
];

/**
 * Check if a kind is parameterized replaceable (30000-39999)
 */
function isParameterizedReplaceable(kind: number): boolean {
  return kind >= 30000 && kind <= 39999;
}

/**
 * Build cache key for memory cache: "pubkey:kind:d"
 */
function buildCacheKey(pubkey: string, kind: number, d: string = ""): string {
  return `${pubkey}:${kind}:${d}`;
}

class ReplaceableEventCache {
  private eventStoreSubscription: Subscription | null = null;
  private memoryCache = new Map<string, CachedReplaceableEvent>();
  private cacheOrder: string[] = [];
  private ttl: number = DEFAULT_TTL;

  /**
   * Subscribe to EventStore to auto-cache configured kinds
   */
  subscribeToEventStore(eventStore: IEventStore): void {
    if (this.eventStoreSubscription) {
      console.warn("[ReplaceableEventCache] Already subscribed to EventStore");
      return;
    }

    // Subscribe to all configured kinds
    this.eventStoreSubscription = eventStore
      .filters({ kinds: CACHED_KINDS })
      .subscribe((event: NostrEvent) => {
        // Cache each event as it arrives
        this.set(event);
      });

    console.log(
      `[ReplaceableEventCache] Subscribed to EventStore for kinds: ${CACHED_KINDS.join(", ")}`,
    );
  }

  /**
   * Unsubscribe from EventStore
   */
  unsubscribe(): void {
    if (this.eventStoreSubscription) {
      this.eventStoreSubscription.unsubscribe();
      this.eventStoreSubscription = null;
      console.log("[ReplaceableEventCache] Unsubscribed from EventStore");
    }
  }

  /**
   * Hydrate EventStore with fresh cached events on startup
   * Only loads events newer than TTL to avoid stale data
   * This solves the "orphaned cache" problem where Dexie has data but EventStore doesn't
   */
  async hydrateEventStore(eventStore: IEventStore): Promise<void> {
    try {
      const cutoff = Date.now() - this.ttl;

      const fresh = await db.replaceableEvents
        .where("updatedAt")
        .above(cutoff)
        .toArray();

      console.log(
        `[ReplaceableEventCache] Hydrating EventStore with ${fresh.length} cached events`,
      );

      // Add all fresh events to EventStore
      for (const entry of fresh) {
        await eventStore.add(entry.event);

        // Also populate memory cache for fast access
        const cacheKey = buildCacheKey(entry.pubkey, entry.kind, entry.d);
        this.memoryCache.set(cacheKey, entry);
        this.cacheOrder.push(cacheKey);
      }

      // Clean up excess memory cache entries
      this.evictOldest();

      console.log(
        `[ReplaceableEventCache] Hydration complete. Memory cache: ${this.memoryCache.size} entries`,
      );
    } catch (error) {
      console.error(
        "[ReplaceableEventCache] Error hydrating EventStore:",
        error,
      );
    }
  }

  /**
   * Get cached event for a pubkey+kind (and optional d-tag)
   * Returns undefined if not cached or stale
   */
  async get(
    pubkey: string,
    kind: number,
    d: string = "",
  ): Promise<CachedReplaceableEvent | undefined> {
    try {
      const cached = await db.replaceableEvents.get([pubkey, kind, d]);

      // Check if stale
      if (cached && Date.now() - cached.updatedAt < this.ttl) {
        return cached;
      }

      // Stale or not found
      if (cached) {
        const age = Math.floor((Date.now() - cached.updatedAt) / 1000 / 60);
        console.debug(
          `[ReplaceableEventCache] kind:${kind} for ${pubkey.slice(0, 8)}${d ? `/${d}` : ""} is stale (${age}min old)`,
        );
      }

      return undefined;
    } catch (error) {
      console.error(
        `[ReplaceableEventCache] Error reading kind:${kind} for ${pubkey.slice(0, 8)}:`,
        error,
      );
      return undefined;
    }
  }

  /**
   * Store replaceable event in cache
   */
  async set(event: NostrEvent): Promise<void> {
    try {
      if (!CACHED_KINDS.includes(event.kind)) {
        console.warn(
          `[ReplaceableEventCache] Attempted to cache unconfigured kind ${event.kind}`,
        );
        return;
      }

      // Extract d-tag for parameterized replaceable events
      const d = isParameterizedReplaceable(event.kind)
        ? getTagValue(event, "d") || ""
        : "";

      // Store in Dexie and memory cache
      const cachedEntry: CachedReplaceableEvent = {
        pubkey: event.pubkey,
        kind: event.kind,
        d,
        event,
        updatedAt: Date.now(),
      };

      await db.replaceableEvents.put(cachedEntry);

      // Also populate memory cache
      const cacheKey = buildCacheKey(event.pubkey, event.kind, d);
      this.memoryCache.set(cacheKey, cachedEntry);
      this.cacheOrder.push(cacheKey);
      this.evictOldest();

      console.debug(
        `[ReplaceableEventCache] Cached kind:${event.kind} for ${event.pubkey.slice(0, 8)}${d ? `/${d}` : ""}`,
      );
    } catch (error) {
      console.error(
        `[ReplaceableEventCache] Error caching kind:${event.kind} for ${event.pubkey.slice(0, 8)}:`,
        error,
      );
    }
  }

  /**
   * Update LRU order for a cache key
   */
  private updateLRU(cacheKey: string): void {
    const index = this.cacheOrder.indexOf(cacheKey);
    if (index > -1) {
      this.cacheOrder.splice(index, 1);
    }
    this.cacheOrder.push(cacheKey);
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
   * Get event from memory cache only (synchronous, fast)
   * Returns null if not in memory cache or stale
   */
  getSync(pubkey: string, kind: number, d: string = ""): NostrEvent | null {
    const cacheKey = buildCacheKey(pubkey, kind, d);
    const memCached = this.memoryCache.get(cacheKey);

    if (memCached && Date.now() - memCached.updatedAt < this.ttl) {
      this.updateLRU(cacheKey);
      return memCached.event;
    }

    return null;
  }

  /**
   * Get event for a pubkey+kind from cache (async, checks Dexie)
   */
  async getEvent(
    pubkey: string,
    kind: number,
    d: string = "",
  ): Promise<NostrEvent | null> {
    // Check memory cache first (< 1ms)
    const cacheKey = buildCacheKey(pubkey, kind, d);
    const memCached = this.memoryCache.get(cacheKey);

    if (memCached && Date.now() - memCached.updatedAt < this.ttl) {
      this.updateLRU(cacheKey);
      return memCached.event;
    }

    // Then check Dexie (5-10ms)
    const cached = await this.get(pubkey, kind, d);
    if (cached) {
      // Populate memory cache for next time
      this.memoryCache.set(cacheKey, cached);
      this.cacheOrder.push(cacheKey);
      this.evictOldest();
      return cached.event;
    }

    return null;
  }

  /**
   * Get all events for a pubkey+kind (for parameterized replaceables)
   * Returns array of events, useful for kinds like 30000-39999 with multiple d-tags
   */
  async getAllForKind(pubkey: string, kind: number): Promise<NostrEvent[]> {
    try {
      const cached = await db.replaceableEvents
        .where("[pubkey+kind]")
        .equals([pubkey, kind])
        .toArray();

      // Filter out stale entries
      const fresh = cached.filter(
        (entry) => Date.now() - entry.updatedAt < this.ttl,
      );

      return fresh.map((entry) => entry.event);
    } catch (error) {
      console.error(
        `[ReplaceableEventCache] Error reading all kind:${kind} for ${pubkey.slice(0, 8)}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Check if we have a valid cache entry
   */
  async has(pubkey: string, kind: number, d: string = ""): Promise<boolean> {
    const cached = await this.get(pubkey, kind, d);
    return cached !== undefined;
  }

  /**
   * Invalidate (delete) cache entry
   */
  async invalidate(
    pubkey: string,
    kind: number,
    d: string = "",
  ): Promise<void> {
    try {
      await db.replaceableEvents.delete([pubkey, kind, d]);

      // Also remove from memory cache
      const cacheKey = buildCacheKey(pubkey, kind, d);
      this.memoryCache.delete(cacheKey);
      const index = this.cacheOrder.indexOf(cacheKey);
      if (index > -1) {
        this.cacheOrder.splice(index, 1);
      }

      console.debug(
        `[ReplaceableEventCache] Invalidated kind:${kind} for ${pubkey.slice(0, 8)}${d ? `/${d}` : ""}`,
      );
    } catch (error) {
      console.error(
        `[ReplaceableEventCache] Error invalidating kind:${kind} for ${pubkey.slice(0, 8)}:`,
        error,
      );
    }
  }

  /**
   * Invalidate all entries for a pubkey+kind (useful for parameterized replaceables)
   */
  async invalidateKind(pubkey: string, kind: number): Promise<void> {
    try {
      const count = await db.replaceableEvents
        .where("[pubkey+kind]")
        .equals([pubkey, kind])
        .delete();

      // Also remove from memory cache
      const keysToDelete: string[] = [];
      for (const key of this.memoryCache.keys()) {
        if (key.startsWith(`${pubkey}:${kind}:`)) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        this.memoryCache.delete(key);
        const index = this.cacheOrder.indexOf(key);
        if (index > -1) {
          this.cacheOrder.splice(index, 1);
        }
      }

      console.debug(
        `[ReplaceableEventCache] Invalidated ${count} kind:${kind} entries for ${pubkey.slice(0, 8)}`,
      );
    } catch (error) {
      console.error(
        `[ReplaceableEventCache] Error invalidating kind:${kind} for ${pubkey.slice(0, 8)}:`,
        error,
      );
    }
  }

  /**
   * Clear all cached events of a specific kind (for testing)
   */
  async clearKind(kind: number): Promise<void> {
    try {
      const count = await db.replaceableEvents
        .where("kind")
        .equals(kind)
        .delete();

      // Also remove from memory cache
      const keysToDelete: string[] = [];
      for (const key of this.memoryCache.keys()) {
        if (key.includes(`:${kind}:`)) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        this.memoryCache.delete(key);
        const index = this.cacheOrder.indexOf(key);
        if (index > -1) {
          this.cacheOrder.splice(index, 1);
        }
      }

      console.debug(
        `[ReplaceableEventCache] Cleared ${count} kind:${kind} entries`,
      );
    } catch (error) {
      console.error(
        `[ReplaceableEventCache] Error clearing kind:${kind}:`,
        error,
      );
    }
  }

  /**
   * Clear all cached events
   */
  async clear(): Promise<void> {
    try {
      await db.replaceableEvents.clear();
      this.memoryCache.clear();
      this.cacheOrder = [];
      console.log("[ReplaceableEventCache] Cleared all cached events");
    } catch (error) {
      console.error("[ReplaceableEventCache] Error clearing cache:", error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    count: number;
    byKind: Record<number, number>;
    oldestEntry: number | null;
    newestEntry: number | null;
    memoryCacheSize: number;
    memoryCacheLimit: number;
  }> {
    try {
      const count = await db.replaceableEvents.count();
      const all = await db.replaceableEvents.toArray();

      const byKind: Record<number, number> = {};
      for (const entry of all) {
        byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
      }

      if (all.length === 0) {
        return {
          count: 0,
          byKind: {},
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
        byKind,
        oldestEntry: oldest,
        newestEntry: newest,
        memoryCacheSize: this.memoryCache.size,
        memoryCacheLimit: MAX_MEMORY_CACHE,
      };
    } catch (error) {
      console.error("[ReplaceableEventCache] Error getting stats:", error);
      return {
        count: 0,
        byKind: {},
        oldestEntry: null,
        newestEntry: null,
        memoryCacheSize: this.memoryCache.size,
        memoryCacheLimit: MAX_MEMORY_CACHE,
      };
    }
  }

  /**
   * Clean up stale entries older than TTL
   */
  async cleanStale(): Promise<number> {
    try {
      const cutoff = Date.now() - this.ttl;
      const count = await db.replaceableEvents
        .where("updatedAt")
        .below(cutoff)
        .delete();

      console.log(
        `[ReplaceableEventCache] Cleaned ${count} stale entries older than ${Math.floor(this.ttl / 1000 / 60 / 60)}h`,
      );

      return count;
    } catch (error) {
      console.error("[ReplaceableEventCache] Error cleaning stale:", error);
      return 0;
    }
  }

  // ===== Convenience Helpers for Common Operations =====

  /**
   * Get outbox (write) relays for a pubkey from kind:10002 (NIP-65)
   */
  async getOutboxRelays(pubkey: string): Promise<string[] | null> {
    const event = await this.getEvent(pubkey, 10002);
    if (!event) return null;

    const relays = getOutboxes(event);
    return this.normalizeRelays(relays);
  }

  /**
   * Get outbox relays from memory cache only (synchronous, fast)
   */
  getOutboxRelaysSync(pubkey: string): string[] | null {
    const event = this.getSync(pubkey, 10002);
    if (!event) return null;

    const relays = getOutboxes(event);
    return this.normalizeRelays(relays);
  }

  /**
   * Get inbox (read) relays for a pubkey from kind:10002 (NIP-65)
   */
  async getInboxRelays(pubkey: string): Promise<string[] | null> {
    const event = await this.getEvent(pubkey, 10002);
    if (!event) return null;

    const relays = getInboxes(event);
    return this.normalizeRelays(relays);
  }

  /**
   * Get blossom servers for a pubkey from kind:10063 (BUD-03)
   */
  async getBlossomServers(pubkey: string): Promise<string[] | null> {
    const event = await this.getEvent(pubkey, 10063);
    if (!event) return null;

    return getServersFromEvent(event);
  }

  /**
   * Get blossom servers from memory cache only (synchronous, fast)
   */
  getBlossomServersSync(pubkey: string): string[] | null {
    const event = this.getSync(pubkey, 10063);
    if (!event) return null;

    return getServersFromEvent(event);
  }

  /**
   * Normalize relay URLs and filter invalid ones
   */
  private normalizeRelays(relays: string[]): string[] {
    return relays
      .map((url) => {
        try {
          return normalizeRelayURL(url);
        } catch {
          console.warn(`[ReplaceableEventCache] Invalid relay URL: ${url}`);
          return null;
        }
      })
      .filter((url): url is string => url !== null);
  }
}

// Singleton instance
export const replaceableEventCache = new ReplaceableEventCache();
export default replaceableEventCache;
