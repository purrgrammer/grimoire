/**
 * DM Relay List Cache Service
 *
 * Caches NIP-17 DM relay lists (kind:10050) in Dexie for fast access.
 * Fetches from user's relays + discovery relays when not in cache.
 *
 * Auto-caches kind:10050 events from EventStore when subscribed.
 */

import type { NostrEvent } from "@/types/nostr";
import { normalizeRelayURL } from "@/lib/relay-url";
import db, { CachedDMRelayList } from "./db";
import type { IEventStore } from "applesauce-core/event-store";
import type { Subscription } from "rxjs";
import pool from "./relay-pool";
import { relayListCache } from "./relay-list-cache";
import { AGGREGATOR_RELAYS } from "./loaders";

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

class DMRelayListCache {
  private eventStoreSubscription: Subscription | null = null;
  private memoryCache = new Map<string, CachedDMRelayList>();

  /**
   * Subscribe to EventStore to auto-cache kind:10050 events
   */
  subscribeToEventStore(eventStore: IEventStore): void {
    if (this.eventStoreSubscription) {
      console.warn("[DMRelayListCache] Already subscribed to EventStore");
      return;
    }

    // Subscribe to kind:10050 events
    this.eventStoreSubscription = eventStore
      .filters({ kinds: [10050] })
      .subscribe((event: NostrEvent) => {
        // Cache each kind:10050 event as it arrives
        void this.set(event);
      });

    console.log(
      "[DMRelayListCache] Subscribed to EventStore for kind:10050 events",
    );
  }

  /**
   * Unsubscribe from EventStore
   */
  unsubscribe(): void {
    if (this.eventStoreSubscription) {
      this.eventStoreSubscription.unsubscribe();
      this.eventStoreSubscription = null;
      console.log("[DMRelayListCache] Unsubscribed from EventStore");
    }
  }

  /**
   * Get cached DM relay list for a pubkey
   * If not cached or stale, fetches from relays
   */
  async get(pubkey: string): Promise<string[]> {
    // Check memory cache first
    const memCached = this.memoryCache.get(pubkey);
    if (memCached && Date.now() - memCached.updatedAt < CACHE_TTL) {
      console.debug(
        `[DMRelayListCache] Memory cache hit for ${pubkey.slice(0, 8)}`,
      );
      return memCached.relays;
    }

    // Check Dexie cache
    try {
      const cached = await db.dmRelayLists.get(pubkey);
      if (cached && Date.now() - cached.updatedAt < CACHE_TTL) {
        console.debug(
          `[DMRelayListCache] Dexie cache hit for ${pubkey.slice(0, 8)}`,
        );
        this.memoryCache.set(pubkey, cached);
        return cached.relays;
      }
    } catch (error) {
      console.error(
        `[DMRelayListCache] Error reading cache for ${pubkey.slice(0, 8)}:`,
        error,
      );
    }

    // Cache miss - fetch from relays
    console.log(
      `[DMRelayListCache] Cache miss for ${pubkey.slice(0, 8)}, fetching from relays`,
    );
    return this.fetchAndCache(pubkey);
  }

  /**
   * Fetch kind 10050 from relays and cache it
   */
  private async fetchAndCache(pubkey: string): Promise<string[]> {
    try {
      // Get user's outbox relays to query for their kind 10050
      let queryRelays = await relayListCache.getOutboxRelays(pubkey);

      // If no outbox relays, use aggregator relays
      if (!queryRelays || queryRelays.length === 0) {
        console.log(
          `[DMRelayListCache] No outbox relays for ${pubkey.slice(0, 8)}, using aggregator relays`,
        );
        queryRelays = AGGREGATOR_RELAYS;
      } else {
        // Add aggregator relays for better discovery
        queryRelays = [...queryRelays, ...AGGREGATOR_RELAYS];
      }

      console.log(
        `[DMRelayListCache] Fetching kind 10050 for ${pubkey.slice(0, 8)} from ${queryRelays.length} relays`,
      );

      // Fetch kind 10050 from relays
      const filter = {
        kinds: [10050],
        authors: [pubkey],
        limit: 1,
      };

      // Use pool.subscription to fetch from relays
      const obs = pool.subscription(queryRelays, [filter], {});

      return new Promise((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.warn(
              `[DMRelayListCache] Timeout fetching kind 10050 for ${pubkey.slice(0, 8)}`,
            );
            resolve([]);
          }
        }, 5000); // 5 second timeout

        const sub = obs.subscribe({
          next: (response) => {
            if (typeof response === "string") {
              // EOSE received
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                console.log(
                  `[DMRelayListCache] EOSE - no kind 10050 found for ${pubkey.slice(0, 8)}`,
                );
                sub.unsubscribe();
                resolve([]);
              }
            } else {
              // Event received
              const event = response as NostrEvent;
              if (
                !resolved &&
                event.kind === 10050 &&
                event.pubkey === pubkey
              ) {
                resolved = true;
                clearTimeout(timeout);
                sub.unsubscribe();

                // Cache the event
                void this.set(event);

                // Parse relays from event
                const relays = event.tags
                  .filter((t) => t[0] === "relay" && t[1])
                  .map((t) => t[1]);

                console.log(
                  `[DMRelayListCache] Found kind 10050 for ${pubkey.slice(0, 8)} with ${relays.length} relays`,
                );
                resolve(relays);
              }
            }
          },
          error: (err) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              console.error(
                `[DMRelayListCache] Subscription error for ${pubkey.slice(0, 8)}:`,
                err,
              );
              resolve([]);
            }
          },
          complete: () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve([]);
            }
          },
        });
      });
    } catch (error) {
      console.error(
        `[DMRelayListCache] Error fetching kind 10050 for ${pubkey.slice(0, 8)}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Store DM relay list event in cache
   */
  async set(event: NostrEvent): Promise<void> {
    try {
      if (event.kind !== 10050) {
        console.warn(
          `[DMRelayListCache] Attempted to cache non-10050 event (kind ${event.kind})`,
        );
        return;
      }

      // Parse relays from event tags
      const relays = event.tags
        .filter((t) => t[0] === "relay" && t[1])
        .map((t) => t[1]);

      // Normalize URLs and filter invalid ones
      const normalizedRelays = relays
        .map((url) => {
          try {
            return normalizeRelayURL(url);
          } catch {
            console.warn(`[DMRelayListCache] Invalid relay URL: ${url}`);
            return null;
          }
        })
        .filter((url): url is string => url !== null);

      // Store in Dexie and memory cache
      const cachedEntry: CachedDMRelayList = {
        pubkey: event.pubkey,
        event,
        relays: normalizedRelays,
        updatedAt: Date.now(),
      };

      await db.dmRelayLists.put(cachedEntry);
      this.memoryCache.set(event.pubkey, cachedEntry);

      console.debug(
        `[DMRelayListCache] Cached DM relay list for ${event.pubkey.slice(0, 8)} (${normalizedRelays.length} relays)`,
      );
    } catch (error) {
      console.error(
        `[DMRelayListCache] Error caching DM relay list for ${event.pubkey.slice(0, 8)}:`,
        error,
      );
    }
  }

  /**
   * Clear all cached DM relay lists
   */
  async clearAll(): Promise<void> {
    await db.dmRelayLists.clear();
    this.memoryCache.clear();
    console.log("[DMRelayListCache] Cleared all cached DM relay lists");
  }
}

export const dmRelayListCache = new DMRelayListCache();
