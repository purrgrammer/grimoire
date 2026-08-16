/**
 * The Guestbook Plane — CORD-02 §5, read side.
 *
 * Ported from armada `bc19d1f` (`src/concord/lib/guestbook.ts`), minus every
 * builder: grimoire publishes no Join, no Leave, no Kick and no snapshot.
 * §5's observed-authors rule is what makes that harmless — an author seen
 * publishing anywhere in the community is observably present — so sending one
 * message here makes the user visible in every member's list with no membership
 * write at all.
 *
 * One stream per community, keyed by the `community_root`, carrying only
 * membership motion. Off-consensus: nothing in Control or Chat depends on it,
 * so it loads last and may lag without harm.
 *
 * A client folds it by COALESCING FLAT — one final state per npub, latest entry
 * wins by millisecond time, ties broken by the lower rumor id — then merges the
 * observed authors, minus the Banlist.
 */

import { guestbookGroupKey, type GroupKey } from "@/lib/concord/derive";
import {
  citationFromTags,
  type AuthorityCitation,
} from "@/lib/concord/edition";
import {
  KIND_JOIN_LEAVE,
  KIND_KICK,
  KIND_SEAL_ENCRYPTED,
  KIND_SNAPSHOT,
} from "@/lib/concord/kinds";
import type { OpenedEvent } from "@/lib/concord/stream";
import type { Community } from "@/lib/concord/types";

/** Entries dated further than this ahead of the local clock are dropped outright. */
export const GUESTBOOK_MAX_FUTURE_MS = 60 * 60 * 1000;

// ── Addressing ───────────────────────────────────────────────────────────────

/** Every guestbook stream key across held root epochs, newest first. */
export function guestbookGroups(community: Community): GroupKey[] {
  return community.heldRoots.map((held) =>
    guestbookGroupKey(held.key, community.id, held.epoch),
  );
}

/**
 * The npubs whose Refoundings minted the epochs this client holds — the
 * snapshot authorities for the guestbooks {@link guestbookGroups} sweeps.
 *
 * Genesis (epoch 0) has no snapshot, so it contributes no authority. An epoch
 * whose refounder was never recorded contributes none either: accepting NO
 * snapshot is the safe miss — §5 heals it by observation and by the member's
 * own unsuppressable Join — whereas falling back to the owner would let an npub
 * who never minted an epoch seed arbitrary members into it.
 */
export function snapshotAuthorities(community: Community): Set<string> {
  const out = new Set<string>();
  for (const held of community.heldRoots) {
    if (held.epoch > 0n && held.refounder) out.add(held.refounder);
  }
  if (community.rootEpoch > 0n && community.refounder) {
    out.add(community.refounder);
  }
  return out;
}

// ── Coalesce fold ────────────────────────────────────────────────────────────

export type MemberState = "join" | "leave" | "kick";

export interface CoalescedMember {
  pubkey: string;
  state: MemberState;
  /** Millisecond time of the winning entry. */
  ms: number;
  /** Rumor id of the winning entry (the tiebreak). */
  rumorId: string;
  /** Whether the winning state came from a secondhand snapshot seed. */
  fromSnapshot: boolean;
  /** Invite attribution (Joins only): the link creator + label. */
  invite?: { creator: string; label?: string };
}

export interface CoalesceOptions {
  nowMs: number;
  /**
   * KICK bit + strict outrank, PLUS the CORD-04 §5 sync floor: `citation` is
   * the kick's `vac`. A kick is an authority action, so a client whose roster is
   * one sweep stale must not honor one from an already-demoted admin.
   */
  canKick: (
    actorHex: string,
    targetHex: string,
    citation: AuthorityCitation | undefined,
    atMs: number,
  ) => boolean;
  /**
   * The npubs whose Refoundings minted the held epochs. A SET, because the
   * sweep spans every held epoch's guestbook and each was minted by its own
   * refounder — matching only the current one silently drops every prior
   * epoch's snapshot. Empty/absent honors NO snapshot rather than falling back
   * to the owner.
   *
   * Per-epoch exactness isn't reachable here: which epoch's stream carried a
   * rumor is wire-only (`streamPk`) and deliberately not persisted beside it,
   * and a snapshot rumor doesn't name its own epoch. The residual is that a
   * refounder of one held epoch is accepted on another's snapshot — all of them
   * are npubs that legitimately held that key, and a snapshot only seeds a state
   * any newer firsthand entry supersedes.
   */
  snapshotAuthorities?: ReadonlySet<string>;
  /** Banned npubs (the Banlist fold) — their entries are dropped entirely. */
  banned?: ReadonlySet<string>;
}

