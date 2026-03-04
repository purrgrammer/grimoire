/**
 * Centralized Publish Service
 *
 * Provides a unified API for publishing Nostr events with:
 * - Per-relay status tracking via RxJS observables
 * - EventStore integration
 * - Logging/observability hooks for EventLogService
 *
 * Relay selection is NOT handled here — callers must provide
 * an explicit relay list. Use selectRelaysForPublish() or
 * selectRelaysForInteraction() from relay-selection.ts.
 *
 * All publishing in Grimoire should go through this service.
 */

import { Subject, Observable } from "rxjs";
import { filter } from "rxjs/operators";
import type { NostrEvent } from "nostr-tools";
import pool from "./relay-pool";
import eventStore from "./event-store";

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
  /** Skip adding to EventStore after publish */
  skipEventStore?: boolean;
  /** Custom publish ID (for retry operations) */
  publishId?: string;
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
   * Publish an event to the given relays
   *
   * Callers must provide an explicit relay list — use selectRelaysForPublish()
   * or selectRelaysForInteraction() from relay-selection.ts to build it.
   */
  async publish(
    event: NostrEvent,
    relays: string[],
    options: PublishOptions = {},
  ): Promise<PublishResult> {
    const publishId = options.publishId || this.generatePublishId();
    const startedAt = Date.now();

    if (relays.length === 0) {
      throw new Error(
        "No relays provided for publishing. Use selectRelaysForPublish() to select relays.",
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
   * Retry publishing to specific relays
   *
   * Use this to retry failed relays from a previous publish.
   */
  async retryRelays(
    event: NostrEvent,
    relays: string[],
    originalPublishId?: string,
  ): Promise<PublishResult> {
    return this.publish(event, relays, {
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
    relays: string[],
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
    const result = this.publish(event, relays, { ...options, publishId });

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
}

// ============================================================================
// Singleton Export
// ============================================================================

const publishService = new PublishService();
export default publishService;
