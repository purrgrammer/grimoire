/**
 * Whether the CONCORD pool is connected to each of a community's relays.
 *
 * The chat header's relay dropdown reads `useRelayState`, which is fed by
 * `relay-state-manager` — and that watches the SINGLETON pool
 * (`services/relay-pool`). Concord plane traffic deliberately does not run
 * there: it has its own pool (`services/concord-relay-pool`, the one exception
 * CLAUDE.md sanctions, because applesauce arms `receivedAuthRequiredForReq`
 * per-Relay and a plane REQ on a shared socket wedges grimoire's ordinary
 * reads).
 *
 * So the singleton's view of a Concord relay is not the connection the channel
 * is being read over. It reports whatever the rest of the app happens to be
 * doing with that host — usually nothing, which reads as "disconnected" while
 * the wire is perfectly healthy, and could equally read "connected" on a
 * socket Concord never used.
 *
 * This asks the pool that actually holds the sockets.
 */

import { useEffect, useState } from "react";
import { startWith } from "rxjs/operators";

import concordPool from "@/services/concord-relay-pool";

/**
 * `url → connected`, for the urls given. Absent means "not known yet" rather
 * than disconnected — the caller should not draw a red dot for a relay the
 * pool has not been asked about.
 */
export function useConcordRelayStatus(
  urls: string[] | undefined,
): Map<string, boolean> {
  const [status, setStatus] = useState<Map<string, boolean>>(new Map());
  // The urls arrive inside a fresh array on every fold, so the identity that
  // matters is their contents.
  const key = (urls ?? []).join(",");

  useEffect(() => {
    const list = key ? key.split(",") : [];
    // Nothing to watch. Clearing state here would be a synchronous setState in
    // an effect for a value the caller can simply be handed instead — see the
    // return below, which answers EMPTY whenever there are no urls.
    if (list.length === 0) return;
    // `startWith` rather than a setState before subscribing: `connected$` need
    // not replay, so a dropdown opened between emissions would show nothing —
    // but seeding by hand is a synchronous setState in the effect body, which
    // is the cascading-render pattern the React Compiler rules flag. Delivering
    // the seed through the stream puts the write in a callback where it
    // belongs.
    const subs = list.map((url) => {
      const relay = concordPool.relay(url);
      return (
        relay.connected$
          .pipe(startWith(relay.connected))
          // The seed emits synchronously, so the first write lands during the
          // effect — but inside a subscription callback, which is where the
          // React Compiler rules want a write to an external subscription to
          // live, so no exception is needed here.
          .subscribe((connected) => {
            setStatus((prev) => {
              if (prev.get(url) === connected) return prev;
              return new Map(prev).set(url, connected);
            });
          })
      );
    });
    return () => {
      for (const sub of subs) sub.unsubscribe();
    };
  }, [key]);

  return status;
}
