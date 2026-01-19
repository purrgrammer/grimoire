/**
 * Shared event fetching utilities for chat adapters
 *
 * Provides reusable functions for fetching events from relays
 * with EventStore caching and timeout handling.
 */

import { firstValueFrom } from "rxjs";
import type { Filter } from "nostr-tools";
import type { NostrEvent } from "@/types/nostr";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { getOutboxRelays, AGGREGATOR_RELAYS } from "./relay-utils";
import accountManager from "@/services/accounts";

export interface FetchEventOptions {
  /** Relay hints to try first */
  relayHints?: string[];
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Log prefix for debugging */
  logPrefix?: string;
}

export interface FetchReplaceableOptions extends FetchEventOptions {
  /** The d-tag identifier */
  identifier: string;
}

/**
 * Fetch an event by ID
 *
 * First checks EventStore cache, then fetches from relays.
 * Uses provided relay hints, falling back to user's outbox + aggregator relays.
 *
 * @param eventId - The event ID to fetch
 * @param options - Fetch options
 * @returns The event or null if not found
 */
export async function fetchEvent(
  eventId: string,
  options: FetchEventOptions = {},
): Promise<NostrEvent | null> {
  const {
    relayHints = [],
    timeout = 5000,
    logPrefix = "[ChatUtils]",
  } = options;

  // Check EventStore first
  const cached = await firstValueFrom(eventStore.event(eventId), {
    defaultValue: undefined,
  });
  if (cached) return cached;

  // Determine relays to use
  const relays = await resolveRelays(relayHints);

  if (relays.length === 0) {
    console.warn(`${logPrefix} No relays available for fetching event`);
    return null;
  }

  const filter: Filter = {
    ids: [eventId],
    limit: 1,
  };

  return fetchWithTimeout(relays, [filter], timeout, logPrefix);
}

/**
 * Fetch a replaceable event by kind, pubkey, and identifier
 *
 * First checks EventStore cache, then fetches from relays.
 *
 * @param kind - Event kind
 * @param pubkey - Author pubkey
 * @param options - Fetch options including identifier
 * @returns The event or null if not found
 */
export async function fetchReplaceableEvent(
  kind: number,
  pubkey: string,
  options: FetchReplaceableOptions,
): Promise<NostrEvent | null> {
  const {
    identifier,
    relayHints = [],
    timeout = 5000,
    logPrefix = "[ChatUtils]",
  } = options;

  // Check EventStore first
  const cached = await firstValueFrom(
    eventStore.replaceable(kind, pubkey, identifier),
    { defaultValue: undefined },
  );
  if (cached) return cached;

  // Determine relays to use
  const relays = await resolveRelays(relayHints);

  if (relays.length === 0) {
    console.warn(
      `${logPrefix} No relays available for fetching replaceable event`,
    );
    return null;
  }

  const filter: Filter = {
    kinds: [kind],
    authors: [pubkey],
    "#d": [identifier],
    limit: 1,
  };

  return fetchWithTimeout(relays, [filter], timeout, logPrefix);
}

/**
 * Fetch events matching a filter with timeout
 *
 * Returns the first event found or null after timeout/EOSE.
 *
 * @internal
 */
async function fetchWithTimeout(
  relays: string[],
  filters: Filter[],
  timeout: number,
  logPrefix: string,
): Promise<NostrEvent | null> {
  const events: NostrEvent[] = [];
  const obs = pool.subscription(relays, filters, { eventStore });

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      resolve();
    }, timeout);

    const sub = obs.subscribe({
      next: (response) => {
        if (typeof response === "string") {
          // EOSE received
          clearTimeout(timer);
          sub.unsubscribe();
          resolve();
        } else {
          events.push(response);
        }
      },
      error: (err) => {
        clearTimeout(timer);
        console.error(`${logPrefix} Fetch error:`, err);
        sub.unsubscribe();
        resolve();
      },
    });
  });

  return events[0] || null;
}

/**
 * Resolve relays to use for fetching
 *
 * Priority: provided hints > user's outbox > aggregator relays
 *
 * @internal
 */
async function resolveRelays(relayHints: string[]): Promise<string[]> {
  if (relayHints.length > 0) {
    return relayHints;
  }

  // Try user's outbox relays
  const activePubkey = accountManager.active$.value?.pubkey;
  if (activePubkey) {
    const outbox = await getOutboxRelays(activePubkey);
    if (outbox.length > 0) {
      return outbox.slice(0, 5);
    }
  }

  // Fall back to aggregator relays
  return AGGREGATOR_RELAYS;
}
