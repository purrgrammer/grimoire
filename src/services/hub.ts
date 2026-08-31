import { ActionRunner } from "applesauce-actions";
import eventStore from "./event-store";
import type { EventSigner } from "applesauce-core";
import type { NostrEvent } from "nostr-tools/core";
import { kinds } from "nostr-tools";
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
 * 4. Fallback relays
 *
 * An explicit `relays` list overrides all of that. applesauce's `PublishMethod`
 * is `(event, relays?)`, and an action that passes relays means it: outbox
 * selection answers "where does this author write", which is the wrong question
 * whenever an event is addressed at someone else's inbox.
 *
 * **A gift wrap addressed to someone else must not come through here** — see
 * {@link assertNotSomeoneElsesGiftWrap}. Use `publishGiftWrap`
 * (`src/lib/dm/publish.ts`) instead.
 *
 * @param event - The signed Nostr event to publish
 * @param relays - Explicit relay URLs; omit to use outbox selection
 */
export async function publishEvent(
  event: NostrEvent,
  relays?: string[],
): Promise<void> {
  if (relays && relays.length > 0) return publishTo(event, relays);

  const seenRelays = getSeenRelays(event);
  const selected = await selectRelaysForPublish(event.pubkey, {
    writeRelays: getStateWriteRelays(),
    relayHints: seenRelays ? Array.from(seenRelays) : [],
  });

  return publishTo(event, selected);
}

/**
 * The singleton pool may publish a gift wrap only to the sender's OWN mailbox.
 *
 * `relayAuthManager` is wired to that pool and auto-authenticates any relay the
 * user marked `always`. A wrap is signed by a throwaway key precisely so the
 * relay cannot attribute it; pushing one over an authenticated socket hands
 * over the attribution anyway, and applesauce makes that easy to do by accident
 * — `Relay.publish` turns an `auth-required` refusal into a retry that WAITS
 * for authentication, so the auth manager satisfies it and the publish then
 * "succeeds".
 *
 * The self-copy of a NIP-17 message is the one legitimate exception: it is
 * addressed to us, on our own relays, which already know who we are.
 *
 * Thrown rather than rerouted. A caller that ended up here with someone else's
 * wrap has a routing bug, and quietly fixing it would hide the next one.
 */
function assertNotSomeoneElsesGiftWrap(event: NostrEvent): void {
  if (event.kind !== kinds.GiftWrap) return;
  const self = accountManager.active?.pubkey;
  const recipients = event.tags.filter((t) => t[0] === "p").map((t) => t[1]);
  // At least one, and every one ours. `every` alone passes vacuously for a
  // wrap with no p tags at all, which is exactly the shape a bug would produce.
  if (self && recipients.length > 0 && recipients.every((p) => p === self))
    return;
  throw new Error(
    "Refusing to publish a gift wrap addressed to someone else on the authenticated pool. Use publishGiftWrap() from src/lib/dm/publish.ts.",
  );
}

/** The one place an event actually reaches PublishService. */
async function publishTo(event: NostrEvent, relays: string[]): Promise<void> {
  assertNotSomeoneElsesGiftWrap(event);

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

  return publishTo(event, relays);
}
