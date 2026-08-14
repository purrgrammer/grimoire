/**
 * Concord Community List — CORD-02 §8, READ HALF ONLY.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/communityList.ts`).
 *
 * A member's memberships sync across devices (and clients) as one kind-13302
 * replaceable event, NIP-44-encrypted to self. Every community they're in AND
 * every one they've left lives in the document — liveness is DERIVED, never
 * deletion, or merges would depend on gossip order.
 *
 * Per entry, two snapshots solve opposite problems: `seed` holds the EARLIEST
 * epoch ever held (the full-history backfill anchor) and `current` the LATEST
 * (instant reconstruction on a fresh device).
 *
 * **Grimoire never writes this document.** Armada owns it. So the merge CRDT
 * (`mergeCommunityLists`, `union*`, `refresh*`, `addToList`, …) and the
 * serializer (`toJoinMaterial`) are deliberately NOT ported — not as an
 * oversight, as the guarantee. Kind 13302 is replaceable and one per user, so a
 * write that drops a field the writer didn't understand deletes it in every
 * other client that user runs; the surest way not to do that is to have no
 * write path at all. If a later phase needs one, port armada's whole merge —
 * including `toJoinMaterial`'s round-tripping of `prior` — rather than
 * hand-rolling a serializer from these types.
 */

import {
  controlSignerGroupKey,
  hex32,
  verifyCommunityId,
} from "@/lib/concord/derive";
import {
  capRelays,
  type Community,
  type HeldRoot,
  type PrivateChannelKey,
} from "@/lib/concord/types";

/**
 * Join material — the invite bundle's MEMBERSHIP subset (never the icon, never
 * the link fields). Snake_case wire shape; unknown fields are preserved. The
 * `held_roots` field is an armada extension carrying retained prior root epochs
 * so history spanning a Refounding stays readable without a rekey-chain walk.
 */
export interface JoinMaterial {
  community_id: string;
  owner: string;
  owner_salt: string;
  community_root: string;
  root_epoch: number;
  /**
   * The current epoch's Control Plane signer pubkey (CORD-02 §2/§8) — read
   * access to the plane, never write. Absent = a legacy pre-split epoch, whose
   * Control folds at the member-derivable legacy address.
   */
  control_pk?: string;
  /**
   * Armada extension, STAFF ONLY: the current epoch's `control_root` write
   * secret (hex). Grimoire never publishes to the Control Plane and so never
   * uses it — it is read only so a staffer's own entry keeps meaning what it
   * says when this client displays it.
   */
  control_root?: string;
  /** The PRIVATE channels held (public ones derive from the root — CORD-03). */
  channels: Array<{
    id: string;
    key: string;
    epoch: number;
    name: string;
    priors?: Array<{ key: string; epoch: number; retired_at?: number }>;
  }>;
  relays: string[];
  name: string;
  /**
   * Armada extension: retained prior roots. `retired_at` is the hard read
   * cutoff for that epoch; `refounder` names the npub whose Refounding minted
   * it (its Guestbook's snapshot authority, CORD-02 §5); `control_pk` names a
   * split epoch's Control address (absent = legacy).
   */
  held_roots?: Array<{
    epoch: number;
    key: string;
    retired_at?: number;
    refounder?: string;
    control_pk?: string;
  }>;
  /** Armada extension: the npub whose Refounding minted `root_epoch`. */
  refounder?: string;
  [k: string]: unknown;
}

export interface CommunityListEntry {
  community_id: string;
  /** Earliest epoch held — the full-history backfill anchor. */
  seed: JoinMaterial;
  /** Freshest snapshot — replaced on every Refounding or rename. */
  current: JoinMaterial;
  /** ms; tiebreaks against a tombstone. */
  added_at: number;
  /**
   * The Refounding epoch that EXCLUDED me (a kick/ban rekey that carried no
   * blob for me). Being excluded is NOT leaving: the entry stays LIVE, but
   * read-only — my keys can't decrypt this epoch.
   */
  excluded_at_epoch?: number;
  /**
   * Armada extension: per Private Channel, the CHANNEL epoch whose rotation cut
   * me out (CORD-06 §2). A cut floors the channel: only a key at or above the
   * cut epoch — a genuine re-admission — is ever accepted again.
   */
  channel_cuts?: Array<{ id: string; epoch: number }>;
  /** Armada extension: the invite link this membership was joined through. */
  invite_ref?: string;
  [k: string]: unknown;
}

export interface CommunityTombstone {
  community_id: string;
  /** ms. Permanent — pruning would let a long-offline device resurrect a leave. */
  removed_at: number;
  [k: string]: unknown;
}

