/**
 * The Control Plane fold — a set of kind-3308 editions replayed into current
 * state (CORD-04).
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/control.ts`), read half only.
 * The edition BUILDERS, dissolution publishing and the Refounding's compaction
 * are absent — grimoire publishes nothing here.
 *
 * Three sections of armada's fold are also absent, and their absence is safe
 * rather than merely untested: invite registries (vsk 8), pin lists (vsk 11) and
 * Community Signals (vsk 12). Nothing in grimoire consumes any of them, and none
 * feeds the roster, the channels, the metadata or the banlist. Signals in
 * particular ship in armada from an UNMERGED spec branch, and an unknown `vsk`
 * folding to nothing is the documented forward-compat contract — the visible
 * consequence is that a paused community will not appear paused here.
 *
 * **`authorizeDelegation` reads as over-engineered and is not.** Do not
 * simplify it. The two freeze latches make the result a function of the edition
 * SET rather than its arrival order, and guarantee termination on a revocation
 * cycle; authority-first sibling ordering stops a grindable rumor-id fork
 * evicting a superior's edition; and the replace-rank rule — a non-owner must
 * outrank what an edition REPLACES, not just what it hands out — is the only
 * thing that stops a revoke being free. A simplified fold produces a DIFFERENT
 * roster than armada's, silently.
 */

import {
  banlistLocator,
  bytesToHex,
  grantLocator,
  hex32,
} from "@/lib/concord/derive";
import {
  type AuthorityCitation,
  type ParsedEdition,
  parseEdition,
  toFoldEdition,
} from "@/lib/concord/edition";
import {
  VSK_BANLIST,
  VSK_CHANNEL,
  VSK_GRANT,
  VSK_METADATA,
  VSK_ROLE,
} from "@/lib/concord/kinds";
import {
  canActOnPosition,
  emptyRoles,
  grantFromJSON,
  hasPermission,
  highestPosition,
  isAuthorized,
  MAX_ROLES_PER_COMMUNITY,
  outranks,
  Permissions,
  roleFromJSON,
  type CommunityRoles,
  type MemberGrant,
  type Role,
} from "@/lib/concord/roles";
import type { OpenedEvent } from "@/lib/concord/stream";
import {
  capRelays,
  DESCRIPTION_MAX_BYTES,
  isImagePointer,
  NAME_MAX_BYTES,
  utf8Len,
  type ChannelMetadata,
  type CommunityMetadata,
} from "@/lib/concord/types";
import { bootstrapHead, fold, type Edition } from "@/lib/concord/version";

// ── Parsing ──────────────────────────────────────────────────────────────────

/** null = "parsed and rejected", so a bad edition is not re-parsed every fold. */
const parsedEditionMemo = new Map<string, ParsedEdition | null>();

/**
 * Parse already-OPENED control events into editions. The wrap decrypt and seal
 * verify happened at ingest; this only extracts the edition machinery.
 */
