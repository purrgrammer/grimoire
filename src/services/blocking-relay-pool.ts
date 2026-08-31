/**
 * A `RelayPool` that honours the NIP-51 kind-10006 blocked relay list.
 *
 * Every pool in grimoire is one of these. Enforcement sits in `group()` because
 * that is applesauce's single funnel: `req`, `event`, `negentropy`, `publish`,
 * `request`, `subscription`, `subscriptionMap`, `outboxSubscription`, `count`
 * and `sync` all call `this.group(relays)` before touching a socket, and
 * `group()` is what turns a URL into a registered `Relay`. Filtering here also
 * covers the loaders in `loaders.ts`, which resolve relay hints internally where
 * no call-site filter could reach them.
 *
 * The array form is kept an array on purpose. Converting it to an observable so
 * the group could react to the block list looks tempting and is a trap:
 * `RelayGroup.relays` throws "This group was created with an observable" and
 * `has()`, `add()`, `remove()`, `negentropy()` and `sync()` all read it. Live
 * changes are handled by pruning instead.
 */

import { RelayPool } from "applesauce-relay";
import type { RelayOptions } from "applesauce-relay";
import type { PoolRelayInput } from "applesauce-relay";
import { Subscription, isObservable, map } from "rxjs";
import { normalizeRelayURL } from "@/lib/relay-url";
import { blocked$, filterBlockedRelays } from "./blocked-relays";

export class BlockingRelayPool extends RelayPool {
  /** Prunes sockets to relays that become blocked after they were opened. */
  private blockedSubscription: Subscription;

  constructor(options?: RelayOptions) {
    super(options);

    // Cold start never waits for the list: the set is empty until the kind-10006
    // event arrives, so relays connect and are pruned when it lands.
    this.blockedSubscription = blocked$.subscribe((blocked) => {
      if (blocked.size === 0) return;
      this.pruneBlocked(blocked);
    });
  }

  /**
   * Closes and drops any live relay that is now blocked.
   *
   * Matching cannot compare the blocked set against `relays` keys directly:
   * those keys come from applesauce's `normalizeURL`, which does not lowercase,
   * while the blocked set does. `remove()` looks its argument up raw
   * (`this.relays.get(relay)`), so removal has to pass the pool's own key back.
   *
   * `Relay.close()` cancels the pending reconnect timer and completes `ready$`
   * so a subscriber still holding the relay cannot re-arm it — a subscription
   * opened before the block keeps the dead instance, but it cannot reconnect.
   */
  private pruneBlocked(blocked: ReadonlySet<string>): void {
    for (const key of [...this.relays.keys()]) {
      let normalized: string;
      try {
        normalized = normalizeRelayURL(key);
      } catch {
        continue;
      }
      if (blocked.has(normalized)) this.remove(key, true);
    }
  }

  override group(relays: PoolRelayInput, ignoreOffline?: boolean) {
    const filtered: PoolRelayInput = isObservable(relays)
      ? relays.pipe(map(filterBlockedRelays))
      : filterBlockedRelays(relays);

    return super.group(filtered, ignoreOffline);
  }

  override close(): void {
    this.blockedSubscription.unsubscribe();
    super.close();
  }
}

export default BlockingRelayPool;