export interface CommunityList {
  entries: CommunityListEntry[];
  tombstones: CommunityTombstone[];
  [k: string]: unknown;
}

export const EMPTY_COMMUNITY_LIST: CommunityList = {
  entries: [],
  tombstones: [],
};

/**
 * Parse a decrypted list document, tolerating anything.
 *
 * The document is written by other clients and other versions, so the two
 * arrays are the only things this file may assume; everything else rides
 * through as unknown fields.
 */
export function parseCommunityList(json: string): CommunityList {
  const parsed = JSON.parse(json) as Partial<CommunityList>;
  return {
    ...parsed,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
  } as CommunityList;
}

/**
 * The Private Channel keys a join-material snapshot holds.
 *
 * `channels` is required by the shape, but the list is a CROSS-CLIENT document
 * and Private Channels are optional (CORD-03) — a client that vends no keys
 * omits the field. Every reader goes through here so that fact lives in ONE
 * place: the type promises an array while the wire promises nothing.
 */
export function heldChannelKeys(
  channels: JoinMaterial["channels"] | undefined,
): JoinMaterial["channels"] {
  return Array.isArray(channels) ? channels : [];
}

/** Drop channel keys a cut has floored out (epoch below the cut). */
export function applyChannelCuts(
  channels: JoinMaterial["channels"] | undefined,
  cuts: CommunityListEntry["channel_cuts"],
): JoinMaterial["channels"] {
  const held = heldChannelKeys(channels);
  if (!cuts?.length) return held;
  const floor = new Map<string, number>();
  for (const cut of cuts) {
    if (!cut || typeof cut.id !== "string" || typeof cut.epoch !== "number") {
      continue;
    }
    // CORD-01: hex is lowercase — but this document is written by other
    // clients, so the spelling is normalized rather than trusted. A floor that
    // string-compares ids lets an uppercase respelling of a revoked key walk
    // straight past it.
    const id = cut.id.toLowerCase();
    const prev = floor.get(id);
    if (prev === undefined || cut.epoch > prev) floor.set(id, cut.epoch);
  }
  return held.filter((ch) => {
    const cut = floor.get(String(ch.id).toLowerCase());
    return cut === undefined || ch.epoch >= cut;
  });
}

/** Whether an entry is live: no tombstone, or the add is newer than the removal. */
export function isLive(list: CommunityList, communityId: string): boolean {
  const entry = list.entries.find((e) => e.community_id === communityId);
  if (!entry) return false;
  const tomb = list.tombstones.find((t) => t.community_id === communityId);
  return !tomb || entry.added_at > tomb.removed_at;
}

/** The live entries (memberships), derived. */
export function liveEntries(list: CommunityList): CommunityListEntry[] {
  return list.entries.filter((e) => isLive(list, e.community_id));
}

/**
 * Whether the member has been EXCLUDED at their current epoch — a kick/ban
 * Refounding they got no key for. The community stays live, but renders
 * read-only: the member can't decrypt this epoch.
 *
 * The marker names the epoch minted WITHOUT them, so exclusion holds only while
 * that epoch is beyond what they hold — strictly greater. Holding the marked
 * epoch's own root IS re-inclusion, however it arrived.
 */
export function isExcluded(entry: CommunityListEntry): boolean {
  return (
    typeof entry.excluded_at_epoch === "number" &&
    entry.excluded_at_epoch > entry.current.root_epoch
  );
}

// ── Join material → runtime community ────────────────────────────────────────

/** 64 lowercase-hex chars, or undefined. */
function asHex32(v: unknown): string | undefined {
  return typeof v === "string" && /^[0-9a-f]{64}$/i.test(v)
    ? v.toLowerCase()
    : undefined;
}

/** A positive integer epoch-seconds cutoff, or undefined. */
function asCutoff(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : undefined;
}

/**
 * Rehydrate a runtime {@link Community} from an entry. Verifies the
 * self-certifying owner commitment (a corrupted entry fails closed).
 *
 * Two deliberate differences from armada, both narrowings:
 *
 * - **`channel_cuts` are applied here.** Armada floors the key set inside its
 *   list merge, so by the time it rehydrates the stored set is already floored.
 *   Grimoire has no merge, so the floor moves to the read boundary — same
 *   invariant, enforced where this client can enforce it. Without it a stale
 *   bundle merged by another client could hand us a revoked channel key.
 * - **No `extraRelays` parameter.** Armada's takes one and its own comment
 *   warns callers not to pass app relays: a relay storing no Concord wraps
 *   answers every plane REQ with an instant empty EOSE and can win the
 *   backfill's page race, starving the real relays. Concord traffic belongs
 *   only on the community's own relays, so the parameter simply does not exist
 *   here and the mistake is unrepresentable.
 */