/**
 * Coalesce opened guestbook events flat: one final state per npub.
 *
 *   - entries dated > 1h ahead of the local clock are dropped outright;
 *   - every entry from a `banned` author is dropped — a banned npub's events,
 *     kicks included, are never honored (CORD-04 §4);
 *   - guestbook seals must be encrypted (CORD-02 §5);
 *   - latest wins by ms; ties break by the LOWER rumor id;
 *   - a Kick is honored only when `canKick` allows it;
 *   - a snapshot chunk is honored only from a `snapshotAuthorities` npub, and
 *     merely SEEDS an npub's state — any self-signed entry (or authorized kick)
 *     newer than it supersedes it.
 */
export function coalesceGuestbook(
  opened: OpenedEvent[],
  opts: CoalesceOptions,
): Map<string, CoalescedMember> {
  const byMember = new Map<string, CoalescedMember>();

  /**
   * Does `next` beat `prev`? Later ms wins; tie → lower rumor id. A firsthand
   * entry at the same instant beats a snapshot seed (secondhand).
   */
  const supersedes = (
    prev: CoalescedMember | undefined,
    next: CoalescedMember,
  ): boolean => {
    if (!prev) return true;
    if (next.ms !== prev.ms) return next.ms > prev.ms;
    if (prev.fromSnapshot !== next.fromSnapshot) return prev.fromSnapshot;
    return next.rumorId < prev.rumorId;
  };

  const apply = (candidate: CoalescedMember) => {
    const prev = byMember.get(candidate.pubkey);
    if (supersedes(prev, candidate)) byMember.set(candidate.pubkey, candidate);
  };

  for (const ev of opened) {
    if (ev.ms > opts.nowMs + GUESTBOOK_MAX_FUTURE_MS) continue;
    // Encrypted-seal (CORD-02 §5), while the seal form is still known. A stored
    // rumor has no envelope left and passed this at ingest.
    if (ev.sealKind !== undefined && ev.sealKind !== KIND_SEAL_ENCRYPTED)
      continue;
    if (opts.banned?.has(ev.author)) continue;

    if (ev.kind === KIND_JOIN_LEAVE) {
      const verb =
        ev.content === "join"
          ? "join"
          : ev.content === "leave"
            ? "leave"
            : undefined;
      if (!verb) continue;
      const inviteTag =
        verb === "join" ? ev.tags.find((t) => t[0] === "invite") : undefined;
      apply({
        pubkey: ev.author,
        state: verb,
        ms: ev.ms,
        rumorId: ev.rumorId,
        fromSnapshot: false,
        invite: inviteTag?.[1]
          ? { creator: inviteTag[1], label: inviteTag[2] || undefined }
          : undefined,
      });
      continue;
    }

    if (ev.kind === KIND_KICK) {
      const target = ev.tags.find((t) => t[0] === "p")?.[1];
      if (!target) continue;
      if (!opts.canKick(ev.author, target, citationFromTags(ev.tags), ev.ms))
        continue;
      apply({
        pubkey: target,
        state: "kick",
        ms: ev.ms,
        rumorId: ev.rumorId,
        fromSnapshot: false,
      });
      continue;
    }

    if (ev.kind === KIND_SNAPSHOT) {
      if (!opts.snapshotAuthorities?.has(ev.author)) continue;
      let members: unknown;
      try {
        members = JSON.parse(ev.content);
      } catch {
        continue;
      }
      if (!Array.isArray(members)) continue;
      for (const pk of members) {
        if (typeof pk !== "string" || !/^[0-9a-f]{64}$/i.test(pk)) continue;
        apply({
          pubkey: pk.toLowerCase(),
          state: "join",
          ms: ev.ms,
          rumorId: ev.rumorId,
          fromSnapshot: true,
        });
      }
    }
  }

  return byMember;
}

// ── Feed ─────────────────────────────────────────────────────────────────────

/** One thing that happened to somebody's membership. */
export interface GuestbookFeedEntry {
  kind: "join" | "leave" | "kick" | "ban";
  /** The member it happened to. */
  pubkey: string;
  /** Who did it, where the plane names them. Only a kick has one. */
  actor?: string;
  /** Millisecond time. For a ban this is APPROXIMATE — see `readGuestbookFeed`. */
  ms: number;
  /** The rumor it came from; absent for a ban, which is folded from Control. */
  rumorId?: string;
  /** Invite attribution (Joins only): the link creator + label. */
  invite?: { creator: string; label?: string };
}

