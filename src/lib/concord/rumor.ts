/**
 * The unsigned inner event every Concord plane actually carries.
 *
 * Ported from armada `bc19d1f` (`src/lib/nostrRumor.ts`).
 *
 * A rumor is a NostrEvent shape with an id but no signature: authorship is
 * proven by the SEAL's signature around it (CORD-01), not by the rumor itself.
 * The store persists rumors verbatim, so most reads are unsigned by
 * construction.
 *
 * Built on nostr-tools' `NostrEvent` because every crypto primitive here comes
 * from nostr-tools; it is structurally identical to grimoire's own
 * `src/types/nostr.ts` shape, so the two interoperate without conversion.
 */

import type { NostrEvent } from "nostr-tools/pure";

/** An unsigned rumor: a NostrEvent shape with an id but no signature. */
export type NostrRumor = Omit<NostrEvent, "sig">;

/**
 * Whether a rumor still carries its signature, narrowing it to a full
 * `NostrEvent`.
 *
 * Wraps arrive signed off the wire and are stored unsigned, and most code does
 * not care. This is for the places that do — anything re-publishing an event
 * verbatim, where an unsigned copy is refused by every relay.
 */
export function isSigned(rumor: NostrRumor): rumor is NostrEvent {
  const sig = (rumor as Partial<NostrEvent>).sig;
  return typeof sig === "string" && sig.length > 0;
}
