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
  readStoredState,
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

/** Whether two folds present the same channel list, in the same order. */
function sameChannels(
  a: CommunityState | undefined,
  b: CommunityState,
): boolean {
  if (!a || a.channels.length !== b.channels.length) return false;
  return a.channels.every(
    (channel, i) =>
      channel.idHex === b.channels[i].idHex &&
      channel.name === b.channels[i].name &&
      channel.category === b.channels[i].category &&
      channel.position === b.channels[i].position &&
      channel.streams.length === b.channels[i].streams.length,
  );
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
    /**
     * Whether the SWEEP has finished, as distinct from having something to
     * paint. The stored fold paints first and is often empty on a cold visit, so
     * without this an empty first paint reads as a settled answer and the viewer
     * states "no channel here is readable" about a community it has not
     * finished reading.
     */
    swept: boolean;
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
        // Paint from the store FIRST. Every edition from the last session is
        // still there, so a warm reload shows the channel list at once and the
        // full re-sweep — which the fold's refuse-downgrade anchor requires —
        // runs behind an already-usable sidebar.
        const stored = await readStoredState(community);
        if (!cancelled && stored) {
          setLoaded({
            idHex: community.idHex,
            nonce,
            swept: false,
            state: stored,
          });
        }
        const next = await syncCommunityState(community);
        if (!cancelled) {
          setLoaded((prev) => ({
            idHex: community.idHex,
            nonce,
            swept: true,
            // Reuse the object already painted when the sweep changed nothing.
            // A fresh `CommunityState` means a fresh `channels` array, which
            // propagates as new identity to everything downstream — including
            // the chat identifier — for no actual change.
            state: sameChannels(prev?.state, next) ? prev!.state : next,
          }));
        }
      } catch (err) {
        if (!cancelled) {
          setLoaded({
            idHex: community.idHex,
            nonce,
            swept: true,
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
    // A sweep still in flight reads as loading even once the stored fold has
    // painted, so the spinner means "a sweep is running" rather than "we have
    // nothing at all" — and the sidebar shows channels while it spins. An empty
    // stored fold must NOT read as settled: that is what made a cold visit
    // claim no channel was readable before it had finished looking.
    loading:
      idHex !== undefined &&
      (!settled || !loaded.swept || loaded.nonce !== nonce),
    error: settled ? loaded.error : undefined,
    refresh,
  };
}
