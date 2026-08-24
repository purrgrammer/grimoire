/**
 * Run nsites, recorded beside run napplets.
 *
 * One list, deliberately. To a reader, "the things I have opened with `app`" is
 * a single idea — the difference between a napplet and an nsite is how it runs,
 * not what it is to them — and the row already carries a `kind`, which is the
 * only thing a caller needs to route on.
 */

import { recordNappletRun } from "./napplet-library";
import { NSITE_KINDS } from "@/lib/nsite-kinds";
import type { ResolvedNsite } from "./nsite-host";

/** Whether a launcher row should open in the nsite viewer or the napplet one. */
export function isNsiteKind(kind: number): boolean {
  return (NSITE_KINDS as readonly number[]).includes(kind);
}

/**
 * Record a successful run.
 *
 * Called only after the aggregate verified, so the launcher can never offer a
 * site whose files failed their hashes.
 */
export async function recordNsiteRun(site: ResolvedNsite): Promise<void> {
  const event = site.manifestEvent;
  await recordNappletRun({
    pointer:
      event.kind === 5128
        ? { id: event.id, author: event.pubkey, kind: event.kind }
        : {
            kind: event.kind,
            pubkey: event.pubkey,
            identifier: site.identifier,
          },
    kind: event.kind,
    pubkey: event.pubkey,
    identifier: site.identifier,
    title: site.title || site.identifier || "Nsite",
    description: site.description,
    manifest: event,
  });
}
