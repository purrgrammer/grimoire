/**
 * Concord's own `RelayPool` — a deliberate exception to the singleton rule.
 *
 * CLAUDE.md says never to construct a second `RelayPool`, and that rule earned
 * its place. This is the one exception, and it exists because of a failure
 * observed live in phase 5 rather than a preference:
 *
 * applesauce sets `receivedAuthRequiredForReq` BEFORE the `!waitForAuth` early
 * return, and that flag is per-`Relay`-instance, not per-REQ. So a Concord plane
 * REQ — which is authored by derived stream keys and must opt out of applesauce's
 * auth gate entirely (see `plane-request.ts`) — arms the auth-required gate for
 * grimoire's ORDINARY reads on the same relay. Grimoire's auth manager then
 * re-authenticates the USER, which surfaced as a signer prompt roughly every 35
 * seconds for as long as the refusals continued.
 *
 * Pull-on-open made that transient. A standing wire subscription makes it
 * continuous, on relays that also serve ordinary grimoire traffic. Isolating the
 * socket is the only fix that does not require patching applesauce.
 *
 * Scope of the exception, and it is narrow:
 *
 * - **Plane traffic only** — kind-1059 wraps at derived stream addresses. Every
 *   plane read goes through here; nothing else may.
 * - **The kind-13302 Community List stays on the shared pool.** It is authored by
 *   the user, on the user's own relays, and has nothing to do with the plane
 *   gate.
 * - **`concord-stream-auth.ts` must watch THIS pool.** It is what answers NIP-42
 *   challenges with stream keys, and pointing it at the wrong pool fails
 *   silently: AUTHs go to sockets nothing reads from and every plane REQ is
 *   refused.
 *
 * Cost, accepted: relay liveness and NIP-11 are not shared with the main pool,
 * so these sockets probe and reconnect independently. The Concord relay set is
 * small.
 */

import { RelayPool } from "applesauce-relay";

const concordPool = new RelayPool();

export default concordPool;
