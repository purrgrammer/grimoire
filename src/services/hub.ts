import { ActionRunner } from "applesauce-actions";
import eventStore from "./event-store";
import { EventFactory } from "applesauce-core/event-factory";
import pool from "./relay-pool";
import { relayListCache } from "./relay-list-cache";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import type { NostrEvent } from "nostr-tools/core";
import accountManager from "./accounts";
import { encryptedContentStorage } from "./db";
import { normalizeRelayURL } from "@/lib/relay-url";

/**
 * Publishes a Nostr event to relays
 *
 * @param event - The signed Nostr event to publish
 * @param relayHints - Optional relay hints (used for gift wraps)
 */
export async function publishEvent(
  event: NostrEvent,
  relayHints?: string[],
): Promise<void> {
  console.log(
    `[Publish] 🚀 publishEvent called for kind ${event.kind}, id ${event.id?.slice(0, 8) || "UNSIGNED"}, relayHints:`,
    relayHints,
  );

  let relays: string[];

  // If relays explicitly provided (e.g., from gift wrap actions), use them
  if (relayHints && relayHints.length > 0) {
    // Normalize relay hints to ensure consistent URLs
    relays = relayHints
      .map((url) => {
        try {
          return normalizeRelayURL(url);
        } catch (err) {
          console.warn(`[Publish] Failed to normalize relay hint: ${url}`, err);
          return null;
        }
      })
      .filter((url): url is string => url !== null);

    console.log(
      `[Publish] Using provided relay hints (${relays.length} relays) for event ${event.id.slice(0, 8)}`,
    );
  } else {
    // Otherwise use author's outbox relays (existing logic)
    const outboxRelays = await relayListCache.getOutboxRelays(event.pubkey);
    relays = outboxRelays || [];

    if (relays.length === 0) {
      const seenRelays = getSeenRelays(event);
      relays = seenRelays ? Array.from(seenRelays) : [];
    }
  }

  // If still no relays, throw error
  if (relays.length === 0) {
    console.error(
      `[Publish] ❌ No relays found for event ${event.id.slice(0, 8)}`,
    );
    throw new Error(
      "No relays found for publishing. Please configure relay list (kind 10002) or ensure event has relay hints.",
    );
  }

  console.log(
    `[Publish] 📤 Publishing to ${relays.length} relays:`,
    relays.join(", "),
  );

  // Publish to relay pool
  await pool.publish(relays, event);

  console.log(
    `[Publish] ✅ Successfully published event ${event.id.slice(0, 8)}`,
  );

  // If this is a gift wrap with decrypted content symbol, persist it to Dexie
  // This ensures when we receive it back from relay, it's recognized as unlocked
  if (event.kind === 1059) {
    console.log(
      `[Publish] 🎁 Gift wrap detected (kind 1059), checking for encrypted content symbol...`,
    );
    const EncryptedContentSymbol = Symbol.for("encrypted-content");
    const hasSymbol = Reflect.has(event, EncryptedContentSymbol);
    console.log(`[Publish] Has EncryptedContentSymbol: ${hasSymbol}`);
    if (hasSymbol) {
      const plaintext = Reflect.get(event, EncryptedContentSymbol);
      console.log(
        `[Publish] Plaintext length: ${plaintext?.length || 0} chars`,
      );
      try {
        await encryptedContentStorage.setItem(event.id, plaintext);
        console.log(
          `[Publish] ✅ Persisted encrypted content for gift wrap ${event.id.slice(0, 8)}`,
        );
      } catch (err) {
        console.warn(`[Publish] ⚠️ Failed to persist encrypted content:`, err);
      }
    } else {
      console.warn(
        `[Publish] ⚠️ Gift wrap ${event.id.slice(0, 8)} has no EncryptedContentSymbol!`,
      );
    }
  }

  // Add to EventStore for immediate local availability
  console.log(
    `[Publish] 📥 Adding event ${event.id.slice(0, 8)} to EventStore`,
  );
  eventStore.add(event);
  console.log(`[Publish] ✅ Complete`);
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
