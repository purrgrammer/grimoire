/**
 * Concord Rekeys & Refoundings — CORD-06, READ SIDE.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/rekey.ts`), minus every
 * builder and every mint: grimoire never rotates. What is here is the half a
 * second device needs — recognise a rotation, prove it extends the key we hold,
 * find our own blob in it, and decode what it hands over.
 *
 * Post-removal secrecy without ratchets: a rotation mints a fresh key at the
 * next epoch and delivers it as per-recipient blobs (kind 3303, chunked) at an
 * address derived from the PRIOR secret — so every current holder can find it,
 * and a removed member finding no blob for their locator across ALL chunks
 * knows they are out.
 *
 * The wrapped plaintext is fixed-width PER FORM, the width declaring the form
 * (CORD-06 §1), NIP-44-encrypted under the rotator↔recipient pairwise key (one
 * ECDH either side can compute, so a NIP-46 bunker opens its blob with a single
 * `nip44.decrypt`, no raw-key access):
 *
 *   - a Channel rotation's blob is 72 bytes: `scope_id[32] ‖ epoch_be[8] ‖ new_key[32]`;
 *   - a base rotation's member blob is 104, appending `new_control_pk[32]`;
 *   - a staff recipient's is 136, appending `new_control_root[32]`;
 *   - a 72-byte BASE blob is the legacy pre-split form — honored when reading
 *     old rotations, never minted anew (CORD-06 §3).
 *
 * Any other width is malformed and the blob is dropped. Signer nip44 interfaces
 * carry STRINGS, so armada transports the raw bytes as base64 inside the NIP-44
 * plaintext; the spec pins no byte-transport for string-only signers, so this
 * follows armada rather than inventing a second encoding nothing else reads.
 */

import {
  bytesToHex,
  controlSignerGroupKey,
  epochKeyCommitment,
  recipientLocator,
} from "@/lib/concord/derive";
import {
  citationFromTags,
  isTagDecimal,
  type AuthorityCitation,
} from "@/lib/concord/edition";
import { KIND_REKEY, KIND_SEAL_ENCRYPTED } from "@/lib/concord/kinds";
import type { OpenedEvent } from "@/lib/concord/stream";

/**
 * How many channel epochs past the one we hold to watch for rotations.
 *
 * Watching only `held + 1` strands anyone who MISSES a rotation — offline
 * through it, or behind an auth-gating relay: the channel moves on without them
 * and the address they poll is never published again. They keep a key that
 * decrypts nothing while the channel still sits in their sidebar, and no later
 * rotation can tell them they were removed. A window lets the client catch up
 * (or learn it is out) across any gap up to this depth; the cost is one extra
 * author per epoch per held root on a filter that is already author-scoped.
 */
export const CHANNEL_REKEY_LOOKAHEAD = 8;

const ZERO32 = new Uint8Array(32);
const ZERO32_HEX = "0".repeat(64);
export { ZERO32_HEX as ROOT_SCOPE_HEX };

/** A rotation's scope: one Private Channel, or the community_root (a Refounding). */
export type RekeyScope =
  { kind: "channel"; channelId: Uint8Array } | { kind: "root" };

/** The 32-byte scope id: the channel id, or all-zeroes for the root. */
export function rekeyScopeId(scope: RekeyScope): Uint8Array {
  return scope.kind === "channel" ? scope.channelId : ZERO32;
}

// ── The wrapped plaintext ────────────────────────────────────────────────────

function readScopeAndEpoch(plain: Uint8Array): {
  scopeIdHex: string;
  epoch: bigint;
} {
  return {
    scopeIdHex: bytesToHex(plain.slice(0, 32)),
    epoch: new DataView(plain.buffer, plain.byteOffset).getBigUint64(32, false),
  };
}

