/**
 * Running a Concord search from a component.
 *
 * Three things this owns and the service deliberately does not: the pause
 * before a scan starts, cancelling the scan a new keystroke supersedes, and
 * re-running when a message lands in a channel the results are drawn from.
 *
 * The debounce is an inline effect + `setTimeout`. There is no `useDebounce` in
 * this repo and no react-query, so armada's hook cannot be lifted; the timer is
 * the whole of it. Each run holds an `AbortController` the next run aborts,
 * which is what the service checks between channels — a fast typist leaves at
 * most one scan alive.
 *
 * Live results: the adapter's own doorbell scope (`c2:<channelIdHex>`) rings
 * once a channel's rumors are durably stored, so listening to the in-scope
 * channels' scopes means a message arriving while results are open shows up in
 * them. A ring is a re-read of the store, never a fetch.
 */

import { useEffect, useRef, useState } from "react";

import {
  SEARCH_DEBOUNCE_MS,
  searchIsActive,
  type ConcordSearchFilters,
} from "@/lib/concord/search";
import type { Channel, Community } from "@/lib/concord/types";
import type { FoldedControl } from "@/lib/concord/control";
import { channelScope, onWireScope } from "@/lib/concord/wire-bus";
import {
  searchConcordMessages,
  type ConcordSearchHit,
} from "@/services/concord-search";

export interface ConcordSearchResult {
  hits: ConcordSearchHit[];
  /** A scan is running — distinct from "ran and found nothing". */
  searching: boolean;
  /**
   * The scan cannot start yet, because the community has not folded.
   *
   * A third state rather than a slower `searching`: nothing is being scanned,
   * so a spinner captioned "searching…" claims work that is not happening — and
   * on a community whose control plane never resolves it would claim it
   * forever.
   */
  waiting: boolean;
  /** Whether the filters constitute a search at all. */
  active: boolean;
}

const NO_HITS: ConcordSearchHit[] = [];

export function useConcordSearch(
  community: Community | undefined,
  folded: FoldedControl | undefined,
  channels: readonly Channel[],
  filters: ConcordSearchFilters,
): ConcordSearchResult {
  const [state, setState] = useState<{
    /** Which run these hits belong to — a stale run's answer is discarded. */
    token: string;
    /** The ring this answer counted; a later ring supersedes it. */
    ring: number;
    hits: ConcordSearchHit[];
  }>();
  const abort = useRef<AbortController>(undefined);

  const active = searchIsActive(filters);
  const idHex = community?.idHex;
  // The fold and the channel list are rebuilt on every read, so their identity
  // is their content — the same reason `useConcordUnread` keys on joined ids.
  const scopeKey = filters.channelIds.length
    ? filters.channelIds.join(",")
    : channels.map((ch) => ch.idHex).join(",");
  const token = `${idHex ?? ""}|${filters.query.trim().toLowerCase()}|${scopeKey}`;

  // A ring on any in-scope channel re-runs the scan. A nonce rather than a
  // direct call: the run belongs to the effect below, which already knows how
  // to abort the one it replaces.
  const [ring, setRing] = useState(0);
  useEffect(() => {
    if (!active || !idHex) return;
    const ids = scopeKey ? scopeKey.split(",").filter(Boolean) : [];
    if (ids.length === 0) return;
    const offs = ids.map((id) =>
      onWireScope(channelScope(id), () => setRing((n) => n + 1)),
    );
    return () => {
      for (const off of offs) off();
    };
  }, [active, idHex, scopeKey]);

  // Whether a scan CAN run. In the deps below because the fold arrives after
  // the first render on a cold community: without it the effect that returned
  // early would never be re-run, and the pane would wait on a scan nobody had
  // scheduled.
  const ready = !!community && !!folded;

  useEffect(() => {
    abort.current?.abort();
    if (!active || !community || !folded) return;
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => {
      void searchConcordMessages(community, folded, channels, filters, {
        signal: controller.signal,
      })
        .then((hits) => {
          if (controller.signal.aborted) return;
          setState({ token, ring, hits });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn("[concord] search failed:", error);
          setState({ token, ring, hits: [] });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `community`, `folded`, `channels` and `filters` are all rebuilt per read
    // or per render; `token` is their identity for this purpose, `ring` is the
    // wire asking for a re-run, and `ready` is the fold turning up at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, active, ring, ready]);

  // Whether a scan is running is DERIVED, not stored: it is exactly "this run
  // has not answered yet". A `searching` flag set from the effect would say the
  // same thing one render later, and cost a cascading render to say it.
  const answered = state?.token === token && state.ring === ring;
  // Superseding a QUERY and superseding a RING are not the same event, and the
  // difference is what the reader sees. A changed query makes the hits on
  // screen wrong — they answer a question nobody asked. A ring makes them
  // merely INCOMPLETE: one more message may have landed in a channel already
  // being searched. So a ring keeps the list up while the re-scan runs, which
  // is what stops a busy community from blanking the pane to "searching…" every
  // time anyone speaks.
  const forThisQuery = state?.token === token;
  const waiting = active && !ready;

  return {
    hits: active && forThisQuery ? state.hits : NO_HITS,
    searching: active && !waiting && !answered,
    waiting,
    active,
  };
}
