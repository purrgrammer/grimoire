/**
 * The CORD-08 §3 purge sweep: physically delete expired rumors from Dexie.
 *
 * The other two duties are already met elsewhere — `writeChatRumors` refuses an
 * already-expired rumor at ingest, and `foldTimeline` refuses to display one
 * that expired after it was stored. This is the third, and it is the one that
 * matters most: **hiding is not disappearing, and the local store is exactly
 * the artifact a seized device surrenders.** A rumor filtered out of a timeline
 * is still sitting in IndexedDB as plaintext.
 *
 * Grimoire-specific: armada purges through its per-community rumor store's own
 * eviction, which grimoire does not have — one Dexie table serves every
 * community, so the sweep is a table scan rather than a store drop.
 *
 * CHAT ROWS ONLY. CORD-08 is a Chat-plane feature: `message_expiration` sets a
 * timer for messages, and only `writeChatRumors` refuses an expired rumor at
 * ingest. A plane rumor carrying an `expiration` tag is not a disappearing
 * message, it is a non-compliant one — and deleting it is not recoverable,
 * because the Guestbook rides a PERSISTED forward cursor and never re-fetches
 * behind it. Concretely: a member publishes their own Leave (kind 3306) with a
 * past `expiration`, this sweep deletes it, the cursor never serves it again,
 * and the coalesce falls back to their older Join — a permanent local presence
 * spoof. So the plane kinds are skipped, and their rumors are simply stored.
 */

import { isExpired } from "@/lib/concord/disappearing";
import { PLANE_KINDS } from "@/lib/concord/kinds";
import db from "@/services/db";

/** At most one sweep this often — it is a full scan of the rumor table. */
const SWEEP_INTERVAL_MS = 10 * 60_000;
/** Deletes per batch, so a large purge never blocks the main thread whole. */
const BATCH = 500;

let lastSweep = 0;
let inFlight: Promise<number> | undefined;

/** Test seam: allow the next sweep to run immediately. */
export function _resetExpirySweepForTests(): void {
  lastSweep = 0;
  inFlight = undefined;
}

/**
 * Delete every stored rumor whose NIP-40 deadline has passed.
 *
 * Returns how many rows went. Rate-limited and single-flight: several Concord
 * windows mounting at once must not each scan the table.
 */
export function sweepExpiredRumors(
  opts: { force?: boolean; nowSecs?: number } = {},
): Promise<number> {
  // A FORCED sweep waits for the one in flight and then runs its own, rather
  // than silently inheriting a result that was computed before whatever the
  // caller wants swept existed. An unforced caller joins, which is the point of
  // the single flight.
  if (inFlight) {
    return opts.force
      ? inFlight.then(() => sweepExpiredRumors(opts))
      : inFlight;
  }
  const now = Date.now();
  if (!opts.force && now - lastSweep < SWEEP_INTERVAL_MS) {
    return Promise.resolve(0);
  }
  lastSweep = now;
  const run = purge(opts.nowSecs ?? Math.floor(Date.now() / 1000)).finally(
    () => {
      if (inFlight === run) inFlight = undefined;
    },
  );
  inFlight = run;
  return run;
}

async function purge(nowSecs: number): Promise<number> {
  let doomed: string[] = [];
  let deleted = 0;
  try {
    await db.concordRumors.each((row) => {
      if (PLANE_KINDS.has(row.kind)) return;
      if (isExpired(row.tags, nowSecs)) doomed.push(row.id);
    });
    for (let i = 0; i < doomed.length; i += BATCH) {
      const batch = doomed.slice(i, i + BATCH);
      await db.concordRumors.bulkDelete(batch);
      deleted += batch.length;
      // Yield between batches: this runs on the main thread beside a live
      // chat, and a purge of thousands should not freeze it.
      if (i + BATCH < doomed.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } catch (error) {
    console.warn("[concord] expiry sweep failed:", error);
  }
  doomed = [];
  if (deleted > 0) {
    console.debug(`[concord] purged ${deleted} expired rumor(s)`);
  }
  return deleted;
}