export function rehydrateCommunity(
  entry: CommunityListEntry,
): Community | undefined {
  const jm = entry.current;
  try {
    if (!verifyCommunityId(jm.community_id, jm.owner, jm.owner_salt)) {
      return undefined;
    }
    const id = hex32(jm.community_id);
    const root = hex32(jm.community_root);
    const rootEpoch = BigInt(jm.root_epoch);

    // The current head's refounder is the top-level field; retained roots carry
    // their own, so historical snapshot authority survives the walk.
    const currentRefounder = asHex32(jm.refounder);
    const controlPk = asHex32(jm.control_pk);
    const heldRoots: HeldRoot[] = [
      {
        epoch: rootEpoch,
        key: root,
        ...(currentRefounder ? { refounder: currentRefounder } : {}),
        ...(controlPk ? { controlPk } : {}),
      },
    ];
    for (const hr of jm.held_roots ?? []) {
      try {
        const epoch = BigInt(hr.epoch);
        if (epoch === rootEpoch) continue;
        const retiredAt = asCutoff(hr.retired_at);
        const refounder = asHex32(hr.refounder);
        const hrControlPk = asHex32(hr.control_pk);
        heldRoots.push({
          epoch,
          key: hex32(hr.key),
          ...(retiredAt !== undefined ? { retiredAt } : {}),
          ...(refounder ? { refounder } : {}),
          ...(hrControlPk ? { controlPk: hrControlPk } : {}),
        });
      } catch {
        // skip malformed retained roots
      }
    }
    // The staff write secret rides only when it still derives to the held
    // address for THIS epoch — a stale or corrupt secret fails closed to a
    // read-only view rather than signing at an address nobody reads (CORD-02
    // §5; a legacy epoch has no address for it to derive to).
    let controlRoot: Uint8Array | undefined;
    if (controlPk && asHex32(jm.control_root)) {
      const candidate = hex32(jm.control_root as string);
      if (controlSignerGroupKey(candidate, id, rootEpoch).pk === controlPk) {
        controlRoot = candidate;
      }
    }
    // Also anchor the seed's root when it's an epoch we don't otherwise hold.
    if (
      entry.seed &&
      entry.seed.community_root &&
      entry.seed.root_epoch !== jm.root_epoch
    ) {
      try {
        const seedEpoch = BigInt(entry.seed.root_epoch);
        if (!heldRoots.some((r) => r.epoch === seedEpoch)) {
          heldRoots.push({
            epoch: seedEpoch,
            key: hex32(entry.seed.community_root),
          });
        }
      } catch {
        // skip malformed seed
      }
    }
    heldRoots.sort((a, b) =>
      a.epoch > b.epoch ? -1 : a.epoch < b.epoch ? 1 : 0,
    );

    const privateChannels: PrivateChannelKey[] = [];
    for (const ch of applyChannelCuts(jm.channels, entry.channel_cuts)) {
      try {
        const priors: PrivateChannelKey["priors"] = [];
        for (const prior of Array.isArray(ch.priors) ? ch.priors : []) {
          try {
            const retiredAt = asCutoff(prior.retired_at);
            priors.push({
              key: hex32(prior.key),
              epoch: BigInt(prior.epoch),
              ...(retiredAt !== undefined ? { retiredAt } : {}),
            });
          } catch {
            // skip a malformed prior; the current key still stands
          }
        }
        privateChannels.push({
          id: hex32(ch.id),
          key: hex32(ch.key),
          epoch: BigInt(ch.epoch),
          name: typeof ch.name === "string" ? ch.name : "",
          ...(priors.length > 0 ? { priors } : {}),
        });
      } catch {
        // skip malformed channel entries
      }
    }

    return {
      id,
      idHex: jm.community_id.toLowerCase(),
      owner: jm.owner.toLowerCase(),
      ownerSalt: hex32(jm.owner_salt),
      root,
      rootEpoch,
      ...(controlPk ? { controlPk } : {}),
      ...(controlRoot ? { controlRoot } : {}),
      heldRoots,
      privateChannels,
      relays: capRelays(Array.isArray(jm.relays) ? jm.relays : []),
      name: typeof jm.name === "string" ? jm.name : "",
      refounder: currentRefounder,
    };
  } catch {
    return undefined;
  }
}
