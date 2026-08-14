/**
 * Event verification that pays the Schnorr check ONCE per event id.
 *
 * Ported from armada `bc19d1f` (`src/lib/verifyCache.ts`), scoped to Concord.
 *
 * Every seal a relay serves is Schnorr-verified synchronously (~1–2ms each on a
 * phone), and the same wrap arrives from every relay serving the community —
 * each delivery re-parsing the seal into a fresh object, so nostr-tools' own
 * per-object memo never hits. This makes verification O(unique events) instead
 * of O(copies received).
 *
 * The memo is sound because an event id IS the sha256 of its content:
 *
 *  - The claimed id is ALWAYS recomputed from the copy in hand first. The memo
 *    maps an id to "content hashing to this was verified", and the recomputed
 *    hash is the only thing binding THIS copy to that claim — without it, any
 *    content could ride a known-good id.
 *  - Only then may the Schnorr verify be skipped: an identical hash means
 *    identical content, and a valid signature over that content has already
 *    been seen. A duplicate copy carrying a MANGLED sig is thereby accepted,
 *    deliberately — the content is authentic regardless, which is the whole
 *    claim `openWrap` needs from this. Anything that RE-PUBLISHES an event
 *    verbatim must not lean on that: check `isSigned` first.
 *  - A FAILED verify is never memoized, so a forged copy cannot poison the id
 *    for the honest copy that arrives later.
 *
 * The hash is recomputed per copy on purpose: sha256 of a ~1KB event is
 * microseconds against the Schnorr verify's milliseconds, and it is the whole
 * of the memo's security argument.
 */

import { schnorr } from "@noble/curves/secp256k1.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { getEventHash } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools/pure";

/** Bounded FIFO — sized for a session's traffic, not a database's contents. */
const MAX_IDS = 20_000;
const verified = new Set<string>();

/** Verify `event`, skipping the Schnorr check for an id already verified. */
export function verifyEventOnce(event: NostrEvent): boolean {
  let hash: string;
  try {
    // `getEventHash` serializes, and serializing an event with missing or
    // ill-typed fields THROWS rather than returning a non-matching hash. A
    // malformed event has to read as unverified, not as an exception: the
    // caller is `openWrap`, whose seal is JSON parsed out of a decrypted
    // payload shaped by whoever holds the group key.
    hash = getEventHash(event);
  } catch {
    return false;
  }
  if (hash !== event.id) return false;
  if (verified.has(event.id)) return true;

  let ok: boolean;
  try {
    // Inside the try: malformed hex in any field throws, and reads as invalid.
    ok = schnorr.verify(
      hexToBytes(event.sig),
      hexToBytes(event.id),
      hexToBytes(event.pubkey),
    );
  } catch {
    ok = false;
  }
  if (ok) {
    if (verified.size >= MAX_IDS) {
      // Oldest insertion first — `Set` iterates in insertion order.
      const oldest = verified.keys().next();
      if (!oldest.done) verified.delete(oldest.value);
    }
    verified.add(event.id);
  }
  return ok;
}

/** Test seam: forget every verified id. */
export function _resetVerifyCacheForTests(): void {
  verified.clear();
}
