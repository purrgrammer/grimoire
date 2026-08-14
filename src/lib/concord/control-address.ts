/**
 * Which address a community's Control Plane lives at, per epoch.
 *
 * Concord split the plane in two (CORD-02 §2): post-split the SIGNER derives
 * from a `control_root` that only the owner and staff hold, so the address is
 * something a member is HANDED (in join material, invites, and rekey blobs)
 * rather than something they can derive. Pre-split, one member-derivable key was
 * simultaneously the address, the signer and the read key.
 *
 * Both generations coexist and never collide — different labels, different
 * addresses — so a client reading history across a Refounding has to ask this
 * per epoch rather than once per community.
 *
 * The wrap CONTENT is encrypted under the `community_root`-derived
 * `concord/control` conversation key in BOTH generations. Only the address
 * moves. That is why a split epoch still yields a usable read key with no
 * `control_root` in hand: `sk`/`convKey` come from the root, and only `pk` is
 * replaced by the held address.
 */

import { controlGroupKey, controlSignerGroupKey } from "@/lib/concord/derive";
import type { StreamKeyView } from "@/lib/concord/derive";
import type { Community, HeldRoot } from "@/lib/concord/types";

/**
 * The read view of one epoch's Control Plane: the address to query and
 * authenticate at, and the conversation key that opens its wraps.
 *
 * `sk` is present when we can answer a NIP-42 challenge for `pk`: on a legacy
 * epoch the root-derived key IS the plane's signer, and on a split epoch it is
 * the `control_root`-derived one, which only staff hold. An ordinary member on
 * a split epoch gets no `sk` at all — the ADDRESS-ONLY registration
 * `stream-auth.ts` models, and on a gating relay that plane is unreadable.
 */
export interface ControlPlaneView {
  epoch: bigint;
  /** The stream key view for reading: `pk` is the address, `convKey` decrypts. */
  group: StreamKeyView;
  /** Whether we can sign a NIP-42 challenge for this address. */
  canAuthenticate: boolean;
}

function viewFor(
  community: Community,
  root: Uint8Array,
  epoch: bigint,
  controlPk: string | undefined,
): ControlPlaneView {
  const derived = controlGroupKey(root, community.id, epoch);
  if (!controlPk) {
    // LEGACY: the derived key is the whole plane — address, signer, read key.
    return { epoch, group: derived, canAuthenticate: true };
  }
  // A STAFF member holds this epoch's `control_root` and can therefore derive
  // the signer after all. Grimoire never publishes control editions, but the
  // secret still matters for READING: on a NIP-42 gating relay it is the only
  // thing that can answer a challenge for this address, and omitting it would
  // leave a staff member unable to read the very plane they administer.
  //
  // A held secret that does not derive to the held address is corrupt state,
  // not a signer — leave it absent and fail closed to read-only.
  const signer =
    community.controlRoot !== undefined && epoch === community.rootEpoch
      ? controlSignerGroupKey(community.controlRoot, community.id, epoch)
      : undefined;
  const canSign = signer?.pk === controlPk;

  // SPLIT: the held address, with the root-derived conversation key. The
  // conversation key is a getter on the memoized GroupKey, so it is read
  // through rather than copied.
  return {
    epoch,
    group: {
      pk: controlPk,
      get convKey() {
        return derived.convKey;
      },
      // WRITE-RESTRICTED (CORD-01). A split plane's signer is a `control_root`
      // holder, so the wrap signature actually proves staff published it — and
      // the reader MUST verify it. On a legacy epoch the same signature is made
      // with a key every member derives and proves nothing, so verifying there
      // would be theatre; here, skipping it lets any member mint editions.
      restricted: true,
      ...(canSign && signer ? { sk: signer.sk } : {}),
    },
    canAuthenticate: canSign,
  };
}

/** The CURRENT epoch's Control Plane view — the only one the sweep reads. */
export function currentControlPlane(community: Community): ControlPlaneView {
  return viewFor(
    community,
    community.root,
    community.rootEpoch,
    community.controlPk,
  );
}

/**
 * Every held epoch's Control Plane view.
 *
 * The sweep reads only the current one (the plane is compaction-bounded), but
 * stream-auth registers them all: old roots stay held for chat history, and an
 * address that is not registered reports "not yet registered" to the auth gate
 * rather than "accounted for", which blocks a sweep instead of proceeding.
 */
export function heldControlPlanes(community: Community): ControlPlaneView[] {
  return community.heldRoots.map((held: HeldRoot) =>
    viewFor(community, held.key, held.epoch, held.controlPk),
  );
}
