/**
 * One community's live state: sweep the Control Plane, fold it, hand back the
 * channels.
 *
 * The three layers below each have exactly one job, and this is the only place
 * that knows the order they run in:
 *
 *   plane-sync   fetch + decrypt + store   (facts about the fetch)
 *   control      fold the edition set      (facts about the state)
 *   channels     fold + held keys → view   (what the sidebar renders)
 *
 * The fold reads the STORE, not the sweep's return value: a sweep that returns
 * nothing fresh has still confirmed the plane, and a cold launch folds editions
 * decrypted in a previous session without re-paying the crypto.
 */

import { channelsView } from "@/lib/concord/channels";
import {
  currentControlPlane,
  heldControlPlanes,
  type ControlPlaneView,
} from "@/lib/concord/control-address";
import {
  foldControlState,
  openControlEditions,
  type EntityHead,
  type FoldedControl,
} from "@/lib/concord/control";
import { markControlPlaneStale, sweepControl } from "@/lib/concord/plane-sync";
import type { Channel, Community } from "@/lib/concord/types";
import {
  pruneControlSnapshots,
  queryPlane,
  readControlSnapshot,
  readFoldedControl,
  writeFoldedControl,
} from "@/services/concord-rumor-store";

export interface CommunityState {
  folded: FoldedControl;
  channels: Channel[];
}

/**
 * Per-entity head floor, carried between folds IN SESSION MEMORY.
 *
 * This is the refuse-downgrade anchor (CORD-04 §1): with it, a relay that
 * withholds the middle of an entity's chain cannot push a higher dangling
 * edition onto a client that already advanced past it — the entity holds and
 * refetches instead. Without a floor a fresh client legitimately accepts the
 * highest head it is served, which is what makes a compaction bootstrap work.
 *
 * **RAISED, never replaced.** `folded.heads` carries an entry only for entities
 * whose head PASSED the authority gate this round, so assigning it wholesale
 * deletes the floor of every entity that was gap-held or authority-rejected —
 * and the next fold then treats those as a fresh joiner and seats an edition
 * below the version it already accepted. Concretely: an admin revokes a mod's
 * grant (v2), the admin is later demoted, so v2 becomes inadmissible and v1 is
 * below-floor — the entity settles nothing and drops out of `folded.heads`. Lose
 * the floor and the next fold re-seats the REVOKED v1 grant. `incomplete` does
 * not catch it either, deliberately: a served-but-rejected entity is not a
 * data-availability problem.
 *
 * **KEYED BY EPOCH.** A Refounding legitimately drops entities, and a floor that
 * never forgets would flag them `incomplete` forever and re-arm a full sweep
 * every cycle. Re-keying on `rootEpoch` re-baselines on adoption, so a floor
 * minted under a superseded founding cannot out-anchor the new epoch's compacted
 * snapshot.
 *
 * Session-only: a persisted floor would outlive the held-epoch set it was minted
 * under, and an entity floored under keys we no longer hold can never be
 * re-served.
 */
const floors = new Map<string, Map<string, EntityHead>>();

const floorKey = (community: Community) =>
  `${community.idHex}@${community.rootEpoch}`;

/** Test seam: forget every carried head floor. */
export function _resetConcordStateForTests(): void {
  floors.clear();
}

/**
 * Fold what the store already holds for this community. No network.
 *
 * Safe to call on every render: `foldControlState` memoizes on the exact edition
 * set, so a repeat fold over unchanged editions is a map lookup.
 */
