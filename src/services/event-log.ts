/**
 * Event Log Service
 *
 * Provides an ephemeral log of relay operations for introspection:
 * - PUBLISH events with per-relay status
 * - CONNECT/DISCONNECT events
 * - AUTH events
 * - NOTICE events
 *
 * Uses RxJS for reactive updates and maintains a circular buffer
 * of recent events (configurable max size).
 */

import { BehaviorSubject, Subject, Subscription } from "rxjs";
import { startWith, pairwise, filter } from "rxjs/operators";
import type { NostrEvent } from "nostr-tools";
import publishService, {
  type PublishEvent,
  type RelayStatusUpdate,
} from "./publish-service";
import pool from "./relay-pool";
import type { IRelay } from "applesauce-relay";

// ============================================================================
// Types
// ============================================================================

/** Types of events tracked in the log */
export type EventLogType =
  | "PUBLISH"
  | "CONNECT"
  | "DISCONNECT"
  | "AUTH"
  | "NOTICE";

/** Base interface for all log entries */
interface BaseLogEntry {
  /** Unique ID for this log entry */
  id: string;
  /** Type of event */
  type: EventLogType;
  /** Timestamp when event occurred */
  timestamp: number;
  /** Relay URL (if applicable) */
  relay?: string;
}

/** Publish event log entry */
export interface PublishLogEntry extends BaseLogEntry {
  type: "PUBLISH";
  /** The Nostr event being published */
  event: NostrEvent;
  /** Target relays */
  relays: string[];
  /** Per-relay status */
  relayStatus: Map<string, { status: string; error?: string }>;
  /** Overall status: pending, partial, success, failed */
  status: "pending" | "partial" | "success" | "failed";
  /** Publish ID from PublishService */
  publishId: string;
}

/** Connection event log entry */
export interface ConnectLogEntry extends BaseLogEntry {
  type: "CONNECT" | "DISCONNECT";
  relay: string;
}

/** Auth event log entry */
export interface AuthLogEntry extends BaseLogEntry {
  type: "AUTH";
  relay: string;
  /** Auth status: challenge, success, failed, rejected */
  status: "challenge" | "success" | "failed" | "rejected";
  /** Challenge string (for challenge events) */
  challenge?: string;
}

/** Notice event log entry */
export interface NoticeLogEntry extends BaseLogEntry {
  type: "NOTICE";
  relay: string;
  /** Notice message from relay */
  message: string;
}

/** Union type for all log entries */
export type LogEntry =
  | PublishLogEntry
  | ConnectLogEntry
  | AuthLogEntry
  | NoticeLogEntry;

// ============================================================================
// EventLogService Class
// ============================================================================

class EventLogService {
  /** Maximum number of entries to keep in the log */
  private maxEntries: number;

  /** Circular buffer of log entries */
  private entries: LogEntry[] = [];

  /** BehaviorSubject for reactive updates */
  private entriesSubject = new BehaviorSubject<LogEntry[]>([]);

  /** Subject for new entry notifications */
  private newEntrySubject = new Subject<LogEntry>();

  /** Active subscriptions */
  private subscriptions: Subscription[] = [];

  /** Relay subscriptions for connection/auth/notice tracking */
  private relaySubscriptions = new Map<string, Subscription>();

  /** Counter for generating unique IDs */
  private idCounter = 0;

  /** Map of publish IDs to log entry IDs */
  private publishIdToEntryId = new Map<string, string>();

  /** Polling interval for new relays */
  private pollingIntervalId?: NodeJS.Timeout;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  // --------------------------------------------------------------------------
  // Public Observables
  // --------------------------------------------------------------------------

  /** Observable of all log entries (emits current state on subscribe) */
  readonly entries$ = this.entriesSubject.asObservable();

  /** Observable of new entries as they arrive */
  readonly newEntry$ = this.newEntrySubject.asObservable();

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the event log service
   * Subscribes to PublishService and relay pool events
   */
  initialize(): void {
    // Subscribe to publish events
    this.subscriptions.push(
      publishService.publish$.subscribe((event) =>
        this.handlePublishEvent(event),
      ),
    );

    // Subscribe to per-relay status updates
    this.subscriptions.push(
      publishService.status$.subscribe((update) =>
        this.handleStatusUpdate(update),
      ),
    );

    // Monitor existing relays
    pool.relays.forEach((relay) => this.monitorRelay(relay));

    // Poll for new relays
    this.pollingIntervalId = setInterval(() => {
      pool.relays.forEach((relay) => {
        if (!this.relaySubscriptions.has(relay.url)) {
          this.monitorRelay(relay);
        }
      });
    }, 1000);
  }

