/**
 * Keeps `blocked-relays.ts` in step with the active account's kind-10006 event.
 *
 * Split out from `blocked-relays.ts` so that module stays off the relay pool's
 * import path — see the cycle documented there. Nothing on that path imports
 * this file; it is wired in once from the app shell.
 */

import { of, switchMap } from "rxjs";
import accountManager from "./accounts";
import eventStore from "./event-store";
import { getBlockedRelaysOwner, setBlockedRelays } from "./blocked-relays";
import { parseRelayEntries } from "@/lib/relay-list-utils";

const BLOCKED_RELAYS_KIND = 10006;

/**
 * Starts tracking the active account's blocked relay list.
 *
 * `switchMap` is what makes account switching safe: it drops the previous
 * account's subscription, so a blocklist can never leak across identities.
 * Signing out clears the set — the list belongs to the account, not the browser.
 *
 * `parseRelayEntries` reads `relay` tags only, giving public-only semantics for
 * free: no NIP-44 decryption, so no signer prompt on every account switch.
 */
export function startBlockedRelaysSync() {
  return accountManager.active$
    .pipe(
      switchMap((account) =>
        account
          ? eventStore
              .replaceable(BLOCKED_RELAYS_KIND, account.pubkey, "")
              .pipe(switchMap((event) => of({ account, event })))
          : of({ account: null, event: undefined }),
      ),
    )
    .subscribe(({ account, event }) => {
      if (!account) {
        setBlockedRelays([], null);
        return;
      }

      // `replaceable()` emits `undefined` until the event arrives, and the
      // persisted seed exists precisely to cover that gap. Clearing on it would
      // reopen the startup window the seed closes — blocked relays back in the
      // pool for the length of a network round trip. Only a seed belonging to
      // ANOTHER account has to go, and immediately.
      if (!event) {
        if (getBlockedRelaysOwner() !== account.pubkey) {
          setBlockedRelays([], null);
        }
        return;
      }

      const entries = parseRelayEntries(event, {
        tagName: "relay",
        hasMarkers: false,
      });
      setBlockedRelays(
        entries.map((entry) => entry.url),
        account.pubkey,
      );
    });
}