export async function foldStoredControl(
  community: Community,
  plane: ControlPlaneView = currentControlPlane(community),
): Promise<FoldedControl | undefined> {
  // The current epoch's rumor-id set, so a compaction snapshot outranks
  // readable-but-superseded fragments from older epochs. Only a Refounded
  // community has one; for the rest the whole set folds by chain walk.
  const snapshotIds =
    community.rootEpoch > 0n
      ? await readControlSnapshot(community.idHex, plane.group.pk)
      : undefined;
  // A Refounded community anchors on its compaction snapshot, so WAIT for it
  // rather than folding once by old-root contiguity and again correctly — the
  // two disagree about which editions outrank which. Without the wait, an
  // old-epoch fragment at a lower version anchors the chain walk and is seated
  // in preference to the compacted head: superseded metadata, a stale banlist,
  // a revoked grant.
  if (community.rootEpoch > 0n && !snapshotIds) return undefined;

  const editions = openControlEditions(
    await queryPlane(community.idHex, "control"),
  );
  const key = floorKey(community);
  const folded = foldControlState(
    editions,
    community.id,
    community.owner,
    floors.get(key),
    snapshotIds,
  );

  // Raise the floor from this fold's accepted heads — upward only. See the
  // `floors` docstring for what replacing it would undo.
  let floor = floors.get(key);
  if (!floor) floors.set(key, (floor = new Map()));
  for (const [eid, head] of folded.heads) {
    const prior = floor.get(eid);
    if (!prior || head.version > prior.version) floor.set(eid, head);
  }

  // Materialize it, so the next boot paints without replaying the fixpoint over
  // every stored edition. Display only — the refuse-downgrade FLOOR above stays
  // session-only on purpose (a persisted floor outlives the held-epoch set it
  // was minted under, and an entity floored under keys we no longer hold can
  // never be re-served, so it would report `incomplete` forever).
  void writeFoldedControl(community.idHex, community.rootEpoch, folded);
  return folded;
}

/**
 * The channel view from what the store already holds — no network at all.
 *
 * The sweep re-reads the WHOLE control plane at every session start, by design:
 * the delta floor is session-only because a persisted one starves the fold
 * (see `plane-sync.ts`). That is a bandwidth cost, not a reason to make the
 * reader stare at a spinner — every edition from last session is still in the
 * store, so the sidebar can paint from it immediately and let the sweep refresh
 * underneath.
 *
 * Returns undefined for a Refounded community whose compaction snapshot has not
 * been recorded yet; see {@link foldStoredControl}.
 */
export async function readStoredState(
  community: Community,
): Promise<CommunityState | undefined> {
  // The materialized fold first: it is the same answer the replay would produce
  // for an unchanged edition set, without parsing every edition and re-running
  // the delegation fixpoint to find that out.
  const cached = await readFoldedControl(community.idHex, community.rootEpoch);
  if (cached)
    return { folded: cached, channels: channelsView(community, cached) };

  const folded = await foldStoredControl(community);
  if (!folded) return undefined;
  return { folded, channels: channelsView(community, folded) };
}

/**
 * Sweep, fold, and return the channel view.
 *
 * `incomplete` is the fold's own completeness signal — floored entities the
 * served editions could not account for. It drives exactly one thing: forget the
 * sweep's delta floor so the NEXT sweep re-reads the whole plane. That is the
 * only case a delta sweep cannot heal on its own, because the missing edition
 * sits BELOW the high-water mark the delta rides.
 */
export async function syncCommunityState(
  community: Community,
): Promise<CommunityState> {
  const plane = currentControlPlane(community);
  await sweepControl(community, plane.group);

  const folded = await foldStoredControl(community, plane);
  if (!folded) {
    // A Refounded community with no compaction snapshot recorded yet. The sweep
    // above records it when a wrap arrives fresh; until then there is nothing
    // safe to fold, and rendering an empty channel list beats rendering a stale
    // one anchored on an old-epoch fragment.
    throw new Error(
      "Still catching up with this community — try again in a moment.",
    );
  }
  if (folded.incomplete.length > 0) {
    console.debug(
      `[concord] ${community.idHex.slice(0, 8)}: ${folded.incomplete.length} entity(ies) unaccounted for — next sweep re-reads whole`,
    );
    markControlPlaneStale(community);
  }

  // Retired epochs' snapshot sets are dead weight once their keys are gone.
  //
  // The addresses to KEEP are the ones a fold actually asks about, resolved per
  // epoch — NOT the `controlPk` field. A LEGACY (pre-split) epoch carries no
  // `controlPk` at all, because its address is derived rather than handed over
  // (CORD-02 §2), so reading the field would produce an empty keep-set and this
  // prune would delete the very snapshot the sweep above just recorded. The
  // community then never folds again: the gate in `foldStoredControl` blocks on
  // a set that is wiped as fast as it is written.
  void pruneControlSnapshots(
    community.idHex,
    heldControlPlanes(community).map((held) => held.group.pk),
  ).catch(() => undefined);

  return { folded, channels: channelsView(community, folded) };
}
