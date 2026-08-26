/**
 * Concord Community List — CORD-02 §8, READ HALF ONLY.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/communityList.ts`).
 *
 * A member's memberships sync across devices (and clients) as a document
 * NIP-44-encrypted to self: kind 33302, one addressable event per FRAGMENT
 * (`d` = the index in decimal), and — before the List outgrew a single event —
 * the retired kind-13302 replaceable. Grimoire reads both and unions them
 * ({@link mergeCommunityLists}); every merge here is commutative and idempotent,
 * so a partial read is news not yet heard rather than a subtraction. Every
 * community they're in AND every one they've left lives in the document —
 * liveness is DERIVED, never deletion, or merges would depend on gossip order.
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
  /**
   * Optional, because it is redundant: §8 keys the entry by its own
   * `community_id`, and a writer may derive the snapshot's from it rather than
   * repeating it. One does — a fragment in the wild carries neither this nor a
   * `seed` — so a reader that requires it drops every membership in that
   * document. {@link rehydrateCommunity} falls back to the entry's.
   */
  community_id?: string;
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
  /**
   * Earliest epoch held — the full-history backfill anchor. Optional: a writer
   * in the wild omits it, and an entry with only a `current` is still a
   * membership (backfill then walks from that epoch instead).
   */
  seed?: JoinMaterial;
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

// ── §8 encoding: hex OR unpadded base64url ──────────────────────────────────

/** 64 lowercase-hex characters — the older spelling, and armada's today. */
const HEX32_RE = /^[0-9a-f]{64}$/i;
/** 43 characters of unpadded base64url — the spelling CORD-02 §8 now fixes. */
const B64URL32_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * A named 32-byte §8 value in whichever spelling it arrived, as lowercase hex.
 *
 * CORD-02 §8 makes every named 32-byte value in this document unpadded
 * base64url; earlier revisions (and armada today) write hex. A reader cannot
 * detect a MIS-encoded field — 64 lowercase hex characters are themselves valid
 * base64url — but the two correct spellings have different lengths, so
 * accepting both is unambiguous, and the spec's own warning applies: base64url
 * is case-significant, so only the hex branch may lower-case.
 *
 * Hex is the canonical form INSIDE grimoire: every derivation, every Dexie key
 * and every id comparison downstream is hex, and normalizing once at the parse
 * boundary is what keeps them all untouched. Grimoire never writes this
 * document, so nothing has to re-encode on the way out.
 */