/**
 * Parse + verify a decrypted 72-byte CHANNEL blob against the event's tags.
 *
 * The scope and epoch live INSIDE the ciphertext, and are checked against what
 * the event claims — that is what makes a blob unspliceable, so one minted for
 * another channel (or for the base) can never be replayed onto this one.
 */
export function decodeWrappedKey(
  plain: Uint8Array,
  expectedScopeId: Uint8Array,
  expectedEpoch: bigint,
): Uint8Array {
  if (plain.length !== 72) {
    throw new Error(`wrapped key must be 72 bytes, got ${plain.length}`);
  }
  const { scopeIdHex, epoch } = readScopeAndEpoch(plain);
  if (scopeIdHex !== bytesToHex(expectedScopeId)) {
    throw new Error("wrapped key scope mismatch");
  }
  if (epoch !== expectedEpoch) throw new Error("wrapped key epoch mismatch");
  return plain.slice(40, 72);
}

/** A parsed base-rotation blob (CORD-06 §1); the width declared the form. */
export interface WrappedBaseKey {
  newRoot: Uint8Array;
  /**
   * The next epoch's Control Plane address (hex) — absent on a legacy 72-byte
   * blob, whose acceptor folds that epoch's Control at the legacy
   * member-derivable address instead (CORD-06 §3).
   */
  controlPk?: string;
  /** The staff write secret (136-byte form only), verified to derive to `controlPk`. */
  controlRoot?: Uint8Array;
}

/**
 * Parse + verify a decrypted BASE blob (CORD-06 §1). Accepts the three fixed
 * widths — 72 (legacy pre-split), 104 (member), 136 (staff) — and drops any
 * other as malformed.
 *
 * A 136-byte blob's `new_control_root` must derive to exactly its
 * `new_control_pk` (CORD-02 §5): a mismatched pair is refused WHOLE rather than
 * adopting a plane split from its own readers.
 */
export function decodeWrappedBaseKey(
  plain: Uint8Array,
  communityId: Uint8Array,
  expectedEpoch: bigint,
): WrappedBaseKey {
  if (plain.length !== 72 && plain.length !== 104 && plain.length !== 136) {
    throw new Error(
      `wrapped base key must be 72, 104 or 136 bytes, got ${plain.length}`,
    );
  }
  const { scopeIdHex, epoch } = readScopeAndEpoch(plain);
  if (scopeIdHex !== ZERO32_HEX) throw new Error("wrapped key scope mismatch");
  if (epoch !== expectedEpoch) throw new Error("wrapped key epoch mismatch");
  const newRoot = plain.slice(40, 72);
  if (plain.length === 72) return { newRoot };
  const controlPk = bytesToHex(plain.slice(72, 104));
  if (plain.length === 104) return { newRoot, controlPk };
  const controlRoot = plain.slice(104, 136);
  if (
    controlSignerGroupKey(controlRoot, communityId, expectedEpoch).pk !==
    controlPk
  ) {
    throw new Error("wrapped control_root does not derive to its control_pk");
  }
  return { newRoot, controlPk, controlRoot };
}

/** base64 → bytes, for carrying the blob through string-only nip44 signers. */
export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── The 3303 rumor ───────────────────────────────────────────────────────────

/** One located, wrapped key. */
export interface RekeyBlob {
  /** Where its recipient finds it (hex of the recipient locator). */
  locator: string;
  /** NIP-44 ciphertext under the rotator↔recipient pairwise key. */
  wrapped: string;
}

export interface ParsedRekey {
  /** The rotator's real pubkey (the seal's signer). */
  rotator: string;
  scopeIdHex: string;
  newEpoch: bigint;
  prevEpoch: bigint;
  prevCommit: string;
  chunkIndex: number;
  chunkCount: number;
  blobs: RekeyBlob[];
  /** ms of the rumor (ordering / correlation aid). */
  ms: number;
  /** The CORD-04 §5 citation the rotator acts under (absent when the owner acts). */
  authority?: AuthorityCitation;
}

