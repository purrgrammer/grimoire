/**
 * React hook for NIP-65 outbox relay selection
 *
 * Wraps the relay selection service for easy use in React components.
 * Automatically fetches kind:10002 relay lists and selects optimal relays
 * based on filter authors and #p tags.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useEventStore } from "applesauce-react/hooks";
import type { Filter as NostrFilter } from "nostr-tools";
import { selectRelaysForFilter } from "@/services/relay-selection";
import type {
  RelaySelectionResult,
  RelaySelectionOptions,
} from "@/types/relay-selection";

/**
 * Hook for selecting optimal relays for a Nostr filter using NIP-65
 *
 * @param filter - Nostr filter to select relays for
 * @param options - Configuration options
 * @returns Relay selection result with loading state
 *
 * @example
 * ```typescript
 * const { relays, reasoning, loading, isOptimized } = useOutboxRelays({
 *   authors: ["abc123..."],
 *   kinds: [1]
 * });
 *
 * // Use relays with useReqTimeline
 * const { events } = useReqTimeline("timeline-id", filter, relays);
 * ```
 */
export type RelaySelectionPhase = "discovering" | "selecting" | "ready";

/**
 * How long to keep waiting for a kind:10002 before committing to the fallback relays.
 *
 * `selectRelaysForFilter` gives each relay list one second, which a cold start
 * routinely loses: Dexie is empty, the EventStore has not been filled yet, and
 * every pointer comes back with no relays — so the whole query falls back to
 * FALLBACK_RELAYS. Committing that immediately sends the REQ to relays the
 * user never listed (the `req -p $me` → relay.primal.net report). Instead hold
 * the selection unready until either the relay list lands (see the kind:10002
 * watch below) or this deadline passes, at which point the fallback relays really are
 * the only answer left.
 */
const FALLBACK_GRACE_MS = 5000;

/**
 * How long to let kind:10002 arrivals pile up before re-selecting.
 *
 * `-a $contacts` watches hundreds of pubkeys, and their relay lists stream in
 * over several seconds. One selection pass per event would be hundreds of
 * `Promise.all` fetch rounds; a trailing window collapses them into one.
 */
const REVISION_DEBOUNCE_MS = 1000;

const HEX64 = /^[0-9a-f]{64}$/i;

