/**
 * Publishing Types
 *
 * Core types for the unified event publishing system.
 * Provides explicit relay mode selection and comprehensive tracking
 * of sign requests and publish operations.
 */

import type { NostrEvent } from "nostr-tools/core";
import type { UnsignedEvent } from "nostr-tools/pure";

/**
 * Relay mode - explicit about how relays are selected
 */
export type RelayMode =
  | { mode: "outbox" } // Auto-select from NIP-65 outbox relays
  | { mode: "explicit"; relays: string[] }; // Caller provides specific relays

/**
 * Status of a sign request
 */
export type SignStatus = "pending" | "success" | "failed";

/**
 * Status of a per-relay publish attempt
 */
export type RelayPublishStatus = "pending" | "success" | "failed";

/**
 * Overall status of a publish request
 */
export type PublishStatus = "pending" | "partial" | "success" | "failed";

/**
 * Sign request - tracks a signing operation
 */
export interface SignRequest {
  /** Unique identifier for this sign request */
  id: string;
  /** The unsigned event that was signed */
  unsignedEvent: UnsignedEvent;
  /** When the sign request was initiated */
  timestamp: number;
  /** Current status of the sign request */
  status: SignStatus;
  /** The signed event (if successful) */
  signedEvent?: NostrEvent;
  /** Error message (if failed) */
  error?: string;
  /** How long signing took in milliseconds */
  duration?: number;
}

/**
 * Per-relay publish result - tracks the outcome for a single relay
 */
export interface RelayPublishResult {
  /** The relay URL */
  relay: string;
  /** Current status for this relay */
  status: RelayPublishStatus;
  /** When publishing to this relay started */
  startedAt: number;
  /** When publishing to this relay completed (success or fail) */
  completedAt?: number;
  /** Error message (if failed) */
  error?: string;
  /** OK message from relay (NIP-20) */
  okMessage?: string;
}

/**
 * Publish request - tracks a publish operation
 */
export interface PublishRequest {
  /** Unique identifier for this publish request */
  id: string;
  /** The event ID being published */
  eventId: string;
  /** The full event being published */
  event: NostrEvent;
  /** When the publish request was initiated */
  timestamp: number;
  /** The relay mode used for this publish */
  relayMode: RelayMode;
  /** The actual relays that were resolved/used */
  resolvedRelays: string[];
  /** Per-relay results */
  relayResults: Record<string, RelayPublishResult>;
  /** Overall status of the publish request */
  status: PublishStatus;
  /** How long the entire publish operation took in milliseconds */
  duration?: number;
}

/**
 * Combined sign+publish operation
 */
export interface PublishOperation {
  /** Unique identifier for this operation */
  id: string;
  /** The sign request (if event was signed as part of this operation) */
  signRequest?: SignRequest;
  /** The publish request */
  publishRequest: PublishRequest;
  /** When this operation was created */
  createdAt: number;
}

/**
 * Options for publishing
 */
export interface PublishOptions {
  /** Additional relays to include (merged with resolved relays) */
  additionalRelays?: string[];
  /** Skip unhealthy relays (uses RelayLiveness) */
  filterUnhealthy?: boolean;
  /** Callback for per-relay status updates */
  onRelayStatus?: (relay: string, result: RelayPublishResult) => void;
  /** Callback for overall status updates */
  onStatusChange?: (request: PublishRequest) => void;
}

/**
 * Dexie-storable sign request (for persistence)
 */
export interface StoredSignRequest {
  id: string;
  unsignedEventJson: string; // JSON stringified
  timestamp: number;
  status: SignStatus;
  signedEventJson?: string; // JSON stringified
  error?: string;
  duration?: number;
  eventKind: number; // For indexing
}

/**
 * Dexie-storable publish request (for persistence)
 */
export interface StoredPublishRequest {
  id: string;
  eventId: string;
  eventJson: string; // JSON stringified
  timestamp: number;
  relayModeJson: string; // JSON stringified
  resolvedRelays: string[]; // Array stored directly
  relayResultsJson: string; // JSON stringified
  status: PublishStatus;
  duration?: number;
  eventKind: number; // For indexing
}

/**
 * Statistics for publishing activity
 */
export interface PublishStats {
  /** Total number of sign requests */
  totalSignRequests: number;
  /** Successful sign requests */
  successfulSigns: number;
  /** Failed sign requests */
  failedSigns: number;
  /** Total number of publish requests */
  totalPublishRequests: number;
  /** Publish requests with all relays succeeded */
  successfulPublishes: number;
  /** Publish requests with some relays succeeded */
  partialPublishes: number;
  /** Publish requests with all relays failed */
  failedPublishes: number;
  /** Pending publish requests */
  pendingPublishes: number;
}