/** Parse an opened rekey stream event into its rotation fields. */
export function parseRekey(opened: OpenedEvent): ParsedRekey {
  if (opened.kind !== KIND_REKEY) throw new Error("not a rekey rumor");
  // Checked while the seal form is known (an event still holding its wrap); a
  // stored rumor has no envelope and passed this at ingest.
  if (
    opened.sealKind !== undefined &&
    opened.sealKind !== KIND_SEAL_ENCRYPTED
  ) {
    throw new Error("rekey seals must be encrypted (CORD-02 §5)");
  }
  const get = (name: string) => opened.tags.find((t) => t[0] === name);
  const scope = get("scope")?.[1];
  const newEpoch = get("newepoch")?.[1];
  const prevEpoch = get("prevepoch")?.[1];
  const prevCommit = get("prevcommit")?.[1];
  const chunk = get("chunk");
  if (!scope || !/^[0-9a-f]{64}$/i.test(scope))
    throw new Error("bad scope tag");
  if (!isTagDecimal(newEpoch)) throw new Error("bad newepoch tag");
  if (!isTagDecimal(prevEpoch)) throw new Error("bad prevepoch tag");
  if (!prevCommit || !/^[0-9a-f]{64}$/i.test(prevCommit)) {
    throw new Error("bad prevcommit tag");
  }
  // Spec-shaped decimals, not `Number()` — that would take "1e2", "0x2" and
  // " 2 " as chunk coordinates a stricter peer refuses.
  if (chunk && (!isTagDecimal(chunk[1]) || !isTagDecimal(chunk[2]))) {
    throw new Error("bad chunk tag");
  }
  const chunkIndex = chunk ? Number(chunk[1]) : 1;
  const chunkCount = chunk ? Number(chunk[2]) : 1;
  if (chunkIndex < 1 || chunkCount < 1 || chunkIndex > chunkCount) {
    throw new Error("bad chunk tag");
  }
  let blobs: RekeyBlob[];
  try {
    const parsed = JSON.parse(opened.content) as RekeyBlob[];
    blobs = Array.isArray(parsed)
      ? parsed.filter(
          (b) =>
            b && typeof b.locator === "string" && typeof b.wrapped === "string",
        )
      : [];
  } catch {
    throw new Error("bad rekey content");
  }
  return {
    rotator: opened.author,
    scopeIdHex: scope.toLowerCase(),
    newEpoch: BigInt(newEpoch),
    prevEpoch: BigInt(prevEpoch),
    prevCommit: prevCommit.toLowerCase(),
    chunkIndex,
    chunkCount,
    blobs,
    ms: opened.ms,
    authority: citationFromTags(opened.tags),
  };
}

export interface RekeyRotationSet {
  rotator: string;
  scopeIdHex: string;
  newEpoch: bigint;
  prevEpoch: bigint;
  prevCommit: string;
  chunkCount: number;
  /** chunkIndex → chunk. */
  chunks: Map<number, ParsedRekey>;
  complete: boolean;
  /**
   * The rotation's authority citation, taken from its first chunk. Every chunk
   * of one rotation carries identical authority fields (CORD-06 §2), so a
   * disagreeing chunk is the caller's cue to distrust the set — mirrored on the
   * continuity fields, which are already part of the correlation key.
   */
  authority?: AuthorityCitation;
}

/**
 * Group parsed rekey chunks into rotations. Chunks correlate by
 * (rotator, scope, newepoch, prevcommit), so two rotators concurrently rekeying
 * the same epoch never merge into one set (CORD-06 §2). A rotation is COMPLETE
 * only when all `n` chunks are held — a missing chunk is never a removal.
 */
