/**
 * Blossom Server Cache Service
 *
 * Wrapper around generic ReplaceableEventCache for BUD-03 blossom server lists (kind:10063).
 * Provides convenient helpers for accessing blossom servers.
 *
 * Now uses the generic cache for storage - parsing happens on-demand.
 */

import { getServersFromEvent } from "./blossom";
import replaceableEventCache from "./replaceable-event-cache";
import type { IEventStore } from "applesauce-core/event-store";

const BLOSSOM_SERVER_LIST_KIND = 10063;

class BlossomServerCache {
  /**
   * Subscribe to EventStore to auto-cache kind:10063 events
   * @deprecated - Now handled by generic ReplaceableEventCache
   * Kept for backward compatibility with existing code
   */
  subscribeToEventStore(_eventStore: IEventStore): void {
    console.warn(
      "[BlossomServerCache] subscribeToEventStore is deprecated - kind:10063 is now auto-cached by ReplaceableEventCache",
    );
  }

  /**
   * Unsubscribe from EventStore
   * @deprecated - Now handled by generic ReplaceableEventCache
   * Kept for backward compatibility with existing code
   */
  unsubscribe(): void {
    console.warn(
      "[BlossomServerCache] unsubscribe is deprecated - managed by ReplaceableEventCache",
    );
  }

  /**
   * Get blossom servers from memory cache only (synchronous, fast)
   * Used for real-time operations where async Dexie lookup would be too slow
   * Returns null if not in memory cache
   */
  getServersSync(pubkey: string): string[] | null {
    const event = replaceableEventCache.getSync(
      pubkey,
      BLOSSOM_SERVER_LIST_KIND,
    );
    if (!event) return null;

    // Parse on-demand
    return getServersFromEvent(event);
  }

  /**
   * Get blossom servers for a pubkey from cache
   */
  async getServers(pubkey: string): Promise<string[] | null> {
    const event = await replaceableEventCache.getEvent(
      pubkey,
      BLOSSOM_SERVER_LIST_KIND,
    );
    if (!event) return null;

    // Parse on-demand
    return getServersFromEvent(event);
  }

  /**
   * Check if we have a valid cache entry for a pubkey
   */
  async has(pubkey: string): Promise<boolean> {
    return replaceableEventCache.has(pubkey, BLOSSOM_SERVER_LIST_KIND);
  }

  /**
   * Invalidate (delete) cache entry for a pubkey
   */
  async invalidate(pubkey: string): Promise<void> {
    return replaceableEventCache.invalidate(pubkey, BLOSSOM_SERVER_LIST_KIND);
  }
}

// Singleton instance
export const blossomServerCache = new BlossomServerCache();
export default blossomServerCache;
