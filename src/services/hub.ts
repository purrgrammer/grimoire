import { ActionRunner } from "applesauce-actions";
import eventStore from "./event-store";
import type { EventSigner } from "applesauce-core";
import type { NostrEvent } from "nostr-tools/core";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { getDefaultStore } from "jotai";
import accountManager from "./accounts";
import publishService from "./publish-service";
import { selectRelaysForPublish } from "./relay-selection";
import { grimoireStateAtom } from "@/core/state";

/**
 * Get the active user's configured write relays from Grimoire state
 */
function getStateWriteRelays(): string[] {
  const store = getDefaultStore();
  const state = store.get(grimoireStateAtom);
  return (
    state.activeAccount?.relays?.filter((r) => r.write).map((r) => r.url) || []
  );
}

/**
 * Publishes a Nostr event to relays using the outbox model
 *
 * Relay selection via selectRelaysForPublish():
 * 1. Author's outbox relays (kind 10002)
 * 2. User's configured write relays (from Grimoire state)
 * 3. Seen relays from the event
 * 4. Aggregator relays (fallback)
 *
 * @param event - The signed Nostr event to publish
 */
export async function publishEvent(event: NostrEvent): Promise<void> {
  const seenRelays = getSeenRelays(event);
  const relays = await selectRelaysForPublish(event.pubkey, {
    writeRelays: getStateWriteRelays(),
    relayHints: seenRelays ? Array.from(seenRelays) : [],
  });

  const result = await publishService.publish(event, relays);

  if (!result.ok) {
    const errors = result.failed
      .map((f) => `${f.relay}: ${f.error}`)
      .join(", ");
    throw new Error(`Failed to publish to any relay. Errors: ${errors}`);
  }
}

/**
 * Signer that delegates to the currently active account.
 *
 * applesauce v6's ActionRunner takes an EventSigner directly; the old
 * EventFactory indirection was removed.
 */
function requireActiveSigner() {
  const signer = accountManager.active?.signer;
  if (!signer) throw new Error("No active account signer available");
  return signer;
}

const activeAccountSigner: EventSigner = {
  getPublicKey: async () => requireActiveSigner().getPublicKey(),
  signEvent: async (draft) => requireActiveSigner().signEvent(draft),
  // Delegated as getters so capability detection (`signer.nip44 !== undefined`)
  // still reflects what the active account actually supports.
  get nip04() {
    return accountManager.active?.signer?.nip04;
  },
  get nip44() {
    return accountManager.active?.signer?.nip44;
  },
};

let runner: ActionRunner | undefined;
let runnerPubkey: string | undefined;

/**
 * The action runner for the active account.
 *
 * ActionRunner memoizes its context — including `self` and `user` — on first
 * use, so a single long-lived instance would keep handing actions the pubkey
 * that was active when it was first run, even though signing follows the
 * current account. Keying the instance to the active pubkey makes that
 * impossible rather than papering over it.
 *
 * Configured with:
 * - EventStore: Single source of truth for Nostr events
 * - EventSigner: Signs events using the active account
 * - publishEvent: Publishes events via outbox relay selection + PublishService
 */
export function getHub(): ActionRunner {
  const pubkey = accountManager.active?.pubkey;

  if (!runner || runnerPubkey !== pubkey) {
    runner = new ActionRunner(eventStore, activeAccountSigner, publishEvent);
    runnerPubkey = pubkey;
  }

  return runner;
}

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

  const result = await publishService.publish(event, relays);

  if (!result.ok) {
    const errors = result.failed
      .map((f) => `${f.relay}: ${f.error}`)
      .join(", ");
    throw new Error(`Failed to publish to any relay. Errors: ${errors}`);
  }
}
