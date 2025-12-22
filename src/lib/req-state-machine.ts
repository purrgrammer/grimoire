import type {
  ReqRelayState,
  ReqOverallState,
  ReqOverallStatus,
} from "@/types/req-state";

/**
 * Derive overall query status from individual relay states
 *
 * This function implements the core state machine logic that determines
 * the overall status of a REQ subscription based on the states of individual
 * relays. It handles edge cases like all-relays-disconnected, partial failures,
 * and distinguishes between CLOSED and OFFLINE states.
 *
 * @param relayStates - Map of relay URLs to their current states
 * @param overallEoseReceived - Whether the group subscription emitted EOSE
 * @param isStreaming - Whether this is a streaming subscription (stream=true)
 * @param queryStartedAt - Timestamp when the query started
 * @returns Aggregated state for the entire query
 */
export function deriveOverallState(
  relayStates: Map<string, ReqRelayState>,
  overallEoseReceived: boolean,
  isStreaming: boolean,
  queryStartedAt: number,
): ReqOverallState {
  const states = Array.from(relayStates.values());

  // Count relay states
  const totalRelays = states.length;
  const connectedCount = states.filter(
    (s) => s.connectionState === "connected",
  ).length;
  const receivingCount = states.filter(
    (s) => s.subscriptionState === "receiving",
  ).length;
  const eoseCount = states.filter((s) => s.subscriptionState === "eose").length;
  const errorCount = states.filter((s) => s.connectionState === "error").length;
  const disconnectedCount = states.filter(
    (s) => s.connectionState === "disconnected",
  ).length;

  // Calculate flags
  const hasReceivedEvents = states.some((s) => s.eventCount > 0);
  const hasActiveRelays = connectedCount > 0;
  const allRelaysFailed = totalRelays > 0 && errorCount === totalRelays;
  const allDisconnected =
    totalRelays > 0 && disconnectedCount + errorCount === totalRelays;

  // Timing
  const firstEventAt = states
    .map((s) => s.firstEventAt)
    .filter((t): t is number => t !== undefined)
    .sort((a, b) => a - b)[0];

  const allEoseAt = overallEoseReceived ? Date.now() : undefined;

  // Check if all relays are in terminal states (won't make further progress)
  const allRelaysTerminal = states.every(
    (s) =>
      s.subscriptionState === "eose" ||
      s.connectionState === "error" ||
      s.connectionState === "disconnected",
  );

  // Derive status based on relay states and flags
  const status: ReqOverallStatus = (() => {
    // No relays selected yet (NIP-65 discovery in progress)
    if (totalRelays === 0) {
      return "discovering";
    }

    // All relays failed to connect, no events received
    if (allRelaysFailed && !hasReceivedEvents) {
      return "failed";
    }

    // All relays are in terminal states (done trying)
    // This handles the case where relays disconnect before EOSE
    if (allRelaysTerminal && !overallEoseReceived) {
      if (!hasReceivedEvents) {
        // All relays gave up before sending events
        return "failed";
      }
      if (!hasActiveRelays) {
        // Received events but all relays disconnected before EOSE
        if (isStreaming) {
          return "offline"; // Was trying to stream, now offline
        } else {
          return "closed"; // Non-streaming query, relays closed
        }
      }
      // Some relays still active but all others terminated
      // This is a partial success scenario
      return "partial";
    }

    // No relays connected and no events received yet
    if (!hasActiveRelays && !hasReceivedEvents) {
      return "connecting";
    }

    // Had events and EOSE, but all relays disconnected now
    if (allDisconnected && hasReceivedEvents && overallEoseReceived) {
      if (isStreaming) {
        return "offline"; // Was live, now offline
      } else {
        return "closed"; // Completed and closed (expected)
      }
    }

    // EOSE not received yet, still loading initial data
    if (!overallEoseReceived) {
      return "loading";
    }

    // EOSE received, but some relays have issues (check this before "live")
    if (overallEoseReceived && (errorCount > 0 || disconnectedCount > 0)) {
      if (hasActiveRelays) {
        return "partial"; // Some working, some not
      } else {
        return "offline"; // All disconnected after EOSE
      }
    }

    // EOSE received, streaming mode, all relays healthy and connected
    if (overallEoseReceived && isStreaming && hasActiveRelays) {
      return "live";
    }

    // EOSE received, not streaming, all done
    if (overallEoseReceived && !isStreaming) {
      return "closed";
    }

    // Default fallback (should rarely hit this)
    return "loading";
  })();

  return {
    status,
    totalRelays,
    connectedCount,
    receivingCount,
    eoseCount,
    errorCount,
    disconnectedCount,
    hasReceivedEvents,
    hasActiveRelays,
    allRelaysFailed,
    queryStartedAt,
    firstEventAt,
    allEoseAt,
  };
}