export function canonical32(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  if (HEX32_RE.test(v)) return v.toLowerCase();
  if (!B64URL32_RE.test(v)) return undefined;
  try {
    const bin = atob(v.replace(/-/g, "+").replace(/_/g, "/") + "=");
    if (bin.length !== 32) return undefined;
    let hex = "";
    for (let i = 0; i < 32; i++) {
      hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    return undefined;
  }
}

/** Rewrite `obj[key]` to canonical hex when it holds a recognisable 32 bytes. */
function canonField(obj: Record<string, unknown> | undefined, key: string) {
  if (!obj) return;
  const canon = canonical32(obj[key]);
  if (canon !== undefined) obj[key] = canon;
}

/** Canonicalize one join-material snapshot in place. */
function canonJoinMaterial(jm: Record<string, unknown> | undefined) {
  if (!jm || typeof jm !== "object") return;
  for (const key of [
    "community_id",
    "owner",
    "owner_salt",
    "community_root",
    "control_pk",
    "control_root",
    "refounder",
  ]) {
    canonField(jm, key);
  }
  for (const ch of Array.isArray(jm.channels) ? jm.channels : []) {
    if (!ch || typeof ch !== "object") continue;
    const channel = ch as Record<string, unknown>;
    canonField(channel, "id");
    canonField(channel, "key");
    for (const prior of Array.isArray(channel.priors) ? channel.priors : []) {
      if (prior && typeof prior === "object") {
        canonField(prior as Record<string, unknown>, "key");
      }
    }
  }
  for (const hr of Array.isArray(jm.held_roots) ? jm.held_roots : []) {
    if (!hr || typeof hr !== "object") continue;
    const root = hr as Record<string, unknown>;
    canonField(root, "key");
    canonField(root, "refounder");
    canonField(root, "control_pk");
  }
}

/**
 * Normalize every named 32-byte value in a parsed document to hex, in place.
 *
 * Only the fields §8 names (plus armada's own extensions, which spell theirs
 * the same way) are touched. An unknown field keeps its author's encoding
 * verbatim and is never decoded — §8's rule, and the reason the boundary has to
 * be a fixed list rather than a shape guess.
 */
function canonicalizeList(list: CommunityList): CommunityList {
  for (const entry of list.entries) {
    if (!entry || typeof entry !== "object") continue;
    canonField(entry as unknown as Record<string, unknown>, "community_id");
    canonJoinMaterial(entry.seed as unknown as Record<string, unknown>);
    canonJoinMaterial(entry.current as unknown as Record<string, unknown>);
    for (const cut of Array.isArray(entry.channel_cuts)
      ? entry.channel_cuts
      : []) {
      if (cut && typeof cut === "object") {
        canonField(cut as unknown as Record<string, unknown>, "id");
      }
    }
  }
  for (const tomb of list.tombstones) {
    if (tomb && typeof tomb === "object") {
      canonField(tomb as unknown as Record<string, unknown>, "community_id");
    }
  }
  return list;
}

/**
 * Parse a decrypted list document, tolerating anything.
 *
 * The document is written by other clients and other versions, so the two
 * arrays are the only things this file may assume; everything else rides
 * through as unknown fields — with the named 32-byte values normalized to hex
 * ({@link canonical32}), which is a re-SPELLING and never a re-shaping.
 */
export function parseCommunityList(json: string): CommunityList {
  const parsed = JSON.parse(json) as Partial<CommunityList>;
  return canonicalizeList({
    ...parsed,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
  } as CommunityList);
}

// ── Fragments (§8): the read-side union ─────────────────────────────────────

/** Stable key order, so two snapshots holding the same state compare equal. */
function canonicalBytes(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBytes).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalBytes(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A snapshot's epoch, or undefined when the document does not say. */
function epochOf(jm: JoinMaterial | undefined): number | undefined {
  const epoch = jm?.root_epoch;
  return typeof epoch === "number" && Number.isFinite(epoch)
    ? epoch
    : undefined;
}

/**
 * Pick between two snapshots of one membership.
 *
 * `current` keeps the HIGHER epoch and `seed` the LOWER — the two anchors of
 * §8, solving opposite problems (instant reconstruction vs full-history
 * backfill). An epoch tie breaks on the lexicographically lowest canonical
 * bytes, a total order, so two devices never disagree about which won.
 */
function pickSnapshot(
  a: JoinMaterial | undefined,
  b: JoinMaterial | undefined,
  keep: "higher" | "lower",
): JoinMaterial | undefined {
  if (!a) return b;
  if (!b) return a;
  const ea = epochOf(a);
  const eb = epochOf(b);
  if (ea !== undefined && eb !== undefined && ea !== eb) {
    const higher = ea > eb ? a : b;
    const lower = ea > eb ? b : a;
    return keep === "higher" ? higher : lower;
  }
  return canonicalBytes(a) <= canonicalBytes(b) ? a : b;
}

/**
 * Union two snapshots' PRIVATE CHANNEL KEYS, per channel, keeping the higher
 * epoch and carrying the loser forward as a prior.
 *
 * Choosing a whole snapshot is right for the fields that describe one epoch —
 * the root, the name, the relays — and catastrophic for `channels`, which is
 * key MATERIAL a member accumulates: a re-invite granting `[A, C]` must not
 * delete the `B` this member already holds, and at an equal epoch a
 * canonical-bytes coin flip would do exactly that, unrecoverably. The armada
 * reference unions here for the same reason.
 */
function unionChannels(
  a: JoinMaterial["channels"] | undefined,
  b: JoinMaterial["channels"] | undefined,
): JoinMaterial["channels"] {
  const out = new Map<string, JoinMaterial["channels"][number]>();
  for (const channel of [
    ...(Array.isArray(a) ? a : []),
    ...(Array.isArray(b) ? b : []),
  ]) {
    if (!channel || typeof channel.id !== "string") continue;
    const id = channel.id.toLowerCase();
    const prev = out.get(id);
    if (!prev) {
      out.set(id, channel);
      continue;
    }
    const winner = (channel.epoch ?? 0) > (prev.epoch ?? 0) ? channel : prev;
    const loser = winner === channel ? prev : channel;
    // The loser's key still opens its own epoch's history, so it is retained as
    // a prior rather than dropped — the same shape armada writes.
    const priors = new Map<number, { key: string; epoch: number }>();
    for (const prior of [
      ...(Array.isArray(winner.priors) ? winner.priors : []),
      ...(Array.isArray(loser.priors) ? loser.priors : []),
    ]) {
      if (prior && typeof prior.key === "string")
        priors.set(prior.epoch, prior);
    }
    if (loser.epoch !== winner.epoch && typeof loser.key === "string") {
      priors.set(loser.epoch, { key: loser.key, epoch: loser.epoch });
    }
    out.set(id, {
      ...loser,
      ...winner,
      ...(priors.size > 0 ? { priors: [...priors.values()] } : {}),
    });
  }
  return [...out.values()];
}

/** Union retained prior roots by epoch — the same accumulation, for the base. */
function unionHeldRoots(
  a: JoinMaterial["held_roots"] | undefined,
  b: JoinMaterial["held_roots"] | undefined,
): JoinMaterial["held_roots"] | undefined {
  const out = new Map<
    number,
    NonNullable<JoinMaterial["held_roots"]>[number]
  >();
  for (const root of [
    ...(Array.isArray(a) ? a : []),
    ...(Array.isArray(b) ? b : []),
  ]) {
    if (root && typeof root.epoch === "number" && !out.has(root.epoch)) {
      out.set(root.epoch, root);
    }
  }
  return out.size > 0 ? [...out.values()] : undefined;
}

/** Per channel, the highest cut epoch either side knows about. */
function unionCuts(
  a: CommunityListEntry["channel_cuts"],
  b: CommunityListEntry["channel_cuts"],
): CommunityListEntry["channel_cuts"] {
  const out = new Map<string, { id: string; epoch: number }>();
  for (const cut of [...(a ?? []), ...(b ?? [])]) {
    if (!cut || typeof cut.id !== "string") continue;
    const id = cut.id.toLowerCase();
    const prev = out.get(id);
    if (!prev || cut.epoch > prev.epoch) out.set(id, { id, epoch: cut.epoch });
  }
  return out.size > 0 ? [...out.values()] : undefined;
}

/**
 * Merge two entries for one community; neither input is mutated.
 *
 * `rank` breaks an epoch tie BEFORE the canonical-bytes rule does (lower wins),
 * and exists for one case §8 never contemplated: unioning the retired
 * single-event List beside the fragmented one. Two fragments of one List at one
 * epoch hold the same state, so bytes are a fine coin-flip between them; a
 * stale legacy document at the same epoch does not, and letting bytes decide
 * could settle on it permanently.
 */
function mergeEntries(
  a: CommunityListEntry,
  b: CommunityListEntry,
  rankA = 0,
  rankB = 0,
): CommunityListEntry {
  // An entry this build cannot read the shape of is still an entry, and the
  // merge feeds a WRITER: dropping it here would delete that membership — and
  // its keys — from the document on every device its holder owns. Keep both
  // sides whole and let the one that has a snapshot supply the snapshots.
  if (!a.current || !b.current) {
    const known = a.current ? a : b;
    const other = known === a ? b : a;
    return {
      ...other,
      ...known,
      added_at: Math.max(
        typeof a.added_at === "number" ? a.added_at : 0,
        typeof b.added_at === "number" ? b.added_at : 0,
      ),
    };
  }
  // The entry carrying the newer `current` is the base, so its extensions
  // (`excluded_at_epoch`, `channel_cuts`, unknown fields) travel with the
  // snapshot they describe rather than being spliced across generations.
  const epochA = epochOf(a.current);
  const epochB = epochOf(b.current);
  const tied =
    epochA === undefined || epochB === undefined || epochA === epochB;
  const newer =
    tied && rankA !== rankB
      ? rankA < rankB
        ? a.current
        : b.current
      : pickSnapshot(a.current, b.current, "higher");
  const base = newer === b.current ? b : a;
  const other = base === a ? b : a;
  // The chosen snapshot describes ONE epoch; the key material accumulates
  // across all of them. Union first, then floor by the cuts, so a stale bundle
  // can only add a key back at or above the epoch that revoked it.
  const cuts = unionCuts(a.channel_cuts, b.channel_cuts);
  const heldRoots = unionHeldRoots(a.current.held_roots, b.current.held_roots);
  const current: JoinMaterial = {
    ...base.current,
    channels: applyChannelCuts(
      unionChannels(a.current.channels, b.current.channels),
      cuts,
    ),
    ...(heldRoots ? { held_roots: heldRoots } : {}),
  };
  // An absent `seed` reads as equal to `current` — which is what it means.
  const seed = pickSnapshot(
    a.seed ?? a.current,
    b.seed ?? b.current,
    "lower",
  ) as JoinMaterial;
  const merged: CommunityListEntry = {
    ...other,
    ...base,
    seed,
    current,
    added_at: Math.max(
      typeof a.added_at === "number" ? a.added_at : 0,
      typeof b.added_at === "number" ? b.added_at : 0,
    ),
  };
  if (cuts) merged.channel_cuts = cuts;
  else delete merged.channel_cuts;
  // An exclusion bites only while it names an epoch BEYOND what `current`
  // holds: holding the marked epoch's own root is re-inclusion, however it
  // arrived, so a spent marker is dropped rather than carried forever.
  const excluded = Math.max(
    typeof a.excluded_at_epoch === "number" ? a.excluded_at_epoch : -1,
    typeof b.excluded_at_epoch === "number" ? b.excluded_at_epoch : -1,
  );
  if (excluded >= 0 && excluded > (epochOf(current) ?? 0)) {
    merged.excluded_at_epoch = excluded;
  } else {
    delete merged.excluded_at_epoch;
  }
  return merged;
}

/**
 * Union any number of list documents — fragments of one §8 List, and the
 * legacy single-event List beside them.
 *
 * Every merge here is commutative and idempotent, which is what makes a partial
 * read safe: a missing fragment is news not yet heard, never a subtraction.
 * Only a tombstone subtracts, and it survives every union (there is exactly one
 * per community, at the later `removed_at`).
 *
 * Merging ACROSS generations is safe for the same reason — a stale legacy
 * document cannot resurrect a membership the fragmented one tombstoned, because
 * liveness is `added_at > removed_at` and the stale entry's `added_at` is older
 * than the removal that retired it.
 */
export function mergeCommunityLists(
  inputs: Array<
    | { list: CommunityList | undefined; rank?: number }
    | CommunityList
    | undefined
  >,
): CommunityList {
  const entries = new Map<string, CommunityListEntry>();
  const ranks = new Map<string, number>();
  const tombstones = new Map<string, CommunityTombstone>();
  let extras: Record<string, unknown> = {};
  for (const input of inputs) {
    const wrapped =
      input && "list" in input && !("entries" in input)
        ? (input as { list: CommunityList | undefined; rank?: number })
        : { list: input as CommunityList | undefined, rank: 0 };
    const list = wrapped.list;
    const rank = wrapped.rank ?? 0;
    if (!list) continue;
    const { entries: _e, tombstones: _t, ...rest } = list;
    // Fragment-level unknowns belong to the List, not to their fragment: the
    // first document carrying a key wins, which for fragments read in index
    // order is §8's "lowest index wins".
    extras = { ...rest, ...extras };
    for (const entry of list.entries) {
      const id =
        typeof entry?.community_id === "string" ? entry.community_id : "";
      // Only an entry with no id at all is unusable — it names no membership
      // and could never be merged, rewritten or tombstoned.
      if (!id) continue;
      const prev = entries.get(id);
      if (!prev) {
        entries.set(id, entry);
        ranks.set(id, rank);
        continue;
      }
      const prevRank = ranks.get(id) ?? 0;
      entries.set(id, mergeEntries(prev, entry, prevRank, rank));
      // The surviving entry carries the better of the two ranks, so a later
      // input compares against the generation that actually won.
      ranks.set(id, Math.min(prevRank, rank));
    }
    for (const tomb of list.tombstones) {
      const id =
        typeof tomb?.community_id === "string" ? tomb.community_id : "";
      if (!id) continue;
      const prev = tombstones.get(id);
      if (!prev || (tomb.removed_at ?? 0) > (prev.removed_at ?? 0)) {
        tombstones.set(id, tomb);
      }
    }
  }
  return {
    ...extras,
    entries: [...entries.values()],
    tombstones: [...tombstones.values()],
  };
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
    // Inside a snapshot the id is REDUNDANT — §8 keys the entry by it — and a
    // writer that derives it from the entry rather than repeating it is
    // producing a document this client must still read. Taking the entry's own
    // id costs nothing: the commitment below still binds it to (owner, salt),
    // so a corrupt entry fails closed exactly as before.
    const communityId = jm.community_id ?? entry.community_id;
    if (!verifyCommunityId(communityId, jm.owner, jm.owner_salt)) {
      return undefined;
    }
    const id = hex32(communityId);
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
      idHex: communityId.toLowerCase(),
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
