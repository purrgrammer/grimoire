/**
 * Concord core types — the runtime model the rest of the client operates on.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/types.ts`), minus armada's Git
 * attachment extension (which needs its own parser) and minus the voice keys
 * (CORD-07 is out of scope). Both are recoverable from the reference if wanted.
 *
 * Fields grimoire never READS are still carried where the Community List
 * round-trips them (`Community.controlRoot`): that document is replaceable and
 * one per user, so dropping a field here deletes it for every other client the
 * user runs.
 *
 * Ids and keys are raw 32-byte values in memory (lowercase hex on the wire). A
 * Community's identity (`community_id`) is a self-certifying commitment to its
 * owner; its access (`community_root`) is a separate 32-byte secret so access
 * can rotate while identity stays fixed (CORD-02 §1–2).
 */

import type { GroupKey } from "@/lib/concord/derive";

/** Protocol recommendation for a community's relay set (CORD-02 §6). */
export const MAX_COMMUNITY_RELAYS = 5;

/** Community/channel/role name cap: 64 bytes of UTF-8 (CORD-02 §6). */
export const NAME_MAX_BYTES = 64;
/** Community description cap: 10,000 bytes of UTF-8 (CORD-02 §6). */
export const DESCRIPTION_MAX_BYTES = 10_000;
/** Hostile-bundle bound: reject an invite carrying more channels than this (CORD-05 §1). */
export const MAX_BUNDLE_CHANNELS = 256;
/** The Community List caps at 50 memberships (CORD-02 §8). */
export const MAX_LIST_MEMBERSHIPS = 50;