export function groupRotations(parsed: ParsedRekey[]): RekeyRotationSet[] {
  const byKey = new Map<string, RekeyRotationSet>();
  for (const p of parsed) {
    const key = `${p.rotator}:${p.scopeIdHex}:${p.newEpoch}:${p.prevCommit}`;
    let set = byKey.get(key);
    if (!set) {
      byKey.set(
        key,
        (set = {
          rotator: p.rotator,
          scopeIdHex: p.scopeIdHex,
          newEpoch: p.newEpoch,
          prevEpoch: p.prevEpoch,
          prevCommit: p.prevCommit,
          chunkCount: p.chunkCount,
          chunks: new Map(),
          complete: false,
          authority: p.authority,
        }),
      );
    }
    if (p.chunkCount === set.chunkCount) set.chunks.set(p.chunkIndex, p);
  }
  for (const set of byKey.values()) {
    set.complete = set.chunks.size >= set.chunkCount;
  }
  return [...byKey.values()];
}

/**
 * Verify a rotation's CONTINUITY against the key we currently hold: the
 * commitment over (prevEpoch, heldKey) must equal the event's `prevcommit`.
 *
 * A mismatch with a HIGHER prevepoch means we missed a rotation (fetch the gap
 * first); any other mismatch is a fork or garbage — reject (CORD-06 §2).
 */
export function checkContinuity(
  set: { prevEpoch: bigint; prevCommit: string },
  heldEpoch: bigint,
  heldKey: Uint8Array,
): { ok: true } | { ok: false; reason: "gap" | "fork" } {
  if (set.prevEpoch === heldEpoch) {
    const commit = bytesToHex(epochKeyCommitment(heldEpoch, heldKey));
    return commit === set.prevCommit
      ? { ok: true }
      : { ok: false, reason: "fork" };
  }
  return { ok: false, reason: set.prevEpoch > heldEpoch ? "gap" : "fork" };
}

/** Find our blob across a rotation's chunks by locator. */
export function findBlob(
  set: RekeyRotationSet,
  locatorHex: string,
): RekeyBlob | undefined {
  for (const chunk of set.chunks.values()) {
    const hit = chunk.blobs.find((b) => b.locator === locatorHex);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * When did this rotation publish? The newest of its chunks' rumor ms. Used to
 * tell a removal apart from community history.
 */
export function rotationPublishedAtMs(set: RekeyRotationSet): number {
  let newest = 0;
  for (const chunk of set.chunks.values())
    if (chunk.ms > newest) newest = chunk.ms;
  return newest;
}

/**
 * Does a complete rotation carrying no blob for us actually EXCLUDE us, or is it
 * community history that predates our membership?
 *
 * A member who joins via a stale public invite (bundle epoch N) lands ON a
 * historical `N→N+1` Refounding they were never part of. It is continuity-valid
 * and complete, yet has no blob at their locator — but it published before they
 * joined, so it must not be read as a removal. Only a rotation published
 * at/after the join can exclude (CORD-06).
 *
 * Clock skew only ever fails toward KEEPING access, which is safe: key
 * rotation, not this predicate, enforces post-removal secrecy.
 */
export function rotationExcludesMe(
  rotatedAtMs: number,
  joinedAtMs: number,
): boolean {
  return rotatedAtMs >= joinedAtMs;
}

/**
 * Race convergence (CORD-06 §3): among authorized candidates at the same
 * continuity point, the lexicographically lowest NEW KEY wins. Both keys stay
 * held, so messages sent into the losing fork stay readable; only the chain
 * converges.
 */
export function lowerKeyWins(a: Uint8Array, b: Uint8Array): Uint8Array {
  return bytesToHex(a) <= bytesToHex(b) ? a : b;
}

/** Our locator for a rotation (public inputs only — bunker-friendly). */
export function myLocator(
  rotatorHex: string,
  myHex: string,
  scopeIdHex: string,
  newEpoch: bigint,
): string {
  const hexToBytes32 = (h: string) => {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++)
      out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
  return bytesToHex(
    recipientLocator(
      hexToBytes32(rotatorHex),
      hexToBytes32(myHex),
      hexToBytes32(scopeIdHex),
      newEpoch,
    ),
  );
}
