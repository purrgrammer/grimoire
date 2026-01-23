/**
 * Centralized Publish Service
 *
 * Provides a unified API for publishing Nostr events with:
 * - Smart relay selection (outbox + state write relays + hints + fallbacks)
 * - Per-relay status tracking via RxJS observables
 * - EventStore integration
 * - Logging/observability hooks for EventLogService
 *
 * All publishing in Grimoire should go through this service.
 */

import { Subject, Observable } from "rxjs";
import { filter } from "rxjs/operators";
import type { NostrEvent } from "nostr-tools";
import { mergeRelaySets, getSeenRelays } from "applesauce-core/helpers";
import pool from "./relay-pool";
import eventStore from "./event-store";
import { relayListCache } from "./relay-list-cache";
import { AGGREGATOR_RELAYS } from "./loaders";
import { grimoireStateAtom } from "@/core/state";
import { getDefaultStore } from "jotai";

// ============================================================================
// Types
// ============================================================================

/** Status of a publish attempt to a single relay */
export type RelayPublishStatus = "pending" | "publishing" | "success" | "error";

/** Per-relay status update */
export interface RelayStatusUpdate {
  /** Unique ID for this publish operation */
  publishId: string;
  /** Relay URL */
  relay: string;
  /** Current status */
  status: RelayPublishStatus;
  /** Error message if status is 'error' */
  error?: string;
  /** Timestamp of this status update */
  timestamp: number;
}

/** Overall publish operation event */
export interface PublishEvent {
  /** Unique ID for this publish operation */
  id: string;
  /** The event being published */
  event: NostrEvent;
  /** Target relays */
  relays: string[];
  /** Timestamp when publish started */
  startedAt: number;
  /** Timestamp when publish completed (all relays resolved) */
  completedAt?: number;
  /** Per-relay results */
  results: Map<string, { status: RelayPublishStatus; error?: string }>;
}

/** Result returned from publish operations */
export interface PublishResult {
  /** Unique ID for this publish operation */
  publishId: string;
  /** The published event */
  event: NostrEvent;
  /** Relays that succeeded */
  successful: string[];
  /** Relays that failed with their errors */
  failed: Array<{ relay: string; error: string }>;
  /** Whether at least one relay succeeded */
  ok: boolean;
}

/** Options for publish operations */
export interface PublishOptions {
  /** Explicit relays to publish to (overrides automatic selection) */
  relays?: string[];
  /** Additional relay hints to include */
  relayHints?: string[];
  /** Skip adding to EventStore after publish */
  skipEventStore?: boolean;
  /** Custom publish ID (for retry operations) */
  publishId?: string;
}

/** Options for relay selection */
export interface RelaySelectionOptions {
  /** Author pubkey for outbox relay lookup */
  authorPubkey?: string;
  /** Additional relay hints */
  relayHints?: string[];
  /** Include aggregator relays as fallback */
  includeAggregators?: boolean;
}

// ============================================================================
// PublishService Class
// ============================================================================

class PublishService {
  /** Subject for all publish events (start, complete) */
  private publishSubject = new Subject<PublishEvent>();

  /** Subject for per-relay status updates */
  private statusSubject = new Subject<RelayStatusUpdate>();

  /** Active publish operations */
  private activePublishes = new Map<string, PublishEvent>();

  /** Counter for generating unique publish IDs */
  private publishCounter = 0;

  // --------------------------------------------------------------------------
  // Public Observables
  // --------------------------------------------------------------------------

  /** Observable of all publish events */
  readonly publish$ = this.publishSubject.asObservable();

  /** Observable of all relay status updates */
  readonly status$ = this.statusSubject.asObservable();

  /**
   * Get status updates for a specific publish operation
   */
  getStatusUpdates(publishId: string): Observable<RelayStatusUpdate> {
    return this.status$.pipe(
      filter((update) => update.publishId === publishId),
    );
  }

