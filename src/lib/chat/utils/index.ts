/**
 * Shared utilities for chat adapters
 *
 * This module provides reusable utilities for:
 * - Event fetching (with caching and timeout handling)
 * - Relay resolution (outbox/inbox relays, merging)
 * - Message conversion (zaps, nutzaps, generic events)
 *
 * @example
 * ```typescript
 * import {
 *   fetchEvent,
 *   fetchReplaceableEvent,
 *   getOutboxRelays,
 *   mergeRelays,
 *   zapReceiptToMessage,
 *   eventToMessage,
 *   getNip10ReplyTo,
 * } from "@/lib/chat/utils";
 * ```
 */

// Event fetching utilities
export {
  fetchEvent,
  fetchReplaceableEvent,
  type FetchEventOptions,
  type FetchReplaceableOptions,
} from "./event-fetcher";

// Relay utilities
export {
  getOutboxRelays,
  getInboxRelays,
  mergeRelays,
  collectOutboxRelays,
  AGGREGATOR_RELAYS,
  type OutboxRelayOptions,
  type MergeRelaysOptions,
} from "./relay-utils";

// Message conversion utilities
export {
  zapReceiptToMessage,
  nutzapToMessage,
  eventToMessage,
  getNip10ReplyTo,
  getNip22ReplyTo,
  getQTagReplyTo,
  type ZapToMessageOptions,
  type NutzapToMessageOptions,
  type EventToMessageOptions,
} from "./message-utils";
