/**
 * Event cache service for persisting Nostr events to Dexie
 *
 * Provides:
 * - Event caching for offline access
 * - CacheRequest function for applesauce loaders
 * - Automatic persistence of events from EventStore
 */
import type { Filter, NostrEvent } from "nostr-tools";
import db, { type CachedEvent } from "./db";
import { matchFilter } from "nostr-tools";

/**
 * Add events to the cache
 */
export async function cacheEvents(events: NostrEvent[]): Promise<void> {
  if (events.length === 0) return;

  const now = Date.now();
  const cachedEvents: CachedEvent[] = events.map((event) => ({
    id: event.id,
    event,
    cachedAt: now,
  }));

  // Use bulkPut to handle duplicates gracefully
  await db.events.bulkPut(cachedEvents);
}

/**
 * Get a single event from cache by ID
 */
export async function getCachedEvent(
  id: string,
): Promise<NostrEvent | undefined> {
  const cached = await db.events.get(id);
  return cached?.event;
}

/**
 * Get events from cache matching filters
 * This is used as a CacheRequest for applesauce loaders
 */
export async function getEventsForFilters(
  filters: Filter[],
): Promise<NostrEvent[]> {
  // For simple ID lookups, use direct queries
  const idFilters = filters.filter(
    (f) => f.ids && f.ids.length > 0 && Object.keys(f).length === 1,
  );

  if (idFilters.length === filters.length && idFilters.length > 0) {
    // All filters are simple ID lookups
    const allIds = idFilters.flatMap((f) => f.ids || []);
    const cached = await db.events.bulkGet(allIds);
    return cached
      .filter((c): c is CachedEvent => c !== undefined)
      .map((c) => c.event);
  }

  // For complex filters, we need to scan and filter
  // This is less efficient but necessary for kind/author/tag queries
  const allEvents = await db.events.toArray();
  const matchingEvents: NostrEvent[] = [];

  for (const cached of allEvents) {
    for (const filter of filters) {
      if (matchFilter(filter, cached.event)) {
        matchingEvents.push(cached.event);
        break; // Event matches at least one filter
      }
    }
  }

  // Apply limit if specified (use smallest limit from filters)
  const limits = filters
    .map((f) => f.limit)
    .filter((l): l is number => l !== undefined);
  if (limits.length > 0) {
    const minLimit = Math.min(...limits);
    // Sort by created_at descending and take limit
    matchingEvents.sort((a, b) => b.created_at - a.created_at);
    return matchingEvents.slice(0, minLimit);
  }

  return matchingEvents;
}

/**
 * CacheRequest function for applesauce loaders
 * Compatible with createTimelineLoader's cache option
 */
export const cacheRequest = (filters: Filter[]): Promise<NostrEvent[]> =>
  getEventsForFilters(filters);

/**
 * Clear old cached events (older than maxAge in milliseconds)
 * Default: 30 days
 */
export async function pruneEventCache(
  maxAgeMs: number = 30 * 24 * 60 * 60 * 1000,
): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const deleted = await db.events.where("cachedAt").below(cutoff).delete();
  return deleted;
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  eventCount: number;
  oldestEvent: number | null;
  newestEvent: number | null;
}> {
  const count = await db.events.count();

  if (count === 0) {
    return { eventCount: 0, oldestEvent: null, newestEvent: null };
  }

  const oldest = await db.events.orderBy("cachedAt").first();
  const newest = await db.events.orderBy("cachedAt").last();

  return {
    eventCount: count,
    oldestEvent: oldest?.cachedAt ?? null,
    newestEvent: newest?.cachedAt ?? null,
  };
}
