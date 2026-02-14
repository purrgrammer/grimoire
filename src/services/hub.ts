import { ActionRunner } from "applesauce-actions";
import eventStore from "./event-store";
import { EventFactory } from "applesauce-core/event-factory";
import type { NostrEvent } from "nostr-tools/core";
import accountManager from "./accounts";
import publishService from "./publish-service";

/**
 * Publishes a Nostr event to relays using the centralized PublishService
 *
 * Relay selection strategy (in priority order):
 * 1. Author's outbox relays (kind 10002)
 * 2. User's configured write relays (from Grimoire state)
 * 3. Seen relays from the event
 * 4. Aggregator relays (fallback)
 *
 * @param event - The signed Nostr event to publish
 */
export async function publishEvent(event: NostrEvent): Promise<void> {
  const result = await publishService.publish(event);

  if (!result.ok) {
    const errors = result.failed
      .map((f) => `${f.relay}: ${f.error}`)
      .join(", ");
    throw new Error(`Failed to publish to any relay. Errors: ${errors}`);
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
 * - publishEvent: Publishes events via centralized PublishService
 */
export const hub = new ActionRunner(eventStore, factory, publishEvent);

// Sync factory signer with active account
// This ensures the hub can sign events when an account is active
accountManager.active$.subscribe((account) => {
  factory.setSigner(account?.signer || undefined);
});

/**
 * Publishes a Nostr event to specific relays
 *
 * @param event - The signed Nostr event to publish
 * @param relays - Explicit list of relay URLs to publish to
 */
export async function publishEventToRelays(
  event: NostrEvent,
  relays: string[],
): Promise<void> {
  if (relays.length === 0) {
    throw new Error("No relays provided for publishing.");
  }

  const result = await publishService.publishToRelays(event, relays);

  if (!result.ok) {
    const errors = result.failed
      .map((f) => `${f.relay}: ${f.error}`)
      .join(", ");
    throw new Error(`Failed to publish to any relay. Errors: ${errors}`);
  }
}
