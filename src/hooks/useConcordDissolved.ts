/**
 * Whether the open community has been dissolved, and the CORD-08 purge sweep.
 *
 * Both are edge maintenance that belongs to a mounted Concord window and to
 * nothing else, so they share a hook rather than each growing their own.
 *
 * The dissolution probe is terminal: once a tombstone is found it is recorded
 * and never re-derived, so this poll only ever discovers one — it can never
 * revive a community. A slow, foreground-only cadence is plenty: a dissolution
 * is rare, and the gates that matter (send, kick, rekey adoption) read the
 * stored verdict directly rather than waiting on this.
 */

import { useEffect, useState } from "react";

import type { Community } from "@/lib/concord/types";
import { syncDissolved } from "@/services/concord-dissolution";
import { sweepExpiredRumors } from "@/services/concord-expiry";

/** A dissolution is rare and terminal; noticing one late costs nothing. */
const POLL_MS = 5 * 60_000;

export function useConcordDissolved(
  community: Community | undefined,
): number | undefined {
  // Keyed BY SUBJECT rather than reset in an effect, like the other Concord
  // hooks: no write to state during a render pass, and no window where one
  // community wears another's verdict. The viewer switches communities in
  // place, so without the key a live community kept the dissolved badge of the
  // one looked at before it for the rest of the session.
  const [found, setFound] = useState<{ idHex: string; ms: number }>();
  const idHex = community?.idHex;

  useEffect(() => {
    if (!community) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const round = async () => {
      // Hiding is not disappearing (CORD-08 §3): the expired rumors a timeline
      // already refuses to show are still plaintext in IndexedDB. FIRST, not
      // after the dissolution check — a dissolved community returns early, and
      // a dead community whose history nobody will re-open is exactly the case
      // the purge exists for. Rate-limited and single-flight inside, so riding
      // this poll costs nothing.
      void sweepExpiredRumors();
      const ms = await syncDissolved(community).catch(() => undefined);
      if (cancelled) return;
      if (ms !== undefined) {
        setFound({ idHex: community.idHex, ms });
        return; // terminal — nothing left to poll for
      }
      timer = setTimeout(() => void round(), POLL_MS);
    };
    void round();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // Keyed on the id, not the object: the vault yields a fresh object per read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idHex]);

  return found && found.idHex === idHex ? found.ms : undefined;
}