/** Dedupe (order-preserving) + truncate a relay set to the recommended cap. */
export function capRelays(
  relays: string[],
  cap = MAX_COMMUNITY_RELAYS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of relays) {
    if (out.length >= cap) break;
    if (typeof r === "string" && r && !seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

/** Byte length of a string as UTF-8. */
export function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * An encrypted-blob pointer (icon / banner): the media host stores ciphertext,
 * the per-image key + nonce ride inside member-sealed metadata, and `hash` is
 * the SHA-256 of the plaintext so a swapped blob fails closed (CORD-02 §6).
 */
export interface ImagePointer {
  url: string;
  /** Hex AES-256-GCM key. */
  key: string;
  /** Hex AES-GCM nonce/IV. */
  nonce: string;
  /** Hex SHA-256 of the plaintext. */
  hash: string;
}

/** Runtime check that a value is a plausible {@link ImagePointer}. */
export function isImagePointer(v: unknown): v is ImagePointer {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.url === "string" &&
    typeof o.key === "string" &&
    typeof o.nonce === "string" &&
    typeof o.hash === "string"
  );
}

/** Community metadata — the vsk=0 Control Plane entity's content (CORD-02 §6). */
export interface CommunityMetadata {
  name: string;
  description?: string;
  /** The Community's evolving relay set (the fold is the authority). */
  relays: string[];
  icon?: ImagePointer;
  banner?: ImagePointer;
  /**
   * Disappearing-messages timer in seconds (CORD-08): while set, every durable
   * chat-plane rumor (except deletes and timer notices) carries a NIP-40
   * `expiration` of its send time plus this. Absent, 0, or malformed = off;
   * read through `messageExpirationOf`, never directly.
   */
  message_expiration?: number;
  /** Client-extensible opaque fields; editors MUST round-trip what they don't understand. */
  custom?: Record<string, unknown>;
  /** Unknown top-level fields, preserved for round-tripping. */
  [k: string]: unknown;
}

/** Channel metadata — the vsk=2 Control Plane entity's content (CORD-03 §2). */
export interface ChannelMetadata {
  name: string;
  private: boolean;
  /** Terminal: the id is never reused; clients drop the Channel from display. */
  deleted?: boolean;
  custom?: Record<string, unknown>;
  [k: string]: unknown;
}

/** A private Channel's independent key material, as delivered by an invite. */
export interface PrivateChannelKey {
  /** Channel id (32 bytes). */
  id: Uint8Array;
  /** Independent random key (32 bytes) — cryptographically unrelated to the root. */
  key: Uint8Array;
  epoch: bigint;
  /** Join-time preview name; the ChannelMetadata fold is the authority. */
  name: string;
  /**
   * Superseded keys for this channel, retained so HISTORY stays readable across
   * rotations. A rotation re-keys the channel forward; without the priors, every
   * message sealed under an earlier epoch becomes undecryptable to a member who
   * is still fully entitled — the conversation would appear to start over on
   * every revoke. Read-only: never used to write.
   *
   * `retiredAt` is the epoch-seconds the superseding rotation published: the
   * hard read cutoff for the retired key. Anything sealed under it with a later
   * `created_at` is refused — a retired epoch is history, never a live channel
   * an ejected keyholder can keep writing into. Absent for keys retired before
   * cutoffs were recorded (those decode uncapped).
   */
  priors?: Array<{ key: Uint8Array; epoch: bigint; retiredAt?: number }>;
}

/** A held root-key epoch (the current one plus retained priors for history). */
export interface HeldRoot {
  epoch: bigint;
  key: Uint8Array;
  /**
   * The epoch's Control Plane signer pubkey (`control_pk`, x-only hex) — HELD,
   * never derived: it derives from a `control_root` only the owner and staff
   * hold (CORD-02 §2), and arrives in invites, base rekey blobs, and the
   * Community List. Present = a split epoch (subscribe and verify by this
   * address, decrypt under the community_root-derived read key); absent = a
   * LEGACY pre-split epoch, whose Control Plane folds at the member-derivable
   * `concord/control` address (CORD-02 §5).
   */
  controlPk?: string;
  /**
   * Epoch-seconds the rotation that superseded this root published — the hard
   * read cutoff for everything derived from it (see the priors doc above).
   * Absent on the current root, and on roots retired before cutoffs existed.
   */
  retiredAt?: number;
  /**
   * The npub whose Refounding minted this epoch (x-only hex) — the snapshot
   * authority for ITS Guestbook (CORD-02 §5: a snapshot "is honored only from
   * the npub whose Refounding minted that epoch"). Recorded so historical
   * epochs' snapshots stay verifiable after the rotator's rank has moved on.
   * Absent at genesis (the owner) and on epochs adopted before this existed.
   */
  refounder?: string;
}

/**
 * A Concord community as the client holds it — rehydrated from the Community
 * List entry (join material). Channel DEFINITIONS live on the Control Plane;
 * this carries only identity, access keys, and the private-channel keys the
 * member holds.
 */
export interface Community {
  id: Uint8Array;
  idHex: string;
  /** The proven owner (x-only hex) — verified against the id commitment. */
  owner: string;
  ownerSalt: Uint8Array;
  /** The current community_root at `rootEpoch`. */
  root: Uint8Array;
  rootEpoch: bigint;
  /**
   * The CURRENT epoch's Control Plane signer pubkey (see
   * {@link HeldRoot.controlPk}); absent on a legacy pre-split epoch. Mirrors the
   * current entry in `heldRoots`, the way `root`/`rootEpoch` do.
   */
  controlPk?: string;
  /**
   * The CURRENT epoch's staff write secret (`control_root`, CORD-02 §2), held
   * only by the owner and staff.
   *
   * Grimoire NEVER uses this — it publishes nothing to the Control Plane — and
   * carries it for one reason: so a Community List write-back preserves it.
   * Kind 13302 is replaceable, one per user, so a client that rehydrates an
   * entry without this field and writes the entry back deletes a staff
   * member's write key in EVERY client they use, recoverable only by a
   * re-grant from another staffer. Same round-trip discipline as
   * `MemberGrant.controlWrap`, and the same reason.
   */
  controlRoot?: Uint8Array;
  /** Every held root epoch (current + retained priors), newest first. */
  heldRoots: HeldRoot[];
  /** Private-channel keys held (public channels derive from the root). */
  privateChannels: PrivateChannelKey[];
  relays: string[];
  /** Join-time preview name; the metadata fold is the authority. */
  name: string;
  /** The npub whose Refounding minted the current epoch (snapshot authority). */
  refounder?: string;
}

/**
 * One channel as the UI consumes it: folded definition + derived stream keys.
 *
 * No `voice` member — grimoire does not do calls, so a Channel's CORD-07
 * coordinates are never derived.
 */
export interface Channel {
  id: Uint8Array;
  idHex: string;
  name: string;
  isPrivate: boolean;
  /** Sidebar grouping (`armada.category`); undefined renders ungrouped. */
  category?: string;
  /** Sidebar position (`armada.order`); undefined sorts last, by name. */
  position?: number;
  /**
   * Stream keys across every held epoch, newest first (reads span rekeys). A
   * retired epoch carries its rotation's publish time as `retiredAt` — the
   * decode path refuses anything sealed under it with a later `created_at`.
   */
  streams: Array<{ epoch: bigint; group: GroupKey; retiredAt?: number }>;
  /** The current write coordinate. */
  current: { epoch: bigint; group: GroupKey };
}
