/**
 * React access to Concord state.
 *
 * Two hooks, matching the two things a viewer needs: the member's communities
 * (from their own Community List) and one community's folded channel list.
 *
 * Both fetch on mount and then leave it alone. Concord's read path is polled
 * rather than streamed — the Control Plane is swept, not subscribed — so a
 * refresh is an explicit act rather than something a render triggers.
 *
 * Each hook keys its loaded value BY SUBJECT (viewer pubkey, community id)
 * rather than resetting state in an effect. Two things fall out of that: no
 * write to state during a render pass, and no window where one account's
 * communities — or one community's channels — show under another's.
 */

import { useCallback, useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";

import type { Community } from "@/lib/concord/types";
import accountManager from "@/services/accounts";
import {
  syncCommunities,
  type ConcordListStatus,
} from "@/services/concord-communities";
import {
  syncCommunityState,
  type CommunityState,
} from "@/services/concord-state";

export interface ConcordCommunitiesResult {
  communities: Community[];
  status: ConcordListStatus | "loading";
  refresh: () => void;
}

/** The viewer's Concord memberships, decrypted from their kind-13302 list. */
export function useConcordCommunities(): ConcordCommunitiesResult {
  const account = use$(accountManager.active$);
  const pubkey = account?.pubkey;
  const signer = account?.signer;
  const [loaded, setLoaded] = useState<{
    pubkey: string;
    communities: Community[];
    status: ConcordListStatus;
  }>();
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    void (async () => {
      try {
        // The signer comes off the live account: a remote signer's `nip44` can
        // arrive seconds after the account itself does.
        const result = await syncCommunities(pubkey, signer);
        if (cancelled) return;
        setLoaded({
          pubkey,
          communities: result.communities,
          status: result.status,
        });
      } catch (error) {
        if (cancelled) return;
        console.warn("[concord] could not sync communities:", error);
        setLoaded({ pubkey, communities: [], status: "decrypt-failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pubkey, signer, nonce]);

  if (!pubkey) return { communities: [], status: "no-decryptor", refresh };
  if (loaded?.pubkey !== pubkey) {
    return { communities: [], status: "loading", refresh };
  }
  return {
    communities: loaded.communities,
    status: loaded.status,
    refresh,
  };
}

export interface ConcordCommunityResult {
  state: CommunityState | undefined;
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
}

/** One community's control fold and channel list. */
export function useConcordCommunity(
  community: Community | undefined,
): ConcordCommunityResult {
  const [loaded, setLoaded] = useState<{
    idHex: string;
    nonce: number;
    state?: CommunityState;
    error?: string;
  }>();
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const idHex = community?.idHex;
  const rootEpoch = community?.rootEpoch;

  useEffect(() => {
    if (!community) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await syncCommunityState(community);
        if (!cancelled) {
          setLoaded({ idHex: community.idHex, nonce, state: next });
        }
      } catch (err) {
        if (!cancelled) {
          setLoaded({
            idHex: community.idHex,
            nonce,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the community's id and epoch, NOT the object: the vault yields a
    // fresh object on every read, and depending on it would resweep the plane on
    // every render. `community` is intentionally excluded for that reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idHex, rootEpoch, nonce]);

  const settled = idHex !== undefined && loaded?.idHex === idHex;
  return {
    state: settled ? loaded.state : undefined,
    // A refresh that has not landed yet still reads as loading, so the spinner
    // means "a sweep is running" rather than "we have nothing at all".
    loading: idHex !== undefined && (!settled || loaded.nonce !== nonce),
    error: settled ? loaded.error : undefined,
    refresh,
  };
}
