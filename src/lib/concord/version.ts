/**
 * Per-entity version chains for Control Plane editions — CORD-04 §1.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/version.ts`). Wire format:
 * the edition hash is what the next edition's `ep` cites, so a change here
 * forks every chain.
 *
 * Every entity (Role, Grant, Banlist, metadata, Registry) is a sequence of
 * editions, each carrying a monotonic `version` + the hash of its predecessor.
 * Clients fold the fetched set into the current head: refuse-downgrade,
 * deterministic equal-version tiebreak (lower rumor id), and contiguous
 * chain-walk with gap detection (fail closed) — except across a Refounding,
 * where a fresh joiner accepts the highest authority-verified head despite a
 * dangling `prev` ({@link bootstrapHead}).
 */

import { sha256 } from "@noble/hashes/sha2.js";

/**
 * The edition-hash domain label — CORD-04 §1, frozen. (Yes, it says "v1": the
 * spec pins this exact string; renaming it would re-hash every chain.)
 */
const EDITION_LABEL = "vector-community/v1/edition";

function u64be(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, false);
  return out;
}

/**
 * The length-prefixed, domain-separated preimage an edition's identity commits
 * to (CORD-04 §1, frozen):
 * `len64(label) ‖ label ‖ entity_id[32] ‖ version_be[8] ‖ has_prev(1) ‖
 *  prev_hash[32 or zero] ‖ len64(content) ‖ content`.
 * `content` is hashed as the exact bytes on the wire, never re-serialized.
 */
export function editionPreimage(
  entityId: Uint8Array,
  version: bigint,
  prevHash: Uint8Array | undefined,
  content: Uint8Array,
): Uint8Array {
  const labelBytes = new TextEncoder().encode(EDITION_LABEL);
  const parts: Uint8Array[] = [
    u64be(BigInt(labelBytes.length)),
    labelBytes,
    entityId,
    u64be(version),
    new Uint8Array([prevHash ? 1 : 0]),
    prevHash ?? new Uint8Array(32),
    u64be(BigInt(content.length)),
    content,
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** SHA-256 of {@link editionPreimage} — what the next edition's `ep` cites. */
export function editionHash(
  entityId: Uint8Array,
  version: bigint,
  prevHash: Uint8Array | undefined,
  content: Uint8Array,
): Uint8Array {
  return sha256(editionPreimage(entityId, version, prevHash, content));
}

/** One fetched edition of an entity, reduced to what the fold needs. */
export interface Edition {
  version: bigint;
  prevHash?: Uint8Array;
  /** `editionHash` of THIS edition. */
  selfHash: Uint8Array;
  createdAt: number;
  /** Rumor id bytes — the deterministic equal-version tiebreak. */
  tiebreakId: Uint8Array;
}

export interface FoldResult {
  /** Index of the chosen head edition, or null if nothing folds. */
  head: number | null;
  /** A higher version exists but doesn't link contiguously — fail closed + refetch. */
  gap: boolean;
}

function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function bytesEq(
  a: Uint8Array | undefined,
  b: Uint8Array | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && cmpBytes(a, b) === 0;
}

/**
 * Fold a set of editions for ONE entity into its current head, chain-checked.
 * `floor` is the highest version already accepted (0n = none), `floorHash`
 * that held edition's selfHash.
 */
export function fold(
  editions: Edition[],
  floor: bigint,
  floorHash?: Uint8Array,
): FoldResult {
  // Per-version winner (equal-version fork → lower tiebreakId). Skip below-floor.
  const byVersion = new Map<bigint, number>();
  for (let i = 0; i < editions.length; i++) {
    const e = editions[i];
    if (e.version < floor) continue;
    const j = byVersion.get(e.version);
    if (j === undefined || cmpBytes(e.tiebreakId, editions[j].tiebreakId) < 0) {
      byVersion.set(e.version, i);
    }
  }
  const versions = [...byVersion.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (versions.length === 0) return { head: null, gap: false };

  const lo = editions[byVersion.get(versions[0])!];
  let anchored: boolean;
  if (floor === 0n) {
    anchored = versions[0] === 1n && lo.prevHash === undefined;
  } else if (versions[0] === floor) {
    anchored = floorHash !== undefined && bytesEq(floorHash, lo.selfHash);
  } else if (versions[0] === floor + 1n) {
    anchored = floorHash !== undefined && bytesEq(lo.prevHash, floorHash);
  } else {
    anchored = false;
  }
  let gap = !anchored;

  let headIdx = byVersion.get(versions[0])!;
  for (let k = 0; k + 1 < versions.length; k++) {
    const loIdx = byVersion.get(versions[k])!;
    const hiIdx = byVersion.get(versions[k + 1])!;
    const linked =
      versions[k + 1] === versions[k] + 1n &&
      bytesEq(editions[hiIdx].prevHash, editions[loIdx].selfHash);
    if (linked) {
      headIdx = hiIdx;
    } else {
      gap = true;
      break;
    }
  }
  return { head: headIdx, gap };
}

/**
 * The head a BOOTSTRAPPING client accepts after a Refounding's compaction
 * (CORD-04 §1): the per-version winner at the highest present version,
 * ignoring chain contiguity — there is nothing behind a compacted head to
 * verify; the signature plus the current-authority check is the whole test.
 */
export function bootstrapHead(
  editions: Edition[],
  floor: bigint,
): number | null {
  let best: number | null = null;
  for (let i = 0; i < editions.length; i++) {
    const e = editions[i];
    if (e.version < floor) continue;
    if (best === null) {
      best = i;
    } else {
      const cur = editions[best];
      if (
        e.version > cur.version ||
        (e.version === cur.version &&
          cmpBytes(e.tiebreakId, cur.tiebreakId) < 0)
      ) {
        best = i;
      }
    }
  }
  return best;
}