/**
 * Get user-friendly status text for display
 */
export function getStatusText(state: ReqOverallState): string {
  switch (state.status) {
    case "discovering":
      return "DISCOVERING";
    case "connecting":
      return "CONNECTING";
    case "loading":
      return "LOADING";
    case "live":
      return "LIVE";
    case "partial":
      return "PARTIAL";
    case "offline":
      return "OFFLINE";
    case "closed":
      return "CLOSED";
    case "failed":
      return "FAILED";
  }
}

/**
 * Get detailed status description for tooltips
 */
export function getStatusTooltip(state: ReqOverallState): string {
  const { status, connectedCount, totalRelays, hasReceivedEvents } = state;

  switch (status) {
    case "discovering":
      return "Selecting optimal relays using NIP-65";
    case "connecting":
      return `Connecting to ${totalRelays} relay${totalRelays !== 1 ? "s" : ""}...`;
    case "loading":
      return hasReceivedEvents
        ? `Loading events from ${connectedCount}/${totalRelays} relays`
        : `Waiting for events from ${connectedCount}/${totalRelays} relays`;
    case "live":
      return `Streaming live events from ${connectedCount}/${totalRelays} relays`;
    case "partial":
      return `${connectedCount}/${totalRelays} relays active, some failed or disconnected`;
    case "offline":
      return "All relays disconnected. Showing cached results.";
    case "closed":
      return "Query completed, all relays closed";
    case "failed":
      return `Failed to connect to any of ${totalRelays} relays`;
  }
}

/**
 * Get status indicator color class
 */
export function getStatusColor(status: ReqOverallStatus): string {
  switch (status) {
    case "discovering":
    case "connecting":
    case "loading":
      return "text-yellow-500";
    case "live":
      return "text-green-500";
    case "partial":
      return "text-yellow-500";
    case "closed":
      return "text-muted-foreground";
    case "offline":
    case "failed":
      return "text-red-500";
  }
}

/**
 * Should the status indicator pulse/animate?
 */
export function shouldAnimate(status: ReqOverallStatus): boolean {
  return ["discovering", "connecting", "loading", "live"].includes(status);
}

/**
 * Get relay subscription state badge text
 */
export function getRelayStateBadge(
  relay: ReqRelayState,
): { text: string; color: string } | null {
  const { subscriptionState, connectionState } = relay;

  // Prioritize subscription state
  if (subscriptionState === "receiving") {
    return { text: "RECEIVING", color: "text-green-500" };
  }
  if (subscriptionState === "eose") {
    return { text: "EOSE", color: "text-blue-500" };
  }
  if (subscriptionState === "error") {
    return { text: "ERROR", color: "text-red-500" };
  }

  // Show connection state if not connected
  if (connectionState === "connecting") {
    return { text: "CONNECTING", color: "text-yellow-500" };
  }
  if (connectionState === "error") {
    return { text: "ERROR", color: "text-red-500" };
  }
  if (connectionState === "disconnected") {
    return { text: "OFFLINE", color: "text-muted-foreground" };
  }

  return null;
}
