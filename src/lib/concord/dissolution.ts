/**
 * The dissolution tombstone — CORD-02 §9.
 *
 * Ported from armada `bc19d1f` (`isDissolved` / `isDissolvedOpened` in
 * `src/concord/lib/control.ts`), read side only: grimoire never dissolves.
 *
 * A community ends by an owner-signed tombstone at a coordinate derived from
 * the `community_id` ALONE — no key, no epoch — so every member past or present
 * resolves the same address and a Refounding can never strand the grave. It is
 * terminal and chainless: no version to race, nothing to edit. The presence of
 * one valid owner-signed edition at the coordinate IS the state.
 *
 * On sight the client seals the community: read-only, nothing new honored.
 * Held keys still open history. There is no un-dissolve.
 */

import { bytesToHex, dissolvedGroupKey } from "@/lib/concord/derive";
import {
  KIND_CONTROL,
  KIND_SEAL_PLAINTEXT,
  VSK_DISSOLVED,
} from "@/lib/concord/kinds";
import { openWrap, type OpenedEvent } from "@/lib/concord/stream";
import type { NostrEvent } from "@/types/nostr";

/**
 * Whether an already-opened event is a valid owner tombstone FOR THIS COMMUNITY.
 *
 * Authenticated by the SEAL SIGNER being the owner. The address it arrived at
 * proves nothing — `dissolved_pk` derives from the `community_id` with no
 * secret in the input, and that id ships in every invite, so anyone can derive
 * the whole keypair, read the plane and publish there. The one thing an
 * attacker cannot manufacture is an owner-signed `vsk 10` rumor.
 *
 * **THE `eid` CHECK IS THE WHOLE DEFENCE, AND AN ALL-ZERO VALUE IS REFUSED.**
 * The seal is plaintext, so it re-wraps verbatim with its signature intact —
 * the property compaction depends on. A genuine tombstone for community X could
 * otherwise be lifted off X's dissolved plane and re-wrapped at the address of
 * any OTHER community the same owner runs, killing it permanently: no
 * membership, no keys, nothing forged, and by the rule above no recovery.
 * Earlier revisions specified an all-zero placeholder here; accepting it IS the
 * vulnerability. The failure modes are not symmetric — refusing leaves a dead
 * community reading alive, which its owner fixes by re-dissolving, while
 * accepting leaves every owner of more than one community a single public id
 * away from an unrecoverable kill.
 */
export function isDissolvedOpened(
  opened: OpenedEvent,
  ownerHex: string,
  communityId: Uint8Array,
): boolean {
  if (opened.author !== ownerHex) return false;
  // The seal FORM (plaintext, CORD-02 §5) while it is still known; a stored
  // rumor has no envelope and passed this at ingest.
  if (
    opened.sealKind !== undefined &&
    opened.sealKind !== KIND_SEAL_PLAINTEXT
  ) {
    return false;
  }
  const vsk = opened.tags.find((t) => t[0] === "vsk")?.[1];
  const eid = opened.tags.find((t) => t[0] === "eid")?.[1];
  return (
    opened.kind === KIND_CONTROL &&
    vsk === VSK_DISSOLVED &&
    eid === bytesToHex(communityId)
  );
}

/**
 * The tombstone's ms among these wraps, or undefined.
 *
 * A TIMESTAMP rather than a boolean, because both the Control and Guestbook
 * planes replay from history: a caller judging a past action needs to know
 * whether it predates the grave (honored) or follows it (refused). Truthiness
 * still reads as "dissolved".
 */
export function findTombstone(
  wraps: NostrEvent[],
  communityId: Uint8Array,
  ownerHex: string,
): number | undefined {
  const group = dissolvedGroupKey(communityId);
  for (const wrap of wraps) {
    let opened: OpenedEvent;
    try {
      opened = openWrap(wrap, group);
    } catch {
      continue;
    }
    if (isDissolvedOpened(opened, ownerHex, communityId)) return opened.ms;
  }
  return undefined;
}
