/**
 * Is this community dead? — CORD-02 §9.
 *
 * Ported from armada `bc19d1f` (`useDissolved` / `dissolvedAt` in
 * `src/concord/hooks/useControlPlane.ts`), minus its per-relay probe batcher:
 * grimoire opens one community at a time, so there is no boot burst to
 * coalesce.
 *
 * TERMINAL AND ONE-WAY. Once a tombstone is seen its ms is written to Dexie and
 * this never touches the network for that community again — there is no
 * un-dissolve, so a later empty read must never be able to revive it.
 *
 * The answer is a TIMESTAMP, not a boolean. Both planes replay from history, so
 * a caller judging a past action has to know whether it predates the grave
 * (honored) or follows it (refused).
 */

import type { RelayPool } from "applesauce-relay";

import { dissolvedGroupKey } from "@/lib/concord/derive";
import { findTombstone, isDissolvedOpened } from "@/lib/concord/dissolution";
import { KIND_WRAP } from "@/lib/concord/kinds";
import { planeRequest } from "@/lib/concord/plane-request";
import type { Community } from "@/lib/concord/types";
import { queryPlane, writeOpened } from "@/services/concord-rumor-store";
import { openWrap, type OpenedWireEvent } from "@/lib/concord/stream";
import db from "@/services/db";

const KEY_PREFIX = "concord-dissolved:";
const PROBE_TIMEOUT_MS = 10_000;
/** The grave is one chainless event; a handful of slots covers impostor noise. */
const PROBE_LIMIT = 10;

/** Session memo, so a remount never shows a live composer over a grave. */
const memo = new Map<string, number>();

/**
 * The tombstone ms for a community we have EVER seen dissolved, or undefined.
 *
 * Local only — no network, no re-derivation. This is what the gates call, so it
 * has to be cheap enough to sit in front of every write.
 */
export async function dissolvedAt(idHex: string): Promise<number | undefined> {
  const cached = memo.get(idHex);
  if (cached !== undefined) return cached;
  try {
    const row = await db.concordKv.get(`${KEY_PREFIX}${idHex}`);
    const value = row?.value;
    if (typeof value === "number" && Number.isFinite(value)) {
      memo.set(idHex, value);
      return value;
    }
  } catch {
    // A cold or broken cache reads as "not known dead", which is the same
    // answer as never having looked.
  }
  return undefined;
}

async function remember(idHex: string, ms: number): Promise<void> {
  memo.set(idHex, ms);
  try {
    await db.concordKv.put({ key: `${KEY_PREFIX}${idHex}`, value: ms });
  } catch {
    // The session memo still holds it; the probe re-finds it next launch.
  }
}

/** Test seam: forget every dissolution verdict, session and persisted. */
export async function _resetDissolutionForTests(): Promise<void> {
  resetDissolutionMemory();
  await db.concordKv.where("key").startsWith(KEY_PREFIX).delete();
}

/**
 * Forget the session memo of which communities are dissolved.
 *
 * Called on logout; also the test seam for exercising the PERSISTED half,
 * since it deliberately keeps the rows.
 */
export function resetDissolutionMemory(): void {
  memo.clear();
}

/**
 * Look for this community's tombstone: memo, then store, then the wire.
 *
 * The grave marker is an ordinary control-kind rumor, so it reads back with the
 * rest of the plane — `isDissolvedOpened` is what identifies it, and it
 * authenticates on the seal signer being the owner, which the address it
 * arrived at never established anyway.
 */
export async function syncDissolved(
  community: Community,
  opts: { pool?: RelayPool } = {},
): Promise<number | undefined> {
  // Known dead → done. Never re-derived, so nothing can undo it.
  const known = await dissolvedAt(community.idHex);
  if (known !== undefined) return known;

  const stored = await queryPlane(community.idHex, "control");
  const cached = stored.find((o) =>
    isDissolvedOpened(o, community.owner, community.id),
  );
  if (cached) {
    await remember(community.idHex, cached.ms);
    return cached.ms;
  }

  const group = dissolvedGroupKey(community.id);
  const results = await Promise.all(
    community.relays.map(async (url) => {
      const read = await planeRequest(
        url,
        { kinds: [KIND_WRAP], authors: [group.pk], limit: PROBE_LIMIT },
        { timeout: PROBE_TIMEOUT_MS, pool: opts.pool },
      ).catch(() => undefined);
      return read?.outcome === "eose" ? read.events : [];
    }),
  );
  const wraps = results.flat();
  if (wraps.length === 0) return undefined;

  // Store what opens, so a later launch finds the grave without a probe.
  const opened: OpenedWireEvent[] = [];
  for (const wrap of wraps) {
    try {
      opened.push(openWrap(wrap, group));
    } catch {
      // Anyone can publish here; only the owner's signature counts.
    }
  }
  if (opened.length > 0) {
    void writeOpened(community.idHex, opened, "control", {
      refounded: community.rootEpoch > 0n,
    }).catch(() => undefined);
  }

  const ms = findTombstone(wraps, community.id, community.owner);
  if (ms === undefined) return undefined;
  await remember(community.idHex, ms);
  return ms;
}
