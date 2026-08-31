/**
 * The pool NIP-17 gift wraps are PUBLISHED on — the second exception to the
 * singleton rule, and a different one from Concord's.
 *
 * A gift wrap is signed by a throwaway key so the relay storing it cannot tell
 * who sent it. That is the entire point of the outer layer. The guarantee dies
 * the moment the socket carrying the EVENT has NIP-42 AUTHed as the sender:
 * the relay stops having to infer anything and simply reads the authenticated
 * pubkey off the connection.
 *
 * `relayAuthManager` (`relay-auth.ts`) is wired to the singleton `pool` and
 * auto-authenticates every relay the user marked `always`. Publishing a peer's
 * wrap there would hand that relay the link between an anonymous event and a
 * real identity — including relays belonging to someone else.
 *
 * So the split is asymmetric, and deliberately so:
 *
 * - **Reads stay on the singleton pool, authenticated.** `{kinds:[1059],
 *   "#p":[self]}` runs against the user's OWN inbox relays. Most DM relays
 *   require AUTH before they will serve DMs, and identifying yourself to your
 *   own mailbox discloses nothing it does not already hold.
 * - **A peer's wrap is published here, never authenticated.** Nothing points an
 *   auth manager at this pool. A relay that answers `auth-required` to the
 *   EVENT is reported undeliverable — the wrap is not re-sent over an
 *   authenticated socket to make the error go away.
 * - **The self-copy** goes to the user's own relays on the singleton pool,
 *   where AUTH is fine and is sometimes required to write at all.
 *
 * Never REQ on this pool. It publishes; that is all it is for.
 *
 * Honest limits, both outside what this pool can fix:
 *
 * - A second socket to the same host, from the same address, at the same moment
 *   is still correlatable by a relay that cares to try. This removes the
 *   cryptographic link, not the network-level one.
 * - Resolving the recipient's kind-10050 runs through the ordinary store loader
 *   on the SINGLETON pool, which fans out to the fallback relays. So an
 *   authenticated socket asks a handful of well-known relays who a wrap is
 *   about to go to, moments before it goes. The wrap itself stays anonymous;
 *   the interest does not.
 */

import { BlockingRelayPool } from "./blocking-relay-pool";

const dmPublishPool = new BlockingRelayPool();

export default dmPublishPool;
