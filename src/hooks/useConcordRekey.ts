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

import { useEffect } from "react";
import { use$ } from "applesauce-react/hooks";

import type { FoldedControl } from "@/lib/concord/control";
import type { Community } from "@/lib/concord/types";
import accountManager from "@/services/accounts";
import { readJoinedAtMs } from "@/services/concord-communities";
import { watchRekeys } from "@/services/concord-rekey-watch";

/** How often to re-check, while the community is open. */
const POLL_MS = 2 * 60_000;

export function useConcordRekeyWatch(
  community: Community | undefined,
  folded: FoldedControl | undefined,
  onAdopted: () => void,
): void {
  const account = use$(accountManager.active$);
  const pubkey = account?.pubkey;
  const signer = account?.signer;
  const idHex = community?.idHex;
  const rootEpoch = community?.rootEpoch;

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
        const result = await watchRekeys(
          community,
          folded,
          { pubkey, signer },
          joinedAtMs,
        );
        if (cancelled) return;
        // An exclusion is recorded but does NOT reload: the membership stays
        // exactly where it is, marked, and re-reading would only re-render the
        // same thing. Only new key material changes what can be read.
        if (result.adopted) onAdopted();
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
  }, [idHex, rootEpoch, pubkey, signer, folded, onAdopted]);
}