export function openControlEditions(opened: OpenedEvent[]): ParsedEdition[] {
  const out: ParsedEdition[] = [];
  for (const ev of opened) {
    const cached = parsedEditionMemo.get(ev.rumorId);
    if (cached !== undefined) {
      if (cached) out.push(cached);
      continue;
    }
    let parsed: ParsedEdition | null;
    try {
      parsed = parseEdition(ev);
    } catch {
      parsed = null;
    }
    parsedEditionMemo.set(ev.rumorId, parsed);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Test seam: forget every parsed edition. */
export function _resetControlMemosForTests(): void {
  parsedEditionMemo.clear();
  foldMemo.clear();
}

// ── The folded shape ─────────────────────────────────────────────────────────

export interface EntityHead {
  version: bigint;
  hash: Uint8Array;
}

/** One channel's folded definition. */
export interface FoldedChannel {
  channelIdHex: string;
  name: string;
  isPrivate: boolean;
  deleted: boolean;
  /** Full metadata, retained so the sidebar conventions can be read off it. */
  metadata: ChannelMetadata;
}

/** The Control Plane replayed into current state. */
export interface FoldedControl {
  roster: CommunityRoles;
  /** The proven owner (from the community_id commitment) — position 0, supreme. */
  ownerHex: string;
  metadata?: CommunityMetadata;
  /** channelIdHex → folded definition (deleted channels included, flagged). */
  channels: Map<string, FoldedChannel>;
  banned: Set<string>;
  /**
   * npub → the `created_at` (SECONDS) of the newest AUTHORIZED banlist edition
   * that named them. A member's Guestbook Join that predates their most recent
   * ban is a stale membership — a ban is a departure the Guestbook never records
   * — so without this an unbanned member's old Join resurfaces as a phantom on
   * the roster. Derived from the same authority gate as `banned`, so a forged
   * banlist can't backdate-suppress a member.
   */
  bannedAt: Map<string, number>;
  /** Per-entity head version + hash (key = eid hex). */
  heads: Map<string, EntityHead>;
  /**
   * Floored entities the served set could not account for: gap-held (the chain
   * to our floor is withheld), or with zero served editions at all. A
   * data-availability signal ONLY — an entity that was served but
   * authority-rejected is deliberately absent, not listed. Non-empty means the
   * next sweep must re-read the whole plane (`markControlPlaneStale`).
   */
  incomplete: string[];
}

// ── Head selection ───────────────────────────────────────────────────────────

function pushEdition(
  m: Map<string, ParsedEdition[]>,
  key: string,
  p: ParsedEdition,
) {
  const list = m.get(key);
  if (list) list.push(p);
  else m.set(key, [p]);
}

/**
 * Fold one entity's editions into an ORDERED candidate list:
 *
 *   1. the chain-verified fold head first (refuse-downgrade, contiguity — the
 *      steady-state answer, and the compaction case too);
 *   2. then EVERY remaining edition, version-DESCENDING (equal versions by
 *      rumor id, the fold's tiebreak winner first) — the candidates a client
 *      may accept when, and only when, a higher-priority candidate fails the
 *      caller's authority gate. "The highest authority-verified head"
 *      (CORD-04 §1) requires gating before choosing, or a forger could suppress
 *      a legit entity with garbage at a higher (or dangling lower) version.
 *
 * Equal-version fork SIBLINGS are all kept: the tiebreak (lower rumor id) is
 * grindable, so evicting the loser here would let an id-mined fork of the chain
 * tip suppress the real edition before any authority gate ever saw it. The
 * tiebreak orders siblings; the gate decides.
 *
 * `floor` is a tracking client's last-accepted head. When the served editions
 * don't link contiguously up to it — a hostile relay withholding the middle of
 * the chain — the fold reports a GAP and holds at the last-known-good head
 * rather than downgrading to the dangling one (CORD-04 §1). A FRESH joiner (no
 * floor) still accepts the highest head despite a dangling `prev`: that is the
 * legitimate compaction bootstrap.
 *
 * `snapshot` is the subset wrapped under the CURRENT epoch's control group,
 * passed once the community has Refounded. A Refounding compacts every head
 * into the new epoch (CORD-06 §3), so readable-but-superseded fragments from
 * older epochs must not outrank it. The snapshot folds by BOOTSTRAP (highest
 * signed version, floor as version-only refuse-downgrade), never the chain walk:
 * behind a compaction dangling `prev`s are normal, and since seal signatures
 * survive a re-wrap, any group-key holder can re-serve a real OLD edition under
 * the current group. Version anchoring bounds that — a re-wrap cannot raise the
 * version inside the signed seal.
 */
function headCandidates(
  editions: ParsedEdition[],
  floor?: EntityHead,
  snapshot?: ParsedEdition[],
  onGap?: () => void,
): ParsedEdition[] {
  const ordered: ParsedEdition[] = [];
  const seenRumors = new Set<string>();
  let gapped = false;

  if (snapshot) {
    // Compaction-era arm. Snapshot presence selects the ARM; version selects
    // the HEAD — over ALL editions, not the subset. Honest paths are identical
    // (the compacted head is >= every readable old-epoch edition), but bounding
    // the bootstrap to the subset would let colluding relays serve only a stale
    // re-wrap and outrank a higher true head sitting in our own store.
    const idx = bootstrapHead(
      editions.map(toFoldEdition),
      floor?.version ?? 0n,
    );
    if (idx !== null) {
      ordered.push(editions[idx]);
      seenRumors.add(bytesToHex(editions[idx].rumorId));
    } else if (floor !== undefined) {
      // Nothing at/above our floor was served: the head we already accepted
      // vanished from the served set — withheld, fail closed.
      gapped = true;
      onGap?.();
    }
  } else {
    const folds: Edition[] = editions.map(toFoldEdition);
    const result = fold(folds, floor?.version ?? 0n, floor?.hash);

    // Tracking client + a gap: the served chain doesn't reach our floor. Refuse
    // to adopt anything above the floor — a withheld-middle attack can't push a
    // higher dangling edition onto a client that already advanced the chain.
    //
    // A null head under a floor is that same withholding by omission: every
    // served edition sat BELOW the floor, so the head we already accepted was
    // not served at all. `fold` reports no gap for it (it skips below-floor
    // editions before it ever looks for a chain), which is why this arm has to
    // name the case itself.
    gapped = floor !== undefined && (result.gap || result.head === null);
    if (gapped) onGap?.();

    if (result.head !== null && !gapped) {
      ordered.push(editions[result.head]);
      seenRumors.add(bytesToHex(editions[result.head].rumorId));
    }
  }

  const rest = editions
    .filter((e) => {
      // A compaction re-wrap carries the same rumor — one candidacy per rumor.
      const id = bytesToHex(e.rumorId);
      if (seenRumors.has(id)) return false;
      seenRumors.add(id);
      // Refuse-to-downgrade (CORD-04 §1): a relay replaying a stale Grant or a
      // lifted Ban is rejected. A below-floor edition is never a candidate —
      // not even as the last one standing, which is exactly the shape that
      // replay takes.
      if (floor !== undefined && e.version < floor.version) return false;
      // Under a gap, suppress every candidate above the floor too: only the
      // floor's own version remains admissible, so the entity never downgrades
      // to a dangling head either.
      if (gapped && e.version > floor!.version) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.version !== b.version) return a.version > b.version ? -1 : 1;
      return bytesToHex(a.rumorId) < bytesToHex(b.rumorId) ? -1 : 1;
    });
  ordered.push(...rest);
  return ordered;
}

/** Pick the first candidate passing `gate`; record it as the entity's head. */
function pickHead(
  candidates: ParsedEdition[],
  heads: Map<string, EntityHead>,
  gate: (p: ParsedEdition) => boolean,
): ParsedEdition | undefined {
  for (const p of candidates) {
    if (!gate(p)) continue;
    heads.set(bytesToHex(p.entityId), { version: p.version, hash: p.selfHash });
    return p;
  }
  return undefined;
}

/** Order role/grant candidates oldest version first (the admissibility walk). */
function byVersionAsc(
  a: { parsed: ParsedEdition },
  b: { parsed: ParsedEdition },
): number {
  return a.parsed.version < b.parsed.version
    ? -1
    : a.parsed.version > b.parsed.version
      ? 1
      : 0;
}

/** Version-ascending groups; equal-version fork siblings share a group. */
function versionGroups<T extends { parsed: ParsedEdition }>(
  candidates: T[],
): T[][] {
  const groups: T[][] = [];
  for (const c of [...candidates].sort(byVersionAsc)) {
    const last = groups[groups.length - 1];
    if (last && last[0].parsed.version === c.parsed.version) last.push(c);
    else groups.push([c]);
  }
  return groups;
}

/**
 * Whether an actor's `vac` satisfies the CORD-04 §5 sync floor.
 *
 * COMPLETENESS, NOT AUTHORIZATION. It answers "have I synced enough of this
 * actor's Grant to judge them", never "may they act" — the caller still resolves
 * rank against the CURRENT roster, so citing an old-but-once-valid Grant
 * grandfathers nobody and a since-demoted actor is refused regardless.
 *
 * Deliberately mirrors Vector's `authority_citation_satisfied` case for case;
 * the two clients diverging here means one honors a moderation action the other
 * silently ignores, which is invisible to both sides.
 */
export function citationSatisfied(
  folded: Pick<FoldedControl, "heads" | "ownerHex">,
  communityId: Uint8Array,
  actorHex: string,
  citation: AuthorityCitation | undefined,
): boolean {
  // The owner is proven by the community_id itself — no Grant exists to cite.
  if (actorHex === folded.ownerHex) return true;
  if (!citation) return false;
  // It must name the actor's OWN Grant coordinate: citing a foreign edition we
  // happen to hold cannot borrow completeness.
  const eid = bytesToHex(grantLocator(communityId, hex32(actorHex)));
  if (bytesToHex(citation.entityId) !== eid) return false;
  const head = folded.heads.get(eid);
  if (!head) return false;
  // Synced PAST it: the roster check already reflects the later head.
  if (head.version > citation.version) return true;
  // Synced to exactly it: the cited hash must be the edition that won our fold,
  // else they cited a non-canonical fork of their own Grant.
  if (head.version === citation.version) {
    return bytesToHex(head.hash) === bytesToHex(citation.editionHash);
  }
  // BEHIND it — we cannot confirm the authority, so the action parks and
  // self-heals when the Grant arrives. Fail closed.
  return false;
}

// ── The delegation fixpoint ──────────────────────────────────────────────────

/**
 * The delegation fixpoint (CORD-04 §2): start with the owner authorized (their
 * rank comes from the community_id, not any fold), then admit role/grant
 * entities whose signer is authorized to make them, repeating until stable. Per
 * entity the ORDERED candidates are tried in turn and the first authorized one
 * settles it, so a forger's garbage edition can't suppress a legit head.
 * Anything whose signer never becomes authorized is dropped — the
 * self-promotion / forged-delegation defense.
 *
 * Editing is ACTING ON A TARGET (CORD-04 §5): besides outranking what an edition
 * hands out, a non-owner signer must strictly outrank what it REPLACES — the
 * standing role position, or the rank a grant's predecessor conferred — or a
 * revoke (empty role_ids) or demotion would be free to anyone. Each entity's
 * candidates are walked version-ascending so the "standing" state is itself an
 * admissible edition, never a forger's plant.
 *
 * The fold must be a function of the edition SET, never its arrival order:
 * entities are processed in sorted-eid order, and an entity DEFERS while any
 * state its gate reads is still pending. A stalled fixpoint freezes those
 * deferrals one at a time, so it always terminates.
 */
function authorizeDelegation(
  roleCandidates: Map<
    string,
    Array<{ role: Role; author: string; parsed: ParsedEdition }>
  >,
  grantCandidates: Map<
    string,
    Array<{ grant: MemberGrant; author: string; parsed: ParsedEdition }>
  >,
  communityId: Uint8Array,
  ownerHex: string,
  heads: Map<string, EntityHead>,
): CommunityRoles {
  const roster = emptyRoles();
  const settledRoles = new Set<string>();
  const settledGrants = new Set<string>();
  // Deterministic processing order — never keyed to edition arrival.
  const roleEids = [...roleCandidates.keys()].sort();
  const grantEids = [...grantCandidates.keys()].sort();
  // member → their grant entity: the rank source the author-deferral watches.
  const grantEidOfMember = new Map<string, string>();
  for (const [eid, cands] of grantCandidates) {
    if (cands.length > 0) grantEidOfMember.set(cands[0].grant.member, eid);
  }
  // The CORD-04 §5 sync floor, for the delegation chain itself. A Role or Grant
  // edition is an authority action like any other, so a non-owner must name the
  // Grant it acts under — otherwise a client whose roster is one sweep stale
  // honors a promotion (or a demotion) issued by an admin already stripped of
  // MANAGE_ROLES. Resolved against the heads settled by THIS pass: owner-rooted
  // grants settle first (the owner cites nothing), which unlocks the admins'
  // citations on a later round, so the fixpoint bootstraps itself.
  const citedOk = (p: ParsedEdition): boolean =>
    citationSatisfied({ heads, ownerHex }, communityId, p.author, p.authority);

  let changed = true;
  // While false, a grant handing out a role that still has unsettled candidates
  // WAITS. Once the fixpoint can settle no more roles the flag flips: any
  // still-unsettled role is provably dead, so grants blocked only on dead roles
  // resolve (and drop) instead of hanging forever.
  let rolesFrozen = false;
  // While false, an entity with a candidate whose author's own grant entity is
  // unsettled WAITS — the author's rank decides admissibility, so settling early
  // would key the roster to edition ARRIVAL order (a real admin's revoke dropped
  // because their grant folded later).
  let ranksFrozen = false;

  const settle = (p: ParsedEdition) => {
    heads.set(bytesToHex(p.entityId), { version: p.version, hash: p.selfHash });
  };

  /** Is a non-owner author's rank still undetermined (their grant pending)? */
  const rankPending = (author: string, selfEid?: string): boolean => {
    if (author === ownerHex) return false;
    const aeid = grantEidOfMember.get(author);
    // An entity never waits on itself: a self-grant's only possible rank source
    // is the entity being decided, which is exactly the self-promotion the
    // fixpoint exists to drop.
    return aeid !== undefined && aeid !== selfEid && !settledGrants.has(aeid);
  };

  /**
   * Equal-version fork siblings, highest authority first: the owner, then rank
   * (lower position), then the fold's rumor-id tiebreak. The id is grindable;
   * authority is not — so a fork can only displace an edition its author could
   * have overwritten anyway.
   */
  const authorityFirst = (
    a: { author: string; parsed: ParsedEdition },
    b: { author: string; parsed: ParsedEdition },
  ): number => {
    const rank = (author: string) =>
      author === ownerHex
        ? -1
        : (highestPosition(roster, author) ?? Number.MAX_SAFE_INTEGER);
    const ra = rank(a.author);
    const rb = rank(b.author);
    if (ra !== rb) return ra - rb;
    const ia = bytesToHex(a.parsed.rumorId);
    const ib = bytesToHex(b.parsed.rumorId);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };

  while (changed) {
    changed = false;

    // Roles: the owner may define any role (position >= 1 — the top is not
    // mintable, enforced at parse); a non-owner needs MANAGE_ROLES, must
    // strictly outrank the position they mint, AND must strictly outrank the
    // standing position they replace (no repositioning a role above you).
    for (const eid of roleEids) {
      if (settledRoles.has(eid)) continue;
      const candidates = roleCandidates.get(eid)!;
      if (!ranksFrozen && candidates.some((c) => rankPending(c.author))) {
        continue;
      }
      const admissible = new Set<ParsedEdition>();
      let standing: number | undefined; // the admissible predecessor's position
      for (const group of versionGroups(candidates)) {
        for (const { role, author, parsed } of [...group].sort(
          authorityFirst,
        )) {
          const mintOk =
            author === ownerHex ||
            canActOnPosition(
              roster,
              author,
              ownerHex,
              role.position,
              Permissions.MANAGE_ROLES,
            );
          const replaceOk =
            author === ownerHex ||
            standing === undefined ||
            outranks(roster, author, ownerHex, standing);
          if (!mintOk || !replaceOk || !citedOk(parsed)) continue;
          admissible.add(parsed);
          standing = role.position;
          break; // one winner per version — a fork sibling can't sidestep it
        }
      }
      // The fold's candidate priority (chain-verified head first), gated.
      const pick = candidates.find((c) => admissible.has(c.parsed));
      if (!pick) continue;
      roster.roles.push(pick.role);
      settledRoles.add(eid);
      settle(pick.parsed);
      changed = true;
    }

    // Grants: a non-owner needs MANAGE_ROLES, must strictly outrank every Role
    // handed out, AND must strictly outrank the target's standing rank — a
    // revoke (empty role_ids) or demotion acts ON the member (CORD-04 §5/§6), so
    // it is never free to a lower rank (or to no rank at all).
    for (const eid of grantEids) {
      if (settledGrants.has(eid)) continue;
      const candidates = grantCandidates.get(eid)!;
      // A referenced role is unresolved iff it still has live role candidates
      // that haven't settled; such a grant waits for a later pass — but only
      // until roles are frozen (past that, an unsettled role is dead).
      const rolePending = (rid: string) =>
        roleCandidates.has(rid) && !settledRoles.has(rid);
      if (
        !rolesFrozen &&
        candidates.some((c) => c.grant.roleIds.some(rolePending))
      ) {
        continue;
      }
      if (!ranksFrozen && candidates.some((c) => rankPending(c.author, eid))) {
        continue;
      }

      const admissible = new Set<ParsedEdition>();
      let standing: number | undefined; // the rank the predecessor conferred
      for (const group of versionGroups(candidates)) {
        for (const { grant, author, parsed } of [...group].sort(
          authorityFirst,
        )) {
          const positions = grant.roleIds
            .map((rid) => roster.roles.find((r) => r.roleId === rid)?.position)
            .filter((p): p is number => p !== undefined);
          const allKnown = positions.length === grant.roleIds.length;
          const ok =
            author === ownerHex ||
            (allKnown &&
              hasPermission(roster, author, Permissions.MANAGE_ROLES) &&
              positions.every((pos) =>
                outranks(roster, author, ownerHex, pos),
              ) &&
              (standing === undefined ||
                outranks(roster, author, ownerHex, standing)));
          if (!ok || !citedOk(parsed)) continue;
          admissible.add(parsed);
          standing = positions.length ? Math.min(...positions) : undefined;
          break; // one winner per version
        }
      }
      const pick = candidates.find((c) => admissible.has(c.parsed));
      if (!pick) continue;
      roster.grants.push(pick.grant);
      settledGrants.add(eid);
      settle(pick.parsed);
      changed = true;
    }

    // The fixpoint stalled with deferrals still holding entities back: flip one
    // freeze latch (roles first — a rank source may itself be blocked only on a
    // dead role) and let another round resolve them. Each latch only ever moves
    // its gate later and flips once, so termination is preserved.
    if (!changed && !rolesFrozen) {
      rolesFrozen = true;
      changed = true;
    } else if (!changed && !ranksFrozen) {
      ranksFrozen = true;
      changed = true;
    }
  }

  // Deterministic cap: a Community carries at most 100 Roles — fold the 100
  // lowest role_ids and ignore the rest (CORD-04 §2).
  if (roster.roles.length > MAX_ROLES_PER_COMMUNITY) {
    roster.roles.sort((a, b) =>
      a.roleId < b.roleId ? -1 : a.roleId > b.roleId ? 1 : 0,
    );
    roster.roles = roster.roles.slice(0, MAX_ROLES_PER_COMMUNITY);
  }
  return roster;
}

// ── The fold ─────────────────────────────────────────────────────────────────

/** Fold-once memo, keyed on the community + the exact edition set. */
const foldMemo = new Map<string, FoldedControl>();

/**
 * Replay a set of opened control editions into current state. `ownerHex` is the
 * community's proven owner, verified against the id commitment when the
 * membership entry was accepted.
 *
 * Runs in up to two passes: the first resolves the Banlist (itself
 * roster-gated), and if any edition was authored by a banned npub the fold
 * re-runs with those excluded — a banned npub's authority actions are dropped
 * like every other event of theirs (CORD-04 §4). The first pass's Banlist stays
 * the final word: the owner is never bannable, so the anti-roster cannot be used
 * to erase itself.
 */
export function foldControlState(
  editions: ParsedEdition[],
  communityId: Uint8Array,
  ownerHex: string,
  priorHeads?: Map<string, EntityHead>,
  snapshotIds?: Set<string>,
): FoldedControl {
  const cidHex = bytesToHex(communityId);
  const floorSig = priorHeads
    ? [...priorHeads.entries()]
        .map(([k, v]) => `${k}@${v.version}`)
        .sort()
        .join(",")
    : "";
  // snapshotIds is part of the key: attribution can change (a re-wrap arriving)
  // without the edition set changing, and must not serve a stale fold.
  const snapSig = snapshotIds ? [...snapshotIds].sort().join(",") : "";
  const memoKey = `${cidHex}:${ownerHex}:${floorSig}:${snapSig}:${editions
    .map((e) => e.opened.rumorId)
    .sort()
    .join(",")}`;
  const hit = foldMemo.get(memoKey);
  if (hit) return hit;

  const first = foldOnce(
    editions,
    communityId,
    ownerHex,
    priorHeads,
    snapshotIds,
  );
  // The owner is "supreme and unremovable" (CORD-04 §2), so a Banlist naming
  // them is honored for everyone it validly names and inert as to them. The
  // filter belongs HERE, on the set every reader consumes, not in each reader:
  // "every honest client drops every event from a banned npub" (§4) is applied
  // by the chat fold, the guestbook and the member list alike, and a rule only
  // some of them apply is one an authorized BAN holder can use to silence the
  // owner in every member's client while the fold still honors their authority.
  const banned = new Set([...first.banned].filter((pk) => pk !== ownerHex));
  let result: FoldedControl =
    banned.size === first.banned.size ? first : { ...first, banned };
  if (banned.size > 0 && editions.some((e) => banned.has(e.author))) {
    // Pass 1 stays authoritative for `incomplete`: pass 2 drops banned authors'
    // editions by SEMANTICS (CORD-04 §4), not data loss — a gap it introduces
    // must not read as "plane unserved".
    result = {
      ...foldOnce(
        editions.filter((e) => !banned.has(e.author)),
        communityId,
        ownerHex,
        priorHeads,
        snapshotIds,
      ),
      banned,
      bannedAt: first.bannedAt,
      incomplete: first.incomplete,
    };
  }

  // Single entry per community so the memo doesn't grow unbounded.
  for (const k of foldMemo.keys())
    if (k.startsWith(`${cidHex}:`)) foldMemo.delete(k);
  foldMemo.set(memoKey, result);
  return result;
}

function foldOnce(
  editions: ParsedEdition[],
  communityId: Uint8Array,
  ownerHex: string,
  priorHeads?: Map<string, EntityHead>,
  snapshotIds?: Set<string>,
): FoldedControl {
  const cidHex = bytesToHex(communityId);

  // 1. Group by (vsk, entity).
  const byVsk = new Map<string, Map<string, ParsedEdition[]>>();
  for (const p of editions) {
    let m = byVsk.get(p.vsk);
    if (!m) byVsk.set(p.vsk, (m = new Map()));
    pushEdition(m, bytesToHex(p.entityId), p);
  }

  const heads = new Map<string, EntityHead>();
  const gapHeld = new Set<string>();
  /** Ordered head candidates per entity of one vsk (floored per prior head). */
  const candidatesOf = (vsk: string): Map<string, ParsedEdition[]> => {
    const out = new Map<string, ParsedEdition[]>();
    for (const [eid, list] of byVsk.get(vsk) ??
      new Map<string, ParsedEdition[]>()) {
      // Current-epoch subset: when any edition of this entity arrived under the
      // current control group, the chain walk anchors there — an entity never
      // re-wrapped keeps full-set semantics.
      const snap = snapshotIds
        ? list.filter((p: ParsedEdition) =>
            snapshotIds.has(bytesToHex(p.rumorId)),
          )
        : [];
      out.set(
        eid,
        headCandidates(
          list,
          priorHeads?.get(eid),
          snap.length > 0 ? snap : undefined,
          () => gapHeld.add(eid),
        ),
      );
    }
    return out;
  };

  // 2. Roster (owner-rooted fixpoint) — resolved before any gated entity.
  const roleCandidates = new Map<
    string,
    Array<{ role: Role; author: string; parsed: ParsedEdition }>
  >();
  for (const [eid, candidates] of candidatesOf(VSK_ROLE)) {
    const parsed = candidates
      .map((p) => ({
        role: roleFromJSON(p.content),
        author: p.author,
        parsed: p,
      }))
      // The entity coordinate must be the role's own id (anti-spoofing).
      .filter((c): c is { role: Role; author: string; parsed: ParsedEdition } =>
        Boolean(c.role && bytesToHex(hex32(c.role.roleId)) === eid),
      );
    if (parsed.length > 0) roleCandidates.set(eid, parsed);
  }
  const grantCandidates = new Map<
    string,
    Array<{ grant: MemberGrant; author: string; parsed: ParsedEdition }>
  >();
  for (const [eid, candidates] of candidatesOf(VSK_GRANT)) {
    const parsed = candidates
      .map((p) => ({
        grant: grantFromJSON(p.content),
        author: p.author,
        parsed: p,
      }))
      // The coordinate must be the member's grant locator (anti-spoofing).
      .filter(
        (
          c,
        ): c is { grant: MemberGrant; author: string; parsed: ParsedEdition } =>
          Boolean(
            c.grant &&
            bytesToHex(grantLocator(communityId, hex32(c.grant.member))) ===
              eid,
          ),
      );
    if (parsed.length > 0) grantCandidates.set(eid, parsed);
  }
  const roster = authorizeDelegation(
    roleCandidates,
    grantCandidates,
    communityId,
    ownerHex,
    heads,
  );

  // The `vac` authority-citation check (CORD-04 §5). A non-owner authority
  // action MUST cite the exact Grant it acts under, pinned by (eid, version,
  // hash); a verifier honors it only once it holds that Grant at >= the cited
  // version with a MATCHING hash. "Synced AT LEAST that Grant" means a LATER
  // head passes — an exact-version index would drop an edition whose cited
  // version has since been superseded, and compaction re-wraps only each
  // entity's head, so after a Refounding every edition citing a superseded
  // version would fall out of the fold. That loses a community's name, or its
  // admins, on rotation.
  const citationOk = (p: ParsedEdition): boolean =>
    citationSatisfied({ heads, ownerHex }, communityId, p.author, p.authority);

  // 3. Metadata (vsk 0): the community's own entity + an authorized actor.
  let metadata: CommunityMetadata | undefined;
  {
    const candidates = candidatesOf(VSK_METADATA).get(cidHex) ?? [];
    const head = pickHead(candidates, heads, (p) => {
      if (
        !isAuthorized(roster, p.author, ownerHex, Permissions.MANAGE_METADATA)
      ) {
        return false;
      }
      if (!citationOk(p)) return false;
      try {
        const parsed = JSON.parse(p.content) as CommunityMetadata;
        // The protocol caps are read-side rules too (CORD-02 §6): an oversize
        // name/description is malformed, not merely impolite.
        if (
          typeof parsed.name !== "string" ||
          utf8Len(parsed.name) > NAME_MAX_BYTES
        ) {
          return false;
        }
        if (
          parsed.description !== undefined &&
          (typeof parsed.description !== "string" ||
            utf8Len(parsed.description) > DESCRIPTION_MAX_BYTES)
        ) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    });
    if (head) {
      const parsed = JSON.parse(head.content) as CommunityMetadata;
      metadata = {
        ...parsed,
        relays: capRelays(Array.isArray(parsed.relays) ? parsed.relays : []),
        icon: isImagePointer(parsed.icon) ? parsed.icon : undefined,
        banner: isImagePointer(parsed.banner) ? parsed.banner : undefined,
      };
    }
  }

  // 4. Channels (vsk 2), each gated by MANAGE_CHANNELS.
  const channels = new Map<string, FoldedChannel>();
  for (const [eid, candidates] of candidatesOf(VSK_CHANNEL)) {
    const channelGate = (p: ParsedEdition): boolean => {
      if (
        !isAuthorized(roster, p.author, ownerHex, Permissions.MANAGE_CHANNELS)
      ) {
        return false;
      }
      if (!citationOk(p)) return false;
      try {
        const meta = JSON.parse(p.content) as ChannelMetadata;
        return (
          typeof meta.name === "string" &&
          meta.name.length > 0 &&
          utf8Len(meta.name) <= NAME_MAX_BYTES
        );
      } catch {
        return false;
      }
    };
    const head = pickHead(candidates, heads, channelGate);
    if (!head) continue;
    const meta = JSON.parse(head.content) as ChannelMetadata;
    // CORD-03 §2: "Deletion is terminal: the id is never reused, clients drop
    // the Channel from display and may discard its keys." Terminal means the
    // HEAD cannot lift it — an authorized, correctly-chained edition clearing
    // the flag is ignored as to deletion (everything else in it still folds).
    //
    // The key-discard permission is what makes this load-bearing rather than
    // cosmetic: members who honored it can never read a resurrected private
    // channel, members who ignored it can, and no rotation heals the split.
    // Gated by the SAME predicate the head was picked with — an unauthorized
    // author's tombstone is not a deletion, or anyone could erase a channel.
    const everDeleted = candidates.some((p) => {
      if (!channelGate(p)) return false;
      try {
        return (JSON.parse(p.content) as ChannelMetadata).deleted === true;
      } catch {
        return false;
      }
    });
    channels.set(eid, {
      channelIdHex: eid,
      name: meta.name,
      isPrivate: meta.private === true,
      deleted: meta.deleted === true || everDeleted,
      metadata: everDeleted ? { ...meta, deleted: true } : meta,
    });
  }

  // 5. Banlist (vsk 4): the one anti-roster; unauthorized head → empty.
  const banned = new Set<string>();
  const bannedAt = new Map<string, number>();
  {
    const eid = bytesToHex(banlistLocator(communityId));
    const candidates = candidatesOf(VSK_BANLIST).get(eid) ?? [];
    const banlistGate = (p: ParsedEdition): boolean => {
      if (!isAuthorized(roster, p.author, ownerHex, Permissions.BAN))
        return false;
      if (!citationOk(p)) return false;
      try {
        return Array.isArray(JSON.parse(p.content));
      } catch {
        return false;
      }
    };
    const head = pickHead(candidates, heads, banlistGate);
    if (head) {
      for (const pk of JSON.parse(head.content) as unknown[]) {
        if (typeof pk === "string" && /^[0-9a-f]{64}$/i.test(pk)) {
          banned.add(pk.toLowerCase());
        }
      }
    }
    // Ban history: the newest AUTHORIZED edition that named each npub. Same gate
    // as the head, so a forged banlist can't backdate-suppress a legit member.
    for (const p of candidates) {
      if (!banlistGate(p)) continue;
      let list: unknown;
      try {
        list = JSON.parse(p.content);
      } catch {
        continue;
      }
      if (!Array.isArray(list)) continue;
      for (const pk of list) {
        if (typeof pk !== "string" || !/^[0-9a-f]{64}$/i.test(pk)) continue;
        const k = pk.toLowerCase();
        // The owner is never bannable (parity with foldControlState's filter).
        if (k === ownerHex) continue;
        const prev = bannedAt.get(k);
        if (prev === undefined || p.createdAt > prev)
          bannedAt.set(k, p.createdAt);
      }
    }
  }

  // Data-availability roll-up: gap-held entities, plus floored entities with
  // ZERO served editions this fold. A floored entity whose editions were served
  // but authority-rejected is NOT flagged — that's a deliberate drop (a stripped
  // role, a banned author's edition, CORD-04 §4).
  const servedEids = new Set<string>();
  for (const m of byVsk.values())
    for (const eid of m.keys()) servedEids.add(eid);
  const incomplete = [...gapHeld];
  for (const eid of priorHeads?.keys() ?? []) {
    if (!servedEids.has(eid) && !gapHeld.has(eid)) incomplete.push(eid);
  }

  return {
    roster,
    ownerHex,
    metadata,
    channels,
    banned,
    bannedAt,
    heads,
    incomplete,
  };
}