  /**
   * Get status updates for a specific relay
   */
  getRelayStatusUpdates(relay: string): Observable<RelayStatusUpdate> {
    return this.status$.pipe(filter((update) => update.relay === relay));
  }

  // --------------------------------------------------------------------------
  // Relay Selection
  // --------------------------------------------------------------------------

  /**
   * Select relays for publishing an event
   *
   * Priority order:
   * 1. Author's outbox relays (kind 10002)
   * 2. User's configured write relays (from Grimoire state)
   * 3. Relay hints (seen relays, explicit hints)
   * 4. Aggregator relays (fallback)
   */
  async selectRelays(options: RelaySelectionOptions = {}): Promise<string[]> {
    const {
      authorPubkey,
      relayHints = [],
      includeAggregators = true,
    } = options;

    const relaySets: string[][] = [];

    // 1. Author's outbox relays from kind 10002
    if (authorPubkey) {
      const outboxRelays = await relayListCache.getOutboxRelays(authorPubkey);
      if (outboxRelays && outboxRelays.length > 0) {
        relaySets.push(outboxRelays);
      }
    }

    // 2. User's configured write relays from Grimoire state
    const store = getDefaultStore();
    const state = store.get(grimoireStateAtom);
    const stateWriteRelays =
      state.activeAccount?.relays?.filter((r) => r.write).map((r) => r.url) ||
      [];
    if (stateWriteRelays.length > 0) {
      relaySets.push(stateWriteRelays);
    }

    // 3. Relay hints
    if (relayHints.length > 0) {
      relaySets.push(relayHints);
    }

    // 4. Aggregator relays as fallback
    if (includeAggregators) {
      relaySets.push(AGGREGATOR_RELAYS);
    }

    // Merge and deduplicate
    const merged = mergeRelaySets(...relaySets);

    // If still empty, return aggregators as last resort
    if (merged.length === 0) {
      return AGGREGATOR_RELAYS;
    }

    return merged;
  }

  /**
   * Select relays for an event using its metadata
   */
  async selectRelaysForEvent(
    event: NostrEvent,
    additionalHints: string[] = [],
  ): Promise<string[]> {
    // Get seen relays from the event
    const seenRelays = getSeenRelays(event);
    const hints = [
      ...additionalHints,
      ...(seenRelays ? Array.from(seenRelays) : []),
    ];

    return this.selectRelays({
      authorPubkey: event.pubkey,
      relayHints: hints,
      includeAggregators: true,
    });
  }

  // --------------------------------------------------------------------------
  // Publish Methods
  // --------------------------------------------------------------------------

  /**
   * Generate a unique publish ID
   */
  private generatePublishId(): string {
    return `pub_${Date.now()}_${++this.publishCounter}`;
  }

