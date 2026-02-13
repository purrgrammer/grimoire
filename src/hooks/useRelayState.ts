import { useEffect } from "react";
import { useAtom } from "jotai";
import { grimoireStateAtom } from "@/core/state";
import relayStateManager from "@/services/relay-state-manager";
import type { AuthPreference, RelayState } from "@/types/relay-state";
import { normalizeRelayURL } from "@/lib/relay-url";

/**
 * Hook for accessing and managing global relay state
 */
export function useRelayState() {
  const [state, setState] = useAtom(grimoireStateAtom);

  // Subscribe to relay state manager updates
  useEffect(() => {
    // Initialize state immediately if not set (before subscription)
    setState((prev) => {
      if (prev.relayState) return prev;
      return {
        ...prev,
        relayState: relayStateManager.getState(),
      };
    });

    // Subscribe to updates
    const unsubscribe = relayStateManager.subscribe((relayState) => {
      setState((prev) => ({
        ...prev,
        relayState,
      }));
    });

    return unsubscribe;
    // Only depend on setState - it's stable from Jotai
    // Don't include state.relayState to avoid re-subscription loops
  }, [setState]);

  const relayState = state.relayState;

  return {
    // Current state
    relayState,
    relays: relayState?.relays || {},
    pendingChallenges: relayState?.pendingChallenges || [],
    authPreferences: relayState?.authPreferences || {},

    // Get single relay state
    getRelay: (url: string): RelayState | undefined => {
      const normalizedUrl = normalizeRelayURL(url);
      return relayState?.relays[normalizedUrl];
    },

    // Get auth preference (now synchronous)
    getAuthPreference: (url: string): AuthPreference | undefined => {
      return relayStateManager.getAuthPreference(url);
    },

    // Set auth preference (now synchronous)
    setAuthPreference: (url: string, preference: AuthPreference) => {
      relayStateManager.setAuthPreference(url, preference);
    },

    // Authenticate with relay
    authenticateRelay: async (url: string) => {
      await relayStateManager.authenticateRelay(url);
    },

    // Reject auth for relay
    rejectAuth: (url: string, rememberForSession = true) => {
      relayStateManager.rejectAuth(url, rememberForSession);
    },

    // Ensure relay is monitored
    ensureRelayMonitored: (url: string) => {
      relayStateManager.ensureRelayMonitored(url);
    },
  };
}
