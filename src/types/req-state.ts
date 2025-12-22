/**
 * Types for REQ subscription state tracking
 *
 * Provides per-relay and overall state for REQ subscriptions to enable
 * accurate status indicators that distinguish between EOSE, disconnection,
 * timeout, and error states.
 */

/**
 * Connection state from RelayStateManager
 */
export type RelayConnectionState =
  | "pending" // Not yet attempted
  | "connecting" // Connection in progress
  | "connected" // WebSocket connected
  | "disconnected" // Disconnected (expected or unexpected)
  | "error"; // Connection error

/**
 * Subscription state specific to this REQ
 */
export type RelaySubscriptionState =
  | "waiting" // Connected but no events yet
  | "receiving" // Events being received
  | "eose" // EOSE received (real or timeout)
  | "error"; // Subscription error

/**
 * Per-relay state for a single REQ subscription
 */
export interface ReqRelayState {
  url: string;

  // Connection state (from RelayStateManager)
  connectionState: RelayConnectionState;

  // Subscription state (tracked by enhanced hook)
  subscriptionState: RelaySubscriptionState;

  // Event tracking
  eventCount: number;
  firstEventAt?: number;
  lastEventAt?: number;

  // Timing
  connectedAt?: number;
  eoseAt?: number;
  disconnectedAt?: number;

  // Error handling
  errorMessage?: string;
  errorType?: "connection" | "protocol" | "timeout" | "auth";
}

/**
 * Overall query state derived from individual relay states
 */
export type ReqOverallStatus =
  | "discovering" // Selecting relays (NIP-65)
  | "connecting" // Waiting for first relay to connect
  | "loading" // Loading initial events
  | "live" // Streaming after EOSE, relays connected
  | "partial" // Some relays ok, some failed
  | "closed" // All relays completed and closed
  | "failed" // All relays failed
  | "offline"; // All relays disconnected after being live

/**
 * Aggregated state for the entire query
 */
export interface ReqOverallState {
  status: ReqOverallStatus;

  // Relay counts
  totalRelays: number;
  connectedCount: number;
  receivingCount: number;
  eoseCount: number;
  errorCount: number;
  disconnectedCount: number;

  // Timing
  queryStartedAt: number;
  firstEventAt?: number;
  allEoseAt?: number;

  // Flags
  hasReceivedEvents: boolean;
  hasActiveRelays: boolean;
  allRelaysFailed: boolean;
}