export function useOutboxRelays(
  filter: NostrFilter,
  options?: RelaySelectionOptions,
): RelaySelectionResult & { loading: boolean; phase: RelaySelectionPhase } {
  const eventStore = useEventStore();
  const [result, setResult] = useState<RelaySelectionResult>({
    relays: options?.fallbackRelays || [],
    reasoning: [],
    isOptimized: false,
    blocked: [],
  });
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<RelaySelectionPhase>("discovering");

  // Bumped whenever a kind:10002 for one of the filter's pubkeys reaches the
  // EventStore, so a relay list that arrives after the fetch timeout still
  // gets a chance to replace the fallback selection.
  const [revision, setRevision] = useState(0);

  // Stable reference for filter.authors and filter["#p"]
  // Only re-run when these change
  const authorsKey = useMemo(
    () => JSON.stringify(filter.authors || []),
    [filter.authors],
  );
  const pTagsKey = useMemo(
    () => JSON.stringify(filter["#p"] || []),
    [filter["#p"]],
  );

  // Stable reference for fallbackRelays array
  const fallbackRelaysKey = useMemo(
    () => JSON.stringify(options?.fallbackRelays || []),
    [options?.fallbackRelays],
  );

  const pubkeys = useMemo(() => {
    const all = [
      ...(JSON.parse(authorsKey) as string[]),
      ...(JSON.parse(pTagsKey) as string[]),
    ];
    return Array.from(new Set(all.filter((pk) => HEX64.test(pk))));
  }, [authorsKey, pTagsKey]);

  const pubkeysKey = useMemo(() => pubkeys.join(","), [pubkeys]);

  // Watch for relay lists arriving late. Without this the selection made in the
  // first second of the window's life is the selection it keeps forever.
  useEffect(() => {
    if (pubkeys.length === 0) return;

    let debounce: ReturnType<typeof setTimeout> | undefined;

    const subscription = eventStore
      .filters({ kinds: [10002], authors: pubkeys })
      .subscribe(() => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(
          () => setRevision((r) => r + 1),
          REVISION_DEBOUNCE_MS,
        );
      });

    return () => {
      subscription.unsubscribe();
      if (debounce) clearTimeout(debounce);
    };
  }, [eventStore, pubkeys]);

  // When the filter changes, the grace period starts over. Stamped from an
  // effect (which runs before the selection effect below resolves) rather than
  // from `useRef(Date.now())`, which reads a clock during render.
  const graceStartRef = useRef(0);
  useEffect(() => {
    graceStartRef.current = Date.now();
  }, [pubkeysKey]);

  // Whether a selection has already been committed for this filter. Re-running
  // selection after that point must not drop the phase back out of "ready":
  // the caller treats an unready phase as "no relays", which tears down every
  // live subscription and rebuilds it a second later. Serve the committed set
  // while the new one computes.
  const committedRef = useRef(false);
  useEffect(() => {
    committedRef.current = false;
  }, [pubkeysKey]);

  // The relay set currently committed, as a stable key. A re-selection that
  // lands on the same relays must not produce a new array identity — that
  // alone would re-key the caller's subscriptions.
  const relaySetRef = useRef("");

  // Extract primitive options to avoid object reference issues
  const maxRelays = options?.maxRelays;
  const maxRelaysPerUser = options?.maxRelaysPerUser;
  const timeout = options?.timeout;

  useEffect(() => {
    let cancelled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    async function selectRelays() {
      const revalidating = committedRef.current;

      if (!revalidating) {
        setLoading(true);
        setPhase("discovering");
      }

      try {
        // Reconstruct options inside effect to avoid dependency on object reference
        const selectionOptions: RelaySelectionOptions = {
          fallbackRelays: JSON.parse(fallbackRelaysKey),
          maxRelays,
          maxRelaysPerUser,
          timeout,
        };

        if (!revalidating) setPhase("selecting");
        const selection = await selectRelaysForFilter(
          eventStore,
          filter,
          selectionOptions,
        );

        if (cancelled) return;

        const relaySetKey = [...selection.relays].sort().join(",");
        if (relaySetKey !== relaySetRef.current) {
          relaySetRef.current = relaySetKey;
          setResult(selection);
        }

        // `isOptimized: false` means every pubkey in the filter came back
        // without a relay list, so `selection.relays` is nothing but
        // fallback relays. Stay unready (the caller subscribes to no relays) until
        // the grace period runs out — a kind:10002 arrival re-runs this effect.
        const isPureFallback = !selection.isOptimized && pubkeys.length > 0;
        const graceExpired =
          Date.now() - graceStartRef.current >= FALLBACK_GRACE_MS;

        if (!revalidating && isPureFallback && !graceExpired) {
          setPhase("selecting");
          graceTimer = setTimeout(
            () => setRevision((r) => r + 1),
            FALLBACK_GRACE_MS - (Date.now() - graceStartRef.current),
          );
          return;
        }

        committedRef.current = true;
        setPhase("ready");
      } catch (err) {
        console.error("[useOutboxRelays] Failed to select relays:", err);
        // Keep previous result on error
        if (!cancelled) {
          setPhase("ready");
        }
      } finally {
        if (!cancelled && !revalidating) {
          setLoading(false);
        }
      }
    }

    selectRelays();

    return () => {
      cancelled = true;
      if (graceTimer) clearTimeout(graceTimer);
    };
  }, [
    eventStore,
    authorsKey,
    pTagsKey,
    fallbackRelaysKey,
    maxRelays,
    maxRelaysPerUser,
    timeout,
    revision,
    pubkeys,
  ]);

  return {
    ...result,
    loading,
    phase,
  };
}
