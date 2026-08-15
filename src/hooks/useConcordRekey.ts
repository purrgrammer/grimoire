/**
 * Run the rekey watch for the open community.
 *
 * A rotation is rare and admin-initiated, so this polls rather than holding a
 * subscription — armada's cadence, for armada's reason: the addresses are
 * per-epoch, so a standing REQ would have to be rebuilt on every adoption
 * anyway.
 *
 * Only the OPEN community is watched. A rotation the viewer never looks at is
 * picked up the moment they open the community, and watching every membership
 * at once would multiply the poll by the size of the list for no reader benefit.
 *
 * On an adoption the caller is asked to reload: the new key material is in
 * Dexie, and everything downstream — the wire's subscription set, the control
 * address, the channel sidebar — is built from the `Community` object, which
 * only changes when the list is re-read.
 */

import { useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";

import type { FoldedControl } from "@/lib/concord/control";
import { bytesToHex } from "@/lib/concord/derive";
import type { Community } from "@/lib/concord/types";
import accountManager from "@/services/accounts";
import { readJoinedAtMs } from "@/services/concord-communities";
import { watchRekeys } from "@/services/concord-rekey-watch";

/** How often to re-check, while the community is open. */
const POLL_MS = 2 * 60_000;

/**
 * @returns whether this member is STRANDED on a superseded epoch — dropped
 * there by a stale invite link, with no forward path on the wire.
 */
export function useConcordRekeyWatch(
  community: Community | undefined,
  folded: FoldedControl | undefined,
  onAdopted: () => void,
): { stranded: boolean } {
  // Keyed by subject, like the other Concord hooks: the verdict belongs to the
  // community it was computed for, and the viewer switches in place.
  const [strandedAt, setStrandedAt] = useState<string>();
  const account = use$(accountManager.active$);
  const pubkey = account?.pubkey;
  const signer = account?.signer;
  const idHex = community?.idHex;
  const rootEpoch = community?.rootEpoch;
  /**
   * The channel generations being watched. A CHANNEL adoption does not move
   * `rootEpoch`, so without this the effect never re-armed after one and kept
   * re-deriving the same pre-rotation addresses. Armada keys its channel effect
   * on the same thing, for the same reason.
   */
  const watchKey = (community?.privateChannels ?? [])
    .map((channel) => `${bytesToHex(channel.id)}:${channel.epoch}`)
    .sort()
    .join(",");

  useEffect(() => {
    if (!community || !folded || !pubkey || !signer) return;
    // A blob is opened with one pairwise ECDH. Without it there is nothing to
    // adopt, and polling would only spend requests.
    if (!signer.nip44) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const round = async () => {
      try {
        const joinedAtMs = await readJoinedAtMs(pubkey, community.idHex);
        // WITHOUT A JOIN TIME, DO NOT ACT. The removal decision compares every
        // rotation's publish time against it, so an unknown join time (a
        // missing row, a list entry whose `added_at` is not a number, a failed
        // read) would make every rotation in history postdate the join and turn
        // that guard off — ejecting a member from channels on rotations that
        // happened before they existed. Armada declines the same way.
        if (joinedAtMs === undefined) {
          if (!cancelled) timer = setTimeout(() => void round(), POLL_MS);
          return;
        }
        const result = await watchRekeys(
          community,
          folded,
          { pubkey, signer },
          joinedAtMs,
        );
        if (cancelled) return;
        // EITHER outcome reloads. An adoption obviously changes what can be
        // read — but so does a cut, which drops a channel from the sidebar, and
        // a pass that adopts on one channel while being cut from another
        // reports both. Not reloading is also what left the watcher re-walking
        // the same rotation on every poll, because the `Community` it reads
        // only advances when the list is re-read.
        if (result.stranded) setStrandedAt(community.idHex);
        if (result.adopted || result.excluded) onAdopted();
      } catch (error) {
        if (!cancelled) console.debug("[concord] rekey watch:", error);
      }
      if (!cancelled) timer = setTimeout(() => void round(), POLL_MS);
    };
    void round();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // Keyed on the community's id and epoch, NOT the object: the vault yields a
    // fresh object on every read, and depending on it would re-poll on every
    // render. An adoption changes `rootEpoch`, which re-arms this naturally and
    // is what walks a client forward across several missed rotations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idHex, rootEpoch, watchKey, pubkey, signer, folded, onAdopted]);

  return { stranded: strandedAt !== undefined && strandedAt === idHex };
}
