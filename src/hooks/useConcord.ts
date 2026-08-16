/**
 * React access to Concord state.
 *
 * Two hooks, matching the two things a viewer needs: the member's communities
 * (from their own Community List) and one community's folded channel list.
 *
 * Both fetch on mount. The community hook additionally listens on the wire bus
 * for its own control scope, so a channel created in Armada appears in the
 * sidebar without a manual refresh — that ring means the store already changed,
 * so the response is a local re-read, never a sweep.
 *
 * Each hook keys its loaded value BY SUBJECT (viewer pubkey, community id)
 * rather than resetting state in an effect. Two things fall out of that: no
 * write to state during a render pass, and no window where one account's
 * communities — or one community's channels — show under another's.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { use$ } from "applesauce-react/hooks";

import {
  controlScope,
  emitWireScopes,
  onWireScope,
} from "@/lib/concord/wire-bus";
import type { Community, ImagePointer } from "@/lib/concord/types";
import type { FoldedControl } from "@/lib/concord/control";
import type { GuestbookFeedEntry } from "@/lib/concord/guestbook";
import { readGuestbookFeed } from "@/services/concord-members";
import { readFoldedControl } from "@/services/concord-rumor-store";
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
        // Tell the wire the store moved. On a COLD community this is the only
        // thing that gets it chat filters at all: the wire builds them from the
        // stored fold, which is empty until this sweep lands, and its own
        // `c2ctl:` rings only happen once it is already subscribed. Without
        // this, live delivery for a community you just joined waits for a
        // control edition to happen by, or for a remount.
        //
        // It cannot loop: the ring rebuilds the spec from the store, and only a
        // later WRITE rings again.
        emitWireScopes([controlScope(community.idHex)]);
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

  // The wire's doorbell for this community's control plane. It rings only after
  // the editions are durably stored, so re-reading the fold is enough — and the
  // fold memoizes on the exact edition set, so a ring that changed nothing costs
  // a map lookup.
  useEffect(() => {
    if (!community) return;
    let cancelled = false;
    const off = onWireScope(controlScope(community.idHex), () => {
      void readStoredState(community).then((next) => {
        if (cancelled || !next) return;
        setLoaded((prev) =>
          prev?.idHex === community.idHex && sameChannels(prev.state, next)
            ? prev
            : {
                idHex: community.idHex,
                nonce,
                // NEVER default to swept. A ring can land before the first
                // paint on a cold community — the wire is already subscribed
                // while the sweep is still running — and claiming settled there
                // is exactly what made a cold visit say no channel was readable
                // before it had finished looking.
                swept: prev?.swept ?? false,
                state: next,
              },
        );
      });
    });
    return () => {
      cancelled = true;
      off();
    };
    // Keyed on the id, not the object: the vault yields a fresh object per read.
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

/**
 * One community's membership feed — joins, leaves, kicks, and who is banned.
 *
 * Read on mount and re-read on the community's CONTROL ring, which is a
 * deliberate compromise rather than an oversight: the guestbook plane has no
 * doorbell of its own. The wire bus defines three scopes and a guestbook write
 * rings none of them, so freshness actually arrives with `syncCommunityState`'s
 * sweeps — after which `useConcord` emits `controlScope` — and with control
 * traffic ingested from the wire.
 *
 * The stated cost: a kick landing between sweeps, in a community with no
 * control-plane traffic, stays invisible until the next sweep, the next
 * control edition, or reopening the panel. That is exactly how fresh the
 * roster is today.
 */
export function useConcordGuestbook(
  community: Community | undefined,
  folded: FoldedControl | undefined,
): { feed: GuestbookFeedEntry[]; loading: boolean } {
  const [loaded, setLoaded] = useState<{
    idHex: string;
    feed: GuestbookFeedEntry[];
  }>();
  const idHex = community?.idHex;
  // The fold is a fresh object per read; the banlist is what this depends on.
  const bannedKey = folded ? [...folded.banned].sort().join(",") : undefined;

  // What a re-read reads FROM. The effect is deliberately not keyed on the
  // roster — it changes shape on every fold — but a ring must still be answered
  // with the roster as it stands, not the one this effect closed over. Who may
  // remove whom is a roster question, so a kick by a moderator promoted since
  // the panel opened would otherwise be dropped as unauthorized until something
  // else re-ran the effect.
  const latest = useRef({ community, folded });
  useEffect(() => {
    latest.current = { community, folded };
  });

  useEffect(() => {
    if (!community || !folded) return;
    let cancelled = false;
    const read = () => {
      const { community: now, folded: roster } = latest.current;
      if (!now || !roster) return;
      void readGuestbookFeed(now, roster)
        .then((feed) => {
          if (!cancelled) setLoaded({ idHex: now.idHex, feed });
        })
        .catch((error: unknown) => {
          console.warn("[concord] could not read the guestbook:", error);
        });
    };
    read();
    const off = onWireScope(controlScope(community.idHex), read);
    return () => {
      cancelled = true;
      off();
    };
    // Keyed on the id and the banlist, not the objects: both are rebuilt on
    // every vault and fold read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idHex, bannedKey]);

  const settled = idHex !== undefined && loaded?.idHex === idHex;
  return {
    feed: settled ? loaded.feed : EMPTY_FEED,
    loading: idHex !== undefined && !settled,
  };
}

const EMPTY_FEED: GuestbookFeedEntry[] = [];

/**
 * Every community's icon pointer, from the MATERIALIZED fold.
 *
 * The picker lists communities the client is not currently reading, and their
 * icons live in the Control Plane metadata — so a hook that only had the open
 * community's fold could decorate exactly one row. `readFoldedControl` is the
 * fold already written to Dexie, so this costs one indexed read per community
 * and no network at all.
 *
 * The Community List cannot supply this: its join material carries membership
 * and keys, never the icon (CORD-02 §8).
 */
export function useConcordIcons(
  communities: Community[],
): Map<string, ImagePointer> {
  const [icons, setIcons] = useState<Map<string, ImagePointer>>(new Map());
  // Keyed on the (id, epoch) pairs: a Refounding re-anchors the fold, and a
  // metadata edition that changes the icon lands under the same key, which the
  // control doorbell already re-reads.
  const key = communities.map((c) => `${c.idHex}@${c.rootEpoch}`).join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = new Map<string, ImagePointer>();
      for (const community of communities) {
        const folded = await readFoldedControl(
          community.idHex,
          community.rootEpoch,
        ).catch(() => undefined);
        const icon = folded?.metadata?.icon;
        if (icon) found.set(community.idHex, icon);
      }
      if (!cancelled) setIcons(found);
    })();
    return () => {
      cancelled = true;
    };
    // `communities` is a fresh array on every vault read; the key is its
    // identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return icons;
}
