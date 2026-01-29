/**
 * useRelaySelection - Relay selection hook for publishing
 *
 * Handles relay list management, selection state, and status tracking
 * for publishing events to multiple relays.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { use$ } from "applesauce-react/hooks";
import { useGrimoire } from "@/core/state";
import { useRelayState } from "@/hooks/useRelayState";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { normalizeRelayURL } from "@/lib/relay-url";
import pool from "@/services/relay-pool";
import type { RelayStrategy } from "@/lib/composer/schema";

// Per-relay publish status
export type RelayStatus = "pending" | "publishing" | "success" | "error";

export interface RelayPublishState {
  url: string;
  status: RelayStatus;
  error?: string;
}

export interface RelaySelectionOptions {
  /** Relay strategy from schema */
  strategy?: RelayStrategy;
  /** Address hints for address-bound events */
  addressHints?: string[];
  /** Context relay (for groups) */
  contextRelay?: string;
}

export interface UseRelaySelectionResult {
  /** Current relay states */
  relayStates: RelayPublishState[];
  /** Set of selected relay URLs */
  selectedRelays: Set<string>;
  /** Toggle a relay's selection */
  toggleRelay: (url: string) => void;
  /** Add a new relay to the list */
  addRelay: (url: string) => boolean;
  /** Check if input looks like a valid relay URL */
  isValidRelayInput: (input: string) => boolean;
  /** Reset relay states to pending */
  resetRelayStates: () => void;
  /** Update status for a specific relay */
  updateRelayStatus: (url: string, status: RelayStatus, error?: string) => void;
  /** Set all selected relays to publishing */
  setPublishing: () => void;
  /** Get relay pool connection status */
  getConnectionStatus: (url: string) => boolean;
  /** Get relay auth state */
  getRelayAuthState: (
    url: string,
  ) => ReturnType<typeof useRelayState>["getRelay"] extends (
    url: string,
  ) => infer R
    ? R
    : never;
  /** User's write relays (source list) */
  writeRelays: string[];
  /** Get added relays (not in writeRelays) */
  getAddedRelays: () => string[];
  /** Restore relay states (for draft loading) */
  restoreRelayStates: (selectedUrls: string[], addedUrls: string[]) => void;
}

