import { ActionRunner } from "applesauce-actions";
import eventStore from "./event-store";
import { EventFactory } from "applesauce-core/event-factory";
import type { NostrEvent } from "nostr-tools/core";
import accountManager from "./accounts";
import { publishingService } from "./publishing";

/**
 * Publishes a Nostr event to relays using the author's outbox relays
 * Uses the unified PublishingService for tracking and per-relay status.
 *
 * @param event - The signed Nostr event to publish
 */
export async function publishEvent(event: NostrEvent): Promise<void> {
  const result = await publishingService.publish(event, { mode: "outbox" });

  // Throw if all relays failed (maintain backwards compatibility)
  if (result.status === "failed") {
    throw new Error(
      "No relays found for publishing. Please configure relay list (kind 10002) or ensure event has relay hints.",
    );
  }
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

/**
 * Publishes a Nostr event to specific relays
 * Uses the unified PublishingService for tracking and per-relay status.
 *
 * @param event - The signed Nostr event to publish
 * @param relays - Specific relay URLs to publish to
 */
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

  const result = await publishingService.publish(event, {
    mode: "explicit",
    relays,
  });

  // Throw if all relays failed (maintain backwards compatibility)
  if (result.status === "failed") {
    throw new Error("Failed to publish to any relay.");
  }
}
