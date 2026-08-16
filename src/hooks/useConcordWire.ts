/**
 * Mount the wire for the viewer's communities.
 *
 * Builds the subscription spec from what the client already holds — the
 * Community List for the control planes, the stored fold for the channels — and
 * hands it to `setWireSpec`, which diffs it per relay.
 *
 * Two sourcing rules, and the second one is load-bearing:
 *
 * - channels come from the FOLD, because that is the only thing that knows which
 *   channels exist and which of them this member holds keys for;
 * - control planes come from the COMMUNITY RECORD, never the fold. A Refounded
 *   community whose compaction snapshot has not landed yet folds to nothing, and
 *   the control subscription is precisely what delivers that snapshot. Gate one
 *   on the other and such a community never subscribes, never receives the
 *   snapshot, and never folds.
 *
 * Refcounted: several Concord windows share one wire, and the last one out turns
 * it off.
 */

import { useEffect, useState } from "react";

import { heldControlPlanes } from "@/lib/concord/control-address";
import type { Community } from "@/lib/concord/types";
import { controlScope, onWireScopes } from "@/lib/concord/wire-bus";
import { buildWireSpec, type WireInputs } from "@/lib/concord/wire-spec";
import { registerStreamKeys } from "@/lib/concord/stream-auth";
import { readStoredState } from "@/services/concord-state";
import { setWireSpec, stopWire } from "@/services/concord-wire";
import { startOutboxDrain, stopOutboxDrain } from "@/services/concord-outbox";

let mounted = 0;

/** Assemble the spec from the store. No network. */
async function buildInputs(communities: Community[]): Promise<WireInputs> {
  const inputs: WireInputs = { channels: [], control: [] };

  for (const community of communities) {
    if (community.relays.length === 0) continue;

    const held = heldControlPlanes(community);
    const current = held.find((plane) => plane.epoch === community.rootEpoch);
    if (current) {
      inputs.control.push({
        relays: community.relays,
        idHex: community.idHex,
        current: current.group,
        groups: held.map((plane) => plane.group),
        refounded: community.rootEpoch > 0n,
      });
      // Scoped per community: a relay's NIP-42 challenge must only ever be
      // answered with the stream keys that relay actually hosts.
      registerStreamKeys(
        held.map((plane) => plane.group),
        community.relays,
      );
    }

    const state = await readStoredState(community);
    for (const channel of state?.channels ?? []) {
      inputs.channels.push({
        relays: community.relays,
        channel,
        communityIdHex: community.idHex,
      });
      registerStreamKeys(
        channel.streams.map((stream) => stream.group),
        community.relays,
      );
    }
  }

  return inputs;
}

/**
 * Keep the wire pointed at these communities.
 *
 * Re-runs when the community set changes, and when any community's control
 * plane rings — a channel created in Armada arrives as a control edition, and
 * the wire has to widen its own filters to start listening to it.
 */
export function useConcordWire(communities: Community[]): void {
  const key = communities
    .map((c) => `${c.idHex}@${c.rootEpoch}`)
    .sort()
    .join(",");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const watched = new Set(communities.map((c) => controlScope(c.idHex)));
    return onWireScopes((scopes) => {
      for (const scope of scopes) {
        if (watched.has(scope)) {
          setRevision((n) => n + 1);
          return;
        }
      }
    });
    // Keyed on the community ids, not the objects: the vault yields fresh
    // objects on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The refcount owns the wire's LIFETIME, and nothing else. It deliberately has
  // no deps: React runs a cleanup before every re-run, so folding this into the
  // spec effect below would drop the count to zero on each revision bump —
  // `stopWire` would tear down every relay's standing REQ (and re-auth it on a
  // gating relay) each time one control edition arrived live, and the per-relay
  // diff would never get to do its job because `loops` was already cleared.
  useEffect(() => {
    mounted += 1;
    // Queued sends go out over the wire's own sockets, so the queue listens for
    // exactly as long as the wire holds them. Idempotent, like the wire itself.
    startOutboxDrain();
    return () => {
      mounted -= 1;
      // The last Concord window closing is the only reason to drop the sockets.
      if (mounted === 0) {
        stopWire();
        stopOutboxDrain();
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const inputs = await buildInputs(communities);
        // No teardown here on purpose: `setWireSpec` diffs per relay, so a spec
        // that did not change costs nothing and one that grew a channel restarts
        // only the relays that actually gained a filter.
        if (!cancelled) setWireSpec(buildWireSpec(inputs));
      } catch (error) {
        console.warn("[concord] could not start the wire:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
}