  /**
   * Clean up subscriptions
   */
  destroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];

    this.relaySubscriptions.forEach((sub) => sub.unsubscribe());
    this.relaySubscriptions.clear();

    if (this.pollingIntervalId) {
      clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = undefined;
    }
  }

  // --------------------------------------------------------------------------
  // Relay Monitoring
  // --------------------------------------------------------------------------

  /**
   * Monitor a relay for connection, auth, and notice events
   */
  private monitorRelay(relay: IRelay): void {
    const url = relay.url;

    if (this.relaySubscriptions.has(url)) return;

    const subscription = new Subscription();

    // Track connection state changes
    subscription.add(
      relay.connected$
        .pipe(
          startWith(relay.connected),
          pairwise(),
          filter(([prev, curr]) => prev !== curr),
        )
        .subscribe(([, connected]) => {
          this.addEntry({
            type: connected ? "CONNECT" : "DISCONNECT",
            relay: url,
          });
        }),
    );

    // Track authentication events
    subscription.add(
      relay.authenticated$
        .pipe(
          startWith(relay.authenticated),
          pairwise(),
          filter(([prev, curr]) => prev !== curr && curr === true),
        )
        .subscribe(() => {
          this.addEntry({
            type: "AUTH",
            relay: url,
            status: "success",
          });
        }),
    );

    // Track challenges
    subscription.add(
      relay.challenge$
        .pipe(filter((challenge): challenge is string => !!challenge))
        .subscribe((challenge) => {
          this.addEntry({
            type: "AUTH",
            relay: url,
            status: "challenge",
            challenge,
          });
        }),
    );

    // Track notices
    subscription.add(
      relay.notice$.subscribe((notices) => {
        // notices can be a single string or array
        const noticeArray = Array.isArray(notices)
          ? notices
          : notices
            ? [notices]
            : [];
        // Only log new notices (last one)
        if (noticeArray.length > 0) {
          const latestNotice = noticeArray[noticeArray.length - 1];
          this.addEntry({
            type: "NOTICE",
            relay: url,
            message: latestNotice,
          });
        }
      }),
    );

    this.relaySubscriptions.set(url, subscription);
  }

  // --------------------------------------------------------------------------
  // Publish Event Handling
  // --------------------------------------------------------------------------

  /**
   * Handle a publish event from PublishService
   */
  private handlePublishEvent(event: PublishEvent): void {
    // Check if we already have an entry for this publish (avoid duplicates)
    const existingEntryId = this.publishIdToEntryId.get(event.id);
    if (existingEntryId) {
      // Update existing entry instead of creating a new one
      const entryIndex = this.entries.findIndex(
        (e) => e.id === existingEntryId && e.type === "PUBLISH",
      );
      if (entryIndex !== -1) {
        const entry = this.entries[entryIndex] as PublishLogEntry;
        entry.relayStatus = new Map(event.results);
        entry.status = this.calculatePublishStatus(event.results);
        this.entriesSubject.next([...this.entries]);
      }
      return;
    }

    const entryId = this.generateId();

    // Create initial publish entry
    const entry: PublishLogEntry = {
      id: entryId,
      type: "PUBLISH",
      timestamp: event.startedAt,
      event: event.event,
      relays: event.relays,
      relayStatus: new Map(event.results),
      status: this.calculatePublishStatus(event.results),
      publishId: event.id,
    };

    // Map publish ID to entry ID for status updates
    this.publishIdToEntryId.set(event.id, entryId);

    this.addEntry(entry);
  }

  /**
   * Handle a per-relay status update from PublishService
   */
  private handleStatusUpdate(update: RelayStatusUpdate): void {
    const entryId = this.publishIdToEntryId.get(update.publishId);
    if (!entryId) return;

    // Find and update the publish entry
    const entryIndex = this.entries.findIndex(
      (e) => e.id === entryId && e.type === "PUBLISH",
    );
    if (entryIndex === -1) return;

    const entry = this.entries[entryIndex] as PublishLogEntry;

    // Update relay status
    entry.relayStatus.set(update.relay, {
      status: update.status,
      error: update.error,
    });

    // Recalculate overall status
    entry.status = this.calculatePublishStatus(entry.relayStatus);

    // Notify subscribers
    this.entriesSubject.next([...this.entries]);
  }

  /**
   * Calculate overall publish status from relay results
   */
  private calculatePublishStatus(
    results: Map<string, { status: string; error?: string }>,
  ): "pending" | "partial" | "success" | "failed" {
    const statuses = Array.from(results.values()).map((r) => r.status);

    if (statuses.every((s) => s === "pending" || s === "publishing")) {
      return "pending";
    }

    const successCount = statuses.filter((s) => s === "success").length;
    const errorCount = statuses.filter((s) => s === "error").length;

    if (successCount === statuses.length) {
      return "success";
    } else if (errorCount === statuses.length) {
      return "failed";
    } else if (successCount > 0) {
      return "partial";
    }

    return "pending";
  }

  // --------------------------------------------------------------------------
  // Entry Management
  // --------------------------------------------------------------------------

  /**
   * Generate a unique ID for a log entry
   */
  private generateId(): string {
    return `log_${Date.now()}_${++this.idCounter}`;
  }

  /**
   * Add an entry to the log
   * Accepts partial entries without id/timestamp (they will be generated)
   */
  private addEntry(
    entry:
      | (Omit<PublishLogEntry, "id" | "timestamp"> & {
          id?: string;
          timestamp?: number;
        })
      | (Omit<ConnectLogEntry, "id" | "timestamp"> & {
          id?: string;
          timestamp?: number;
        })
      | (Omit<AuthLogEntry, "id" | "timestamp"> & {
          id?: string;
          timestamp?: number;
        })
      | (Omit<NoticeLogEntry, "id" | "timestamp"> & {
          id?: string;
          timestamp?: number;
        }),
  ): void {
    const fullEntry = {
      id: entry.id || this.generateId(),
      timestamp: entry.timestamp || Date.now(),
      ...entry,
    } as LogEntry;

    // Add to front (most recent first)
    this.entries.unshift(fullEntry);

    // Trim to max size
    if (this.entries.length > this.maxEntries) {
      const removed = this.entries.splice(this.maxEntries);
      // Clean up publish ID mappings for removed entries
      removed.forEach((e) => {
        if (e.type === "PUBLISH") {
          this.publishIdToEntryId.delete((e as PublishLogEntry).publishId);
        }
      });
    }

    // Notify subscribers
    this.entriesSubject.next([...this.entries]);
    this.newEntrySubject.next(fullEntry);
  }

  // --------------------------------------------------------------------------
  // Public Methods
  // --------------------------------------------------------------------------

  /**
   * Get all log entries
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries filtered by type
   */
  getEntriesByType(type: EventLogType): LogEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /**
   * Get entries for a specific relay
   */
  getEntriesByRelay(relay: string): LogEntry[] {
    return this.entries.filter((e) => e.relay === relay);
  }

  /**
   * Get publish entries only
   */
  getPublishEntries(): PublishLogEntry[] {
    return this.entries.filter(
      (e): e is PublishLogEntry => e.type === "PUBLISH",
    );
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
    this.publishIdToEntryId.clear();
    this.entriesSubject.next([]);
  }

  /**
   * Retry failed relays for a publish entry
   */
  async retryFailedRelays(entryId: string): Promise<void> {
    const entry = this.entries.find(
      (e) => e.id === entryId && e.type === "PUBLISH",
    ) as PublishLogEntry | undefined;

    if (!entry) return;

    const failedRelays = Array.from(entry.relayStatus.entries())
      .filter(([, status]) => status.status === "error")
      .map(([relay]) => relay);

    if (failedRelays.length === 0) return;

    // Retry via PublishService
    await publishService.retryRelays(
      entry.event,
      failedRelays,
      entry.publishId,
    );
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

const eventLog = new EventLogService();

// Initialize on module load
eventLog.initialize();

export default eventLog;

// Also export the class for testing
export { EventLogService };
