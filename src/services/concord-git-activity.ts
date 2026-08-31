/**
 * NIP-34 activity for the repository a Concord channel is attached to.
 *
 * The events are ORDINARY PUBLIC NOSTR — issues, patches, pull requests and
 * their statuses, signed by their authors and readable by anyone. Nothing here
 * touches a sealed plane: the channel supplies a repository coordinate, the
 * coordinate is queried on the repository's own relays, and the events land in
 * the singleton EventStore like any other public read.
 *
 * That direction matters for privacy. A REQ names a public repository and
 * nothing else — no community, no channel, no membership — so a relay learns
 * only that somebody is following a repository it already serves. Nothing about
 * the community leaves the device.
 *
 * The store is the surface: this service subscribes, and rings the channel's
 * wire scope so the chat adapter re-reads and merges. It never renders and
 * never holds the rows itself.
 */

import type { Filter } from "nostr-tools";

import { requestEvents } from "@/lib/relay-subscription";
import pool from "@/services/relay-pool";
import eventStore from "@/services/event-store";
import { FALLBACK_RELAYS } from "@/services/loaders";
import { getRepositoryRelays } from "@/lib/nip34-helpers";
import { channelScope, emitWireScopes } from "@/lib/concord/wire-bus";
import {
  GIT_REPOSITORY_ANNOUNCEMENT_KIND,
  type GitRepositoryAttachment,
} from "@/lib/concord/git";

/**
 * The kinds a channel shows: the tickets themselves and the statuses that close
 * them. NIP-22 comments (1111) are deliberately absent — a busy thread would
 * bury the conversation the channel is actually for.
 */
export const GIT_ACTIVITY_KINDS = [
  1617, // patch
  1618, // pull request
  1621, // issue
  1630, // status: open
  1631, // status: applied / merged
  1632, // status: closed
  1633, // status: draft
];

/** How many attached repositories one channel will follow at once. */
const MAX_FOLLOWED_REPOSITORIES = 4;

/** How far back the first fetch reaches, in events per repository. */
const BACKFILL_LIMIT = 200;

/** Live subscriptions, one entry per channel. */
const running = new Map<string, () => void>();

function activityFilter(coordinate: string): Filter {
  return {
    kinds: GIT_ACTIVITY_KINDS,
    "#a": [coordinate],
    limit: BACKFILL_LIMIT,
  };
}

/**
 * Where a repository is read from: the channel's own hints first — armada
 * recorded them at attach time, from the remote the user actually uses — then
 * whatever the announcement names, and the fallback relays as a floor so a channel
 * whose hints have gone stale still finds something.
 */
function relaysFor(attachment: GitRepositoryAttachment): string[] {
  const announcement = eventStore.getReplaceable(
    GIT_REPOSITORY_ANNOUNCEMENT_KIND,
    attachment.address.owner,
    attachment.address.identifier,
  );
  const announced = announcement ? getRepositoryRelays(announcement) : [];
  return [
    ...new Set([...attachment.relayHints, ...announced, ...FALLBACK_RELAYS]),
  ];
}

/**
 * Follow one channel's attached repositories until the returned function is
 * called. Calling it again for the same channel replaces the previous run, so a
 * re-opened channel never ends up with two subscriptions writing the same rows.
 */
export function startChannelGitActivity(
  channelIdHex: string,
  attachments: readonly GitRepositoryAttachment[],
): () => void {
  stopChannelGitActivity(channelIdHex);
  const followed = attachments.slice(0, MAX_FOLLOWED_REPOSITORIES);
  if (followed.length === 0) return () => undefined;

  const ring = () => emitWireScopes([channelScope(channelIdHex)]);
  const stops: Array<() => void> = [];
  let stopped = false;

  for (const attachment of followed) {
    const { coordinate, owner, identifier } = attachment.address;
    void (async () => {
      // The announcement first: it carries the repository's own relay set and
      // its display name, so the activity read that follows is aimed at the
      // relays the maintainer publishes to rather than the hints alone.
      await requestEvents(relaysFor(attachment), [
        {
          kinds: [GIT_REPOSITORY_ANNOUNCEMENT_KIND],
          authors: [owner],
          "#d": [identifier],
        },
      ]).catch(() => undefined);
      if (stopped) return;
      ring();

      const relays = relaysFor(attachment);
      const stored = await requestEvents(relays, [
        activityFilter(coordinate),
      ]).catch(() => []);
      if (stopped) return;
      if (stored.length > 0) ring();

      // Live from here. `pool.subscription()` without `{ eventStore }` writes
      // to a throwaway store, so the rows would never reach the timeline.
      const sub = pool
        .subscription(
          relays,
          [{ kinds: GIT_ACTIVITY_KINDS, "#a": [coordinate] }],
          { eventStore },
        )
        .subscribe({ next: ring, error: () => undefined });
      // The channel may have closed while the two reads were in flight, in
      // which case nothing is left to unsubscribe this.
      if (stopped) sub.unsubscribe();
      else stops.push(() => sub.unsubscribe());
    })();
  }

  const stop = () => {
    stopped = true;
    for (const s of stops) s();
    stops.length = 0;
  };
  running.set(channelIdHex, stop);
  return () => stopChannelGitActivity(channelIdHex);
}

/** Drop a channel's subscriptions. Safe to call for a channel never started. */
export function stopChannelGitActivity(channelIdHex: string): void {
  running.get(channelIdHex)?.();
  running.delete(channelIdHex);
}

/** Drop every channel's subscriptions — the adapter's teardown. */
export function stopAllGitActivity(): void {
  for (const stop of running.values()) stop();
  running.clear();
}
