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
} from "@/services/concord-rumor-store";

export interface CommunityState {
  folded: FoldedControl;
  channels: Channel[];
}

/**
 * Per-community head floor, carried between folds IN SESSION MEMORY.
 *
 * This is the refuse-downgrade anchor (CORD-04 §1): with it, a relay that
 * withholds the middle of an entity's chain cannot push a higher dangling
 * edition onto a client that already advanced past it — the entity holds and
 * refetches instead. Without a floor a fresh client legitimately accepts the
 * highest head it is served, which is what makes a compaction bootstrap work.
 *
 * Session-only, deliberately: a persisted floor would outlive the held-epoch set
 * it was minted under, and an entity floored under keys we no longer hold can
 * never be re-served, so it would report `incomplete` forever.
 */
const heads = new Map<string, Map<string, EntityHead>>();

/** Test seam: forget every carried head floor. */
export function _resetConcordStateForTests(): void {
  heads.clear();
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
): Promise<FoldedControl> {
  const editions = openControlEditions(
    await queryPlane(community.idHex, "control"),
  );
  // The current epoch's rumor-id set, so a compaction snapshot outranks
  // readable-but-superseded fragments from older epochs. Only a Refounded
  // community has one; for the rest the whole set folds by chain walk.
  const snapshotIds =
    community.rootEpoch > 0n
      ? await readControlSnapshot(community.idHex, plane.group.pk)
      : undefined;

  const folded = foldControlState(
    editions,
    community.id,
    community.owner,
    heads.get(community.idHex),
    snapshotIds,
  );
  // Carry the heads forward as the next fold's floor.
  heads.set(community.idHex, folded.heads);
  return folded;
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
  if (folded.incomplete.length > 0) {
    console.debug(
      `[concord] ${community.idHex.slice(0, 8)}: ${folded.incomplete.length} entity(ies) unaccounted for — next sweep re-reads whole`,
    );
    markControlPlaneStale(community);
  }

  // Retired epochs' snapshot sets are dead weight once their keys are gone.
  void pruneControlSnapshots(
    community.idHex,
    community.heldRoots
      .map((held) => held.controlPk)
      .filter((pk): pk is string => pk !== undefined),
  ).catch(() => undefined);

  return { folded, channels: channelsView(community, folded) };
}
