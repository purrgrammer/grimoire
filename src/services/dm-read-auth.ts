/**
 * Answering NIP-42 on the relays that hold this account's mail.
 *
 * A DM relay demanding authentication before it will serve your inbox is the
 * normal case, not an exception — that is most of what a DM relay is FOR. But
 * grimoire's `relayAuthManager` only authenticates on its own initiative for
 * relays the user has explicitly marked `always`; everything else parks the
 * challenge and waits for a person to answer a prompt. For an inbox read that
 * is indistinguishable from an empty inbox: the REQ is refused, applesauce's
 * read gate holds it waiting for an authentication nobody is going to perform,
 * and the conversation list comes back short with no error anywhere.
 *
 * So DM reads answer the challenge themselves. This is not a general loosening
 * of the auth policy — it is scoped to the relays `ownDmReadRelays` returned,
 * which are the ones the user nominated for their own mail, and it happens
 * only after they have asked for their inbox to be opened. Identifying
 * yourself to your own mailbox discloses nothing it does not already hold, and
 * it is the same reasoning that keeps reads on the authenticated pool while
 * sends go out on the anonymous one (`dm-publish-pool.ts`).
 *
 * Nothing here writes a preference. A relay authenticated for a DM read is
 * authenticated for that socket, not marked `always` behind the user's back.
 */

import { Subscription } from "rxjs";
import pool from "./relay-pool";
import { isRelayBlocked } from "./blocked-relays";
import { normalizeRelayURL } from "@/lib/relay-url";

/**
 * Watch these relays and authenticate as challenges arrive.
 *
 * A subscription rather than a promise, and it must outlive the read: the
 * challenge usually arrives AFTER the REQ, because the REQ is what opens the
 * socket. Answering it mid-read is exactly what unblocks applesauce's gate,
 * which retries the refused REQ once `authenticated$` turns true.
 *
 * Sockets also reconnect, and applesauce clears its auth state on both open
 * and close — so this stays subscribed for as long as the caller is reading.
 */
export function authenticateDmRelays(relays: string[]): Subscription {
  const subscription = new Subscription();
  const urls = [...new Set(relays.map(normalizeRelayURL))];
  if (urls.length === 0) return subscription;

  // Imported lazily, and failure is survivable. `relay-auth` reaches for
  // localStorage and a Dexie migration at module load — which a
  // node-environment test of the inbox has no business paying for, and the
  // inbox is what imports this. If it cannot load, reads still run; they just
  // get whatever the unauthenticated relays will serve.
  void import("./relay-auth")
    .then(({ default: relayAuthManager }) => {
      if (subscription.closed) return;

      for (const url of urls) {
        // Never hand a blocked relay to the auth manager: `pool.relay()`
        // registers it, and authenticating identifies the user to a relay they
        // asked never to be connected to.
        if (isRelayBlocked(url)) continue;

        // NIP-42 is per-socket; blocked relays are skipped by the continue above.
        // eslint-disable-next-line no-restricted-syntax
        const relay = pool.relay(url);
        // Idempotent, and required: the manager only knows about relays it has
        // been handed, and one reached for the first time by a DM read has
        // never been through `relayStateManager`.
        relayAuthManager.monitorRelay(relay);

        subscription.add(
          relay.challenge$.subscribe((challenge) => {
            if (!challenge || relay.authenticated) return;
            if (!relayAuthManager.hasSignerAvailable()) return;
            console.info(`[dm] answering auth challenge from ${url}`);
            relayAuthManager.authenticate(url).catch((error) => {
              // Reported, not thrown: one relay refusing to authenticate must
              // not stop the read from the three that would have served it.
              console.warn(`[dm] could not authenticate with ${url}:`, error);
            });
          }),
        );
      }
    })
    .catch((error) => {
      console.warn("[dm] relay auth unavailable for this read:", error);
    });

  return subscription;
}