/**
 * The Guestbook as a FEED: every honored entry, in order, rather than one
 * final state per npub.
 *
 * Same gates as {@link coalesceGuestbook} — future-dated drop, encrypted seal,
 * banned author drop, `canKick` for a Kick — because a feed row is a claim that
 * something happened, and an unauthorized kick did not happen. What differs is
 * only that nothing supersedes anything: a member who joined, left and rejoined
 * produces three rows, which is the history the coalesce exists to throw away.
 *
 * Kind-3312 snapshots contribute NOTHING. A snapshot is a secondhand seed —
 * `fromSnapshot` exists precisely to say so — and rendering one as "joined"
 * would date a member's arrival to whenever somebody last compacted the plane.
 */
export function guestbookFeed(
  opened: OpenedEvent[],
  opts: CoalesceOptions,
): GuestbookFeedEntry[] {
  const out: GuestbookFeedEntry[] = [];

  for (const ev of opened) {
    if (ev.ms > opts.nowMs + GUESTBOOK_MAX_FUTURE_MS) continue;
    if (ev.sealKind !== undefined && ev.sealKind !== KIND_SEAL_ENCRYPTED)
      continue;
    if (opts.banned?.has(ev.author)) continue;

    if (ev.kind === KIND_JOIN_LEAVE) {
      const verb =
        ev.content === "join"
          ? "join"
          : ev.content === "leave"
            ? "leave"
            : undefined;
      if (!verb) continue;
      const inviteTag =
        verb === "join" ? ev.tags.find((t) => t[0] === "invite") : undefined;
      out.push({
        kind: verb,
        pubkey: ev.author,
        ms: ev.ms,
        rumorId: ev.rumorId,
        ...(inviteTag?.[1]
          ? {
              invite: {
                creator: inviteTag[1],
                ...(inviteTag[2] ? { label: inviteTag[2] } : {}),
              },
            }
          : {}),
      });
      continue;
    }

    if (ev.kind === KIND_KICK) {
      const target = ev.tags.find((t) => t[0] === "p")?.[1];
      if (!target) continue;
      if (!opts.canKick(ev.author, target, citationFromTags(ev.tags), ev.ms))
        continue;
      out.push({
        kind: "kick",
        pubkey: target,
        actor: ev.author,
        ms: ev.ms,
        rumorId: ev.rumorId,
      });
    }
  }

  // Newest first: this is read as news, not as a ledger.
  return out.sort(
    (a, b) => b.ms - a.ms || (a.rumorId ?? "").localeCompare(b.rumorId ?? ""),
  );
}

/**
 * The Complete Memberlist: the coalesced Guestbook, merged with OBSERVED
 * authors (an author seen publishing is present, forward of their latest
 * departure), minus the Banlist. `observed` maps author → the newest ms they
 * were seen publishing anywhere in the community.
 */
export function completeMemberlist(
  coalesced: Map<string, CoalescedMember>,
  observed: Map<string, number>,
  banned: ReadonlySet<string>,
  bannedAt?: ReadonlyMap<string, number>,
): Set<string> {
  // A Join or activity that predates a member's most recent ban is STALE: a ban
  // is a departure the Guestbook never records (self-removal is network-silent),
  // so on unban an old Join would resurface as a phantom member. `bannedAt` (the
  // control plane's authorized ban history) is in SECONDS; ms compares to it×1000.
  // Activity/Join AFTER the ban still counts — that's a genuine rejoin. (A member
  // offline for the WHOLE ban→unban window never actually left; they are briefly
  // suppressed until they next publish — the `observed` path then re-adds them.)
  const stalePreBan = (pk: string, ms: number): boolean => {
    const at = bannedAt?.get(pk);
    return at !== undefined && ms <= at * 1000;
  };
  const out = new Set<string>();
  for (const [pk, m] of coalesced) {
    if (m.state === "join" && !banned.has(pk) && !stalePreBan(pk, m.ms))
      out.add(pk);
  }
  for (const [pk, seenMs] of observed) {
    if (banned.has(pk) || stalePreBan(pk, seenMs)) continue;
    const m = coalesced.get(pk);
    // Observation only counts FORWARD: activity newer than the latest Leave/
    // Kick re-enters them; a departed member's old history never resurrects them.
    if (!m || m.state === "join" || seenMs > m.ms) out.add(pk);
  }
  return out;
}