  /**
   * Publish an event and return a Promise with the result
   *
   * This is the main publish method - use this for simple fire-and-forget publishing.
   */
  async publish(
    event: NostrEvent,
    options: PublishOptions = {},
  ): Promise<PublishResult> {
    const publishId = options.publishId || this.generatePublishId();
    const startedAt = Date.now();

    // Determine target relays
    let relays: string[];
    if (options.relays && options.relays.length > 0) {
      relays = options.relays;
    } else {
      relays = await this.selectRelaysForEvent(event, options.relayHints);
    }

    if (relays.length === 0) {
      throw new Error(
        "No relays available for publishing. Please configure relay list or provide relay hints.",
      );
    }

    // Initialize publish event
    const publishEvent: PublishEvent = {
      id: publishId,
      event,
      relays,
      startedAt,
      results: new Map(),
    };
    this.activePublishes.set(publishId, publishEvent);

    // Emit initial publish event
    this.publishSubject.next(publishEvent);

    // Emit initial pending status for all relays
    for (const relay of relays) {
      publishEvent.results.set(relay, { status: "pending" });
      this.emitStatus(publishId, relay, "pending");
    }

    // Publish to each relay individually for status tracking
    const publishPromises = relays.map(async (relay) => {
      this.emitStatus(publishId, relay, "publishing");
      publishEvent.results.set(relay, { status: "publishing" });

      try {
        // pool.publish returns array of { from: string, ok: boolean, message?: string }
        const responses = await pool.publish([relay], event);
        const response = responses[0];

        // Check if relay accepted the event
        if (response && response.ok) {
          publishEvent.results.set(relay, { status: "success" });
          this.emitStatus(publishId, relay, "success");
          return { relay, success: true as const };
        } else {
          // Relay rejected the event
          const error = response?.message || "Relay rejected event";
          publishEvent.results.set(relay, { status: "error", error });
          this.emitStatus(publishId, relay, "error", error);
          return { relay, success: false as const, error };
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        publishEvent.results.set(relay, { status: "error", error });
        this.emitStatus(publishId, relay, "error", error);
        return { relay, success: false as const, error };
      }
    });

    // Wait for all to complete
    const results = await Promise.all(publishPromises);

    // Update publish event
    publishEvent.completedAt = Date.now();
    this.publishSubject.next(publishEvent);

    // Build result
    const successful = results.filter((r) => r.success).map((r) => r.relay);
    const failed = results
      .filter(
        (r): r is { relay: string; success: false; error: string } =>
          !r.success,
      )
      .map((r) => ({ relay: r.relay, error: r.error }));

    const result: PublishResult = {
      publishId,
      event,
      successful,
      failed,
      ok: successful.length > 0,
    };

    // Add to EventStore if at least one relay succeeded
    if (result.ok && !options.skipEventStore) {
      eventStore.add(event);
    }

    // Cleanup
    this.activePublishes.delete(publishId);

    return result;
  }

  /**
   * Publish to specific relays (explicit relay list)
   *
   * Use this when you know exactly which relays to publish to.
   */
  async publishToRelays(
    event: NostrEvent,
    relays: string[],
    options: Omit<PublishOptions, "relays"> = {},
  ): Promise<PublishResult> {
    return this.publish(event, { ...options, relays });
  }

  /**
   * Retry publishing to specific relays
   *
   * Use this to retry failed relays from a previous publish.
   */
  async retryRelays(
    event: NostrEvent,
    relays: string[],
    originalPublishId?: string,
  ): Promise<PublishResult> {
    return this.publish(event, {
      relays,
      publishId: originalPublishId ? `${originalPublishId}_retry` : undefined,
      skipEventStore: true, // Event should already be in store from original publish
    });
  }

  // --------------------------------------------------------------------------
  // Observable-based Publishing (for UI with live updates)
  // --------------------------------------------------------------------------

  /**
   * Start a publish operation and return an Observable of status updates
   *
   * Use this when you need to show per-relay status in the UI.
   * The Observable completes when all relays have resolved.
   */
  publishWithUpdates(
    event: NostrEvent,
    options: PublishOptions = {},
  ): {
    publishId: string;
    updates$: Observable<RelayStatusUpdate>;
    result: Promise<PublishResult>;
  } {
    const publishId = options.publishId || this.generatePublishId();

    // Create filtered observable for this publish
    const updates$ = this.getStatusUpdates(publishId);

    // Start the publish (returns promise)
    const result = this.publish(event, { ...options, publishId });

    return { publishId, updates$, result };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Emit a status update
   */
  private emitStatus(
    publishId: string,
    relay: string,
    status: RelayPublishStatus,
    error?: string,
  ): void {
    this.statusSubject.next({
      publishId,
      relay,
      status,
      error,
      timestamp: Date.now(),
    });
  }

  /**
   * Get active publish operations
   */
  getActivePublishes(): PublishEvent[] {
    return Array.from(this.activePublishes.values());
  }

  /**
   * Check if a publish operation is active
   */
  isPublishing(publishId: string): boolean {
    return this.activePublishes.has(publishId);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

const publishService = new PublishService();
export default publishService;

// Also export the class for testing
export { PublishService };
