/**
 * Relay List Cache Service
 *
 * Wrapper around generic ReplaceableEventCache for NIP-65 relay lists (kind:10002).
 * Provides convenient helpers for accessing inbox/outbox relays.
 *
 * Now uses the generic cache for storage - parsing happens on-demand using applesauce helpers.
 */

import { getInboxes, getOutboxes } from "applesauce-core/helpers";
import { normalizeRelayURL } from "@/lib/relay-url";
import replaceableEventCache from "./replaceable-event-cache";
import type { IEventStore } from "applesauce-core/event-store";

const RELAY_LIST_KIND = 10002;

class RelayListCache {
  /**
   * Subscribe to EventStore to auto-cache kind:10002 events
   * @deprecated - Now handled by generic ReplaceableEventCache
   * Kept for backward compatibility with existing code
   */
  subscribeToEventStore(_eventStore: IEventStore): void {
    console.warn(
      "[RelayListCache] subscribeToEventStore is deprecated - kind:10002 is now auto-cached by ReplaceableEventCache",
    );
  }

  /**
   * Unsubscribe from EventStore
   * @deprecated - Now handled by generic ReplaceableEventCache
   * Kept for backward compatibility with existing code
   */
  unsubscribe(): void {
    console.warn(
      "[RelayListCache] unsubscribe is deprecated - managed by ReplaceableEventCache",
    );
  }

  /**
   * Get outbox relays from memory cache only (synchronous, fast)
   * Used for real-time operations where async Dexie lookup would be too slow
   * Returns null if not in memory cache
   */
  getOutboxRelaysSync(pubkey: string): string[] | null {
    const event = replaceableEventCache.getSync(pubkey, RELAY_LIST_KIND);
    if (!event) return null;

    // Parse and normalize on-demand (applesauce caches this)
    const writeRelays = getOutboxes(event);
    return this.normalizeRelays(writeRelays);
  }

  /**
   * Get outbox (write) relays for a pubkey from cache
   */
  async getOutboxRelays(pubkey: string): Promise<string[] | null> {
    const event = await replaceableEventCache.getEvent(pubkey, RELAY_LIST_KIND);
    if (!event) return null;

    // Parse and normalize on-demand (applesauce caches this)
    const writeRelays = getOutboxes(event);
    return this.normalizeRelays(writeRelays);
  }

  /**
   * Get inbox (read) relays for a pubkey from cache
   */
  async getInboxRelays(pubkey: string): Promise<string[] | null> {
    const event = await replaceableEventCache.getEvent(pubkey, RELAY_LIST_KIND);
    if (!event) return null;

    // Parse and normalize on-demand (applesauce caches this)
    const readRelays = getInboxes(event);
    return this.normalizeRelays(readRelays);
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
          console.warn(`[RelayListCache] Invalid relay URL: ${url}`);
          return null;
        }
      })
      .filter((url): url is string => url !== null);
  }

  /**
   * Check if we have a valid cache entry for a pubkey
   */
  async has(pubkey: string): Promise<boolean> {
    return replaceableEventCache.has(pubkey, RELAY_LIST_KIND);
  }

  /**
   * Invalidate (delete) cache entry for a pubkey
   */
  async invalidate(pubkey: string): Promise<void> {
    return replaceableEventCache.invalidate(pubkey, RELAY_LIST_KIND);
  }

  /**
   * Get cached relay list entry for a pubkey
   * Returns the full cached entry with event and parsed data
   */
  async get(
    pubkey: string,
  ): Promise<{ event: any; read: string[]; write: string[] } | null> {
    const event = await replaceableEventCache.getEvent(pubkey, RELAY_LIST_KIND);
    if (!event) return null;

    const read = this.normalizeRelays(getInboxes(event));
    const write = this.normalizeRelays(getOutboxes(event));

    return { event, read, write };
  }

  /**
   * Clear all cached relay lists (for testing)
   */
  async clear(): Promise<void> {
    return replaceableEventCache.clearKind(RELAY_LIST_KIND);
  }
}

// Singleton instance
export const relayListCache = new RelayListCache();
export default relayListCache;
