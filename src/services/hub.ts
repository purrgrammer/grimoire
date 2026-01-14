import { ActionRunner } from "applesauce-actions";
import eventStore from "./event-store";
import { EventFactory } from "applesauce-core/event-factory";
import pool from "./relay-pool";
import { relayListCache } from "./relay-list-cache";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import type { NostrEvent } from "nostr-tools/core";
import accountManager from "./accounts";

/**
 * Publishes a Nostr event to relays
 * If relays are provided, uses those; otherwise uses author's outbox relays
 * Falls back to seen relays from the event if no relay list found
 *
 * @param event - The signed Nostr event to publish
 * @param relays - Optional specific relays to publish to (used for gift wraps to inbox relays)
 */
export async function publishEvent(
  event: NostrEvent,
  relays?: string[],
): Promise<void> {
  let targetRelays = relays;

  // If no specific relays provided, use author's outbox relays
  if (!targetRelays || targetRelays.length === 0) {
    targetRelays =
      (await relayListCache.getOutboxRelays(event.pubkey)) ?? undefined;

    // Fallback to relays from the event itself (where it was seen)
    if (!targetRelays || targetRelays.length === 0) {
      const seenRelays = getSeenRelays(event);
      targetRelays = seenRelays ? Array.from(seenRelays) : [];
    }
  }

  // If still no relays, throw error
  if (targetRelays.length === 0) {
    throw new Error(
      "No relays found for publishing. Please configure relay list (kind 10002) or ensure event has relay hints.",
    );
  }

  // Publish to relay pool
  await pool.publish(targetRelays, event);

  // Add to EventStore for immediate local availability
  eventStore.add(event);
}

const factory = new EventFactory();

/**
 * Global action runner for Grimoire
 * Used to register and execute actions throughout the application
 *
 * Configured with:
 * - EventStore: Single source of truth for Nostr events
 * - EventFactory: Creates and signs events
 * - publishEvent: Publishes events to author's outbox relays (with fallback to seen relays)
 */
export const hub = new ActionRunner(eventStore, factory, publishEvent);

// Sync factory signer with active account
// This ensures the hub can sign events when an account is active
accountManager.active$.subscribe((account) => {
  factory.setSigner(account?.signer || undefined);
});

export async function publishEventToRelays(
  event: NostrEvent,
  relays: string[],
): Promise<void> {
  // If no relays, throw error
  if (relays.length === 0) {
    throw new Error(
      "No relays found for publishing. Please configure relay list (kind 10002) or ensure event has relay hints.",
    );
  }

  // Publish to relay pool
  await pool.publish(relays, event);

  // Add to EventStore for immediate local availability
  eventStore.add(event);
}
