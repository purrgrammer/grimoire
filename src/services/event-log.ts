/**
 * Event Log Service
 *
 * Provides an ephemeral log of relay operations for introspection:
 * - PUBLISH events with per-relay status and timing
 * - CONNECT/DISCONNECT events
 * - ERROR events for connection failures
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
  | "ERROR"
  | "AUTH"
  | "NOTICE";

/** Per-relay status with timing */
export interface RelayStatusEntry {
  status: string;
  error?: string;
  /** Timestamp of the last status transition */
  updatedAt: number;
}

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
  /** Per-relay status with timing */
  relayStatus: Map<string, RelayStatusEntry>;
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

/** Connection error log entry */
export interface ErrorLogEntry extends BaseLogEntry {
  type: "ERROR";
  relay: string;
  /** Error message */
  message: string;
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
  | ErrorLogEntry
  | AuthLogEntry
  | NoticeLogEntry;

/** Helper type for creating new entries (id/timestamp auto-generated) */
type NewEntry<T extends LogEntry> = Omit<T, "id" | "timestamp"> & {
  id?: string;
  timestamp?: number;
};

type AddEntryInput =
  | NewEntry<PublishLogEntry>
  | NewEntry<ConnectLogEntry>
  | NewEntry<ErrorLogEntry>
  | NewEntry<AuthLogEntry>
  | NewEntry<NoticeLogEntry>;

// ============================================================================
// EventLogService Class
// ============================================================================

/** Interval for polling new relays (ms) */
const RELAY_POLL_INTERVAL = 5000;

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

  /** Track last seen notice per relay to prevent duplicates */
  private lastNoticePerRelay = new Map<string, string>();

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

    // Poll for new relays (infrequent — new relays don't appear often)
    this.pollingIntervalId = setInterval(() => {
      pool.relays.forEach((relay) => {
        if (!this.relaySubscriptions.has(relay.url)) {
          this.monitorRelay(relay);
        }
      });
    }, RELAY_POLL_INTERVAL);
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
   * Monitor a relay for connection, error, auth, and notice events
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

    // Track connection errors
    subscription.add(
      relay.error$
        .pipe(filter((error): error is Error => error !== null))
        .subscribe((error) => {
          this.addEntry({
            type: "ERROR",
            relay: url,
            message: error.message || "Unknown connection error",
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

    // Track notices — deduplicate per relay
    subscription.add(
      relay.notice$.subscribe((notice) => {
        if (
          typeof notice === "string" &&
          notice &&
          notice !== this.lastNoticePerRelay.get(url)
        ) {
          this.lastNoticePerRelay.set(url, notice);
          this.addEntry({
            type: "NOTICE",
            relay: url,
            message: notice,
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
      // Update existing entry immutably
      const entryIndex = this.entries.findIndex(
        (e) => e.id === existingEntryId && e.type === "PUBLISH",
      );
      if (entryIndex !== -1) {
        const entry = this.entries[entryIndex] as PublishLogEntry;
        const newRelayStatus = new Map<string, RelayStatusEntry>();
        // Preserve timing from existing entries, add timing for new ones
        for (const [relay, status] of event.results) {
          const existing = entry.relayStatus.get(relay);
          newRelayStatus.set(relay, {
            ...status,
            updatedAt: existing?.updatedAt ?? Date.now(),
          });
        }
        this.entries[entryIndex] = {
          ...entry,
          relayStatus: newRelayStatus,
          status: this.calculatePublishStatus(newRelayStatus),
        };
        this.entriesSubject.next([...this.entries]);
      }
      return;
    }

    const entryId = this.generateId();
    const now = Date.now();

    // Create initial publish entry with timing
    const relayStatus = new Map<string, RelayStatusEntry>();
    for (const [relay, status] of event.results) {
      relayStatus.set(relay, { ...status, updatedAt: now });
    }

    const entry: PublishLogEntry = {
      id: entryId,
      type: "PUBLISH",
      timestamp: event.startedAt,
      event: event.event,
      relays: event.relays,
      relayStatus,
      status: this.calculatePublishStatus(relayStatus),
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

    // Find the publish entry
    const entryIndex = this.entries.findIndex(
      (e) => e.id === entryId && e.type === "PUBLISH",
    );
    if (entryIndex === -1) return;

    const entry = this.entries[entryIndex] as PublishLogEntry;

    // Update immutably with timing
    const newRelayStatus = new Map(entry.relayStatus);
    newRelayStatus.set(update.relay, {
      status: update.status,
      error: update.error,
      updatedAt: update.timestamp,
    });

    const newStatus = this.calculatePublishStatus(newRelayStatus);

    this.entries[entryIndex] = {
      ...entry,
      relayStatus: newRelayStatus,
      status: newStatus,
    };

    // Clean up publish ID mapping when publish reaches terminal state
    if (newStatus !== "pending") {
      const allTerminal = Array.from(newRelayStatus.values()).every(
        (r) => r.status === "success" || r.status === "error",
      );
      if (allTerminal) {
        this.publishIdToEntryId.delete(update.publishId);
      }
    }

    // Notify subscribers
    this.entriesSubject.next([...this.entries]);
  }

  /**
   * Calculate overall publish status from relay results
   */
  private calculatePublishStatus(
    results: Map<string, RelayStatusEntry>,
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
  private addEntry(entry: AddEntryInput): void {
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
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
    this.publishIdToEntryId.clear();
    this.lastNoticePerRelay.clear();
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

  /**
   * Retry a single relay for a publish entry
   */
  async retryRelay(entryId: string, relay: string): Promise<void> {
    const entry = this.entries.find(
      (e) => e.id === entryId && e.type === "PUBLISH",
    ) as PublishLogEntry | undefined;

    if (!entry) return;

    const status = entry.relayStatus.get(relay);
    if (!status || status.status !== "error") return;

    await publishService.retryRelays(entry.event, [relay], entry.publishId);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

const eventLog = new EventLogService();

// Initialize on module load
eventLog.initialize();

export default eventLog;
