/**
 * React hook for NIP-65 outbox relay selection
 *
 * Wraps the relay selection service for easy use in React components.
 * Automatically fetches kind:10002 relay lists and selects optimal relays
 * based on filter authors and #p tags.
 */

import { useState, useEffect, useMemo } from "react";
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

export function useOutboxRelays(
  filter: NostrFilter,
  options?: RelaySelectionOptions,
): RelaySelectionResult & { loading: boolean; phase: RelaySelectionPhase } {
  const eventStore = useEventStore();
  const [result, setResult] = useState<RelaySelectionResult>({
    relays: options?.fallbackRelays || [],
    reasoning: [],
    isOptimized: false,
  });
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<RelaySelectionPhase>("discovering");

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

  // Extract primitive options to avoid object reference issues
  const maxRelays = options?.maxRelays;
  const maxRelaysPerUser = options?.maxRelaysPerUser;
  const timeout = options?.timeout;

  useEffect(() => {
    let cancelled = false;

    async function selectRelays() {
      setLoading(true);
      setPhase("discovering");

      try {
        // Reconstruct options inside effect to avoid dependency on object reference
        const selectionOptions: RelaySelectionOptions = {
          fallbackRelays: JSON.parse(fallbackRelaysKey),
          maxRelays,
          maxRelaysPerUser,
          timeout,
        };

        setPhase("selecting");
        const selection = await selectRelaysForFilter(
          eventStore,
          filter,
          selectionOptions,
        );

        if (!cancelled) {
          setResult(selection);
          setPhase("ready");
        }
      } catch (err) {
        console.error("[useOutboxRelays] Failed to select relays:", err);
        // Keep previous result on error
        if (!cancelled) {
          setPhase("ready");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    selectRelays();

    return () => {
      cancelled = true;
    };
  }, [
    eventStore,
    authorsKey,
    pTagsKey,
    fallbackRelaysKey,
    maxRelays,
    maxRelaysPerUser,
    timeout,
  ]);

  return {
    ...result,
    loading,
    phase,
  };
}