export function useRelaySelection(
  options: RelaySelectionOptions = {},
): UseRelaySelectionResult {
  const { state } = useGrimoire();
  const { getRelay } = useRelayState();

  // Get relay pool state for connection status
  const relayPoolMap = use$(pool.relays$);

  // Determine write relays based on strategy
  const writeRelays = useMemo(() => {
    const { strategy, addressHints, contextRelay } = options;

    // Context-only strategy uses only the context relay
    if (strategy?.type === "context-only" && contextRelay) {
      return [contextRelay];
    }

    // Get user's write relays from account
    const userWriteRelays =
      state.activeAccount?.relays?.filter((r) => r.write).map((r) => r.url) ||
      [];

    // Address-hints strategy: use hints with user outbox fallback
    if (strategy?.type === "address-hints" && addressHints?.length) {
      return addressHints.length > 0 ? addressHints : userWriteRelays;
    }

    // Default: user-outbox or aggregator fallback
    return userWriteRelays.length > 0 ? userWriteRelays : AGGREGATOR_RELAYS;
  }, [state.activeAccount?.relays, options]);

  // Relay states
  const [relayStates, setRelayStates] = useState<RelayPublishState[]>([]);
  const [selectedRelays, setSelectedRelays] = useState<Set<string>>(new Set());

  // Initialize/update relay states when write relays change
  useEffect(() => {
    if (writeRelays.length > 0) {
      setRelayStates(
        writeRelays.map((url) => ({
          url,
          status: "pending" as RelayStatus,
        })),
      );
      setSelectedRelays(new Set(writeRelays));
    }
  }, [writeRelays]);

  // Toggle relay selection
  const toggleRelay = useCallback((url: string) => {
    setSelectedRelays((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }, []);

  // Check if input looks like a valid relay URL
  const isValidRelayInput = useCallback((input: string): boolean => {
    const trimmed = input.trim();
    if (!trimmed) return false;

    // Allow relay URLs with or without protocol
    const urlPattern =
      /^(wss?:\/\/)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(:[0-9]{1,5})?(\/.*)?$/;

    return urlPattern.test(trimmed);
  }, []);

  // Add a new relay to the list
  const addRelay = useCallback(
    (input: string): boolean => {
      const trimmed = input.trim();
      if (!trimmed || !isValidRelayInput(trimmed)) return false;

      try {
        const normalizedUrl = normalizeRelayURL(trimmed);

        // Check if already in list
        const alreadyExists = relayStates.some((r) => r.url === normalizedUrl);
        if (alreadyExists) {
          toast.error("Relay already in list");
          return false;
        }

        // Add to relay states
        setRelayStates((prev) => [
          ...prev,
          { url: normalizedUrl, status: "pending" as RelayStatus },
        ]);

        // Select the new relay
        setSelectedRelays((prev) => new Set([...prev, normalizedUrl]));

        return true;
      } catch (error) {
        console.error("Failed to add relay:", error);
        toast.error(
          error instanceof Error ? error.message : "Invalid relay URL",
        );
        return false;
      }
    },
    [isValidRelayInput, relayStates],
  );

  // Reset relay states to pending
  const resetRelayStates = useCallback(() => {
    setRelayStates(
      writeRelays.map((url) => ({
        url,
        status: "pending" as RelayStatus,
      })),
    );
    setSelectedRelays(new Set(writeRelays));
  }, [writeRelays]);

  // Update status for a specific relay
  const updateRelayStatus = useCallback(
    (url: string, status: RelayStatus, error?: string) => {
      setRelayStates((prev) =>
        prev.map((r) =>
          r.url === url ? { ...r, status, error: error ?? r.error } : r,
        ),
      );
    },
    [],
  );

  // Set all selected relays to publishing
  const setPublishing = useCallback(() => {
    const selected = Array.from(selectedRelays);
    setRelayStates((prev) =>
      prev.map((r) =>
        selected.includes(r.url)
          ? { ...r, status: "publishing" as RelayStatus }
          : r,
      ),
    );
  }, [selectedRelays]);

  // Get relay connection status
  const getConnectionStatus = useCallback(
    (url: string): boolean => {
      const poolRelay = relayPoolMap?.get(url);
      return poolRelay?.connected ?? false;
    },
    [relayPoolMap],
  );

  // Get relay auth state
  const getRelayAuthState = useCallback(
    (url: string) => {
      return getRelay(url);
    },
    [getRelay],
  );

  // Get added relays (not in writeRelays)
  const getAddedRelays = useCallback(() => {
    return relayStates
      .filter((r) => !writeRelays.includes(r.url))
      .map((r) => r.url);
  }, [relayStates, writeRelays]);

  // Restore relay states (for draft loading)
  const restoreRelayStates = useCallback(
    (selectedUrls: string[], addedUrls: string[]) => {
      // Set selected relays
      if (selectedUrls.length > 0) {
        setSelectedRelays(new Set(selectedUrls));
      }

      // Add custom relays that aren't in the current list
      if (addedUrls.length > 0) {
        setRelayStates((prev) => {
          const currentUrls = new Set(prev.map((r) => r.url));
          const newRelays = addedUrls
            .filter((url) => !currentUrls.has(url))
            .map((url) => ({
              url,
              status: "pending" as RelayStatus,
            }));
          return newRelays.length > 0 ? [...prev, ...newRelays] : prev;
        });
      }
    },
    [],
  );

  return {
    relayStates,
    selectedRelays,
    toggleRelay,
    addRelay,
    isValidRelayInput,
    resetRelayStates,
    updateRelayStatus,
    setPublishing,
    getConnectionStatus,
    getRelayAuthState,
    writeRelays,
    getAddedRelays,
    restoreRelayStates,
  };
}
