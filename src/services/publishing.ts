/**
 * Publishing Service
 *
 * Unified service for signing and publishing Nostr events.
 * Provides comprehensive tracking of all operations with persistence.
 *
 * Features:
 * - Explicit relay mode (outbox vs explicit)
 * - Per-relay status tracking
 * - Full sign/publish history
 * - Republish capabilities
 * - Observable state for reactive UIs
 */

import { BehaviorSubject } from "rxjs";
import { EventFactory } from "applesauce-core/event-factory";
import type { NostrEvent } from "nostr-tools/core";
import type { UnsignedEvent } from "nostr-tools/pure";
import pool from "./relay-pool";
import eventStore from "./event-store";
import accountManager from "./accounts";
import { relayResolver } from "./relay-resolver";
import db from "./db";
import type {
  RelayMode,
  SignRequest,
  PublishRequest,
  PublishStatus,
  RelayPublishResult,
  PublishOperation,
  PublishOptions,
  PublishStats,
  StoredSignRequest,
  StoredPublishRequest,
} from "@/types/publishing";

/**
 * Generate a unique ID for requests
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Convert SignRequest to storable format
 */
function toStoredSignRequest(request: SignRequest): StoredSignRequest {
  return {
    id: request.id,
    unsignedEventJson: JSON.stringify(request.unsignedEvent),
    timestamp: request.timestamp,
    status: request.status,
    signedEventJson: request.signedEvent
      ? JSON.stringify(request.signedEvent)
      : undefined,
    error: request.error,
    duration: request.duration,
    eventKind: request.unsignedEvent.kind,
  };
}

/**
 * Convert stored format back to SignRequest
 */
function fromStoredSignRequest(stored: StoredSignRequest): SignRequest {
  return {
    id: stored.id,
    unsignedEvent: JSON.parse(stored.unsignedEventJson),
    timestamp: stored.timestamp,
    status: stored.status,
    signedEvent: stored.signedEventJson
      ? JSON.parse(stored.signedEventJson)
      : undefined,
    error: stored.error,
    duration: stored.duration,
  };
}

/**
 * Convert PublishRequest to storable format
 */
function toStoredPublishRequest(request: PublishRequest): StoredPublishRequest {
  return {
    id: request.id,
    eventId: request.eventId,
    eventJson: JSON.stringify(request.event),
    timestamp: request.timestamp,
    relayModeJson: JSON.stringify(request.relayMode),
    resolvedRelays: request.resolvedRelays,
    relayResultsJson: JSON.stringify(request.relayResults),
    status: request.status,
    duration: request.duration,
    eventKind: request.event.kind,
  };
}

/**
 * Convert stored format back to PublishRequest
 */
function fromStoredPublishRequest(
  stored: StoredPublishRequest,
): PublishRequest {
  return {
    id: stored.id,
    eventId: stored.eventId,
    event: JSON.parse(stored.eventJson),
    timestamp: stored.timestamp,
    relayMode: JSON.parse(stored.relayModeJson),
    resolvedRelays: stored.resolvedRelays,
    relayResults: JSON.parse(stored.relayResultsJson),
    status: stored.status,
    duration: stored.duration,
  };
}

/**
 * Calculate overall publish status from relay results
 */
function calculatePublishStatus(
  relayResults: Record<string, RelayPublishResult>,
): PublishStatus {
  const results = Object.values(relayResults);
  if (results.length === 0) return "failed";

  const pending = results.filter((r) => r.status === "pending").length;
  const success = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;

  if (pending > 0) return "pending";
  if (success === results.length) return "success";
  if (failed === results.length) return "failed";
  return "partial";
}

class PublishingService {
  // Event factory for signing
  private factory: EventFactory;

  // Observable state
  readonly signHistory$ = new BehaviorSubject<SignRequest[]>([]);
  readonly publishHistory$ = new BehaviorSubject<PublishRequest[]>([]);
  readonly activePublishes$ = new BehaviorSubject<PublishRequest[]>([]);

  // In-memory caches (synced with Dexie)
  private signRequests = new Map<string, SignRequest>();
  private publishRequests = new Map<string, PublishRequest>();

  // Loading state
  private loaded = false;

  constructor() {
    this.factory = new EventFactory();

    // Sync factory signer with active account
    accountManager.active$.subscribe((account) => {
      this.factory.setSigner(account?.signer || undefined);
    });

    // Load history from Dexie on initialization
    this.loadHistory();
  }

  /**
   * Load history from Dexie
   */
  private async loadHistory(): Promise<void> {
    try {
      // Load sign history
      const storedSigns = await db.signHistory
        .orderBy("timestamp")
        .reverse()
        .limit(1000)
        .toArray();

      for (const stored of storedSigns) {
        const request = fromStoredSignRequest(stored);
        this.signRequests.set(request.id, request);
      }

      // Load publish history
      const storedPublishes = await db.publishHistory
        .orderBy("timestamp")
        .reverse()
        .limit(1000)
        .toArray();

      for (const stored of storedPublishes) {
        const request = fromStoredPublishRequest(stored);
        this.publishRequests.set(request.id, request);
      }

      // Update observables
      this.emitSignHistory();
      this.emitPublishHistory();

      this.loaded = true;
      console.log(
        `[PublishingService] Loaded ${storedSigns.length} sign requests, ${storedPublishes.length} publish requests`,
      );
    } catch (error) {
      console.error("[PublishingService] Failed to load history:", error);
      this.loaded = true; // Continue even if load fails
    }
  }

  /**
   * Emit current sign history to observable
   */
  private emitSignHistory(): void {
    const sorted = Array.from(this.signRequests.values()).sort(
      (a, b) => b.timestamp - a.timestamp,
    );
    this.signHistory$.next(sorted);
  }

  /**
   * Emit current publish history to observable
   */
  private emitPublishHistory(): void {
    const sorted = Array.from(this.publishRequests.values()).sort(
      (a, b) => b.timestamp - a.timestamp,
    );
    this.publishHistory$.next(sorted);

    // Also update active publishes
    const active = sorted.filter((r) => r.status === "pending");
    this.activePublishes$.next(active);
  }

  /**
   * Persist sign request to Dexie
   */
  private async persistSignRequest(request: SignRequest): Promise<void> {
    try {
      await db.signHistory.put(toStoredSignRequest(request));
    } catch (error) {
      console.error(
        "[PublishingService] Failed to persist sign request:",
        error,
      );
    }
  }

  /**
   * Persist publish request to Dexie
   */
  private async persistPublishRequest(request: PublishRequest): Promise<void> {
    try {
      await db.publishHistory.put(toStoredPublishRequest(request));
    } catch (error) {
      console.error(
        "[PublishingService] Failed to persist publish request:",
        error,
      );
    }
  }

  /**
   * Sign an unsigned event
   * Returns a SignRequest with the result
   */
  async sign(unsignedEvent: UnsignedEvent): Promise<SignRequest> {
    const id = generateId();
    const timestamp = Date.now();

    // Create initial request
    const request: SignRequest = {
      id,
      unsignedEvent,
      timestamp,
      status: "pending",
    };

    // Add to cache and emit
    this.signRequests.set(id, request);
    this.emitSignHistory();

    try {
      const startTime = performance.now();

      // Build and sign the event
      const draft = await this.factory.build(unsignedEvent);
      const signedEvent = await this.factory.sign(draft);

      const duration = Math.round(performance.now() - startTime);

      // Update request
      request.status = "success";
      request.signedEvent = signedEvent;
      request.duration = duration;
    } catch (error) {
      request.status = "failed";
      request.error =
        error instanceof Error ? error.message : "Unknown signing error";
    }

    // Update cache and persist
    this.signRequests.set(id, request);
    this.emitSignHistory();
    await this.persistSignRequest(request);

    return request;
  }

  /**
   * Publish an already-signed event
   * Returns a PublishRequest with per-relay tracking
   */
  async publish(
    event: NostrEvent,
    mode: RelayMode,
    options: PublishOptions = {},
  ): Promise<PublishRequest> {
    const {
      additionalRelays,
      filterUnhealthy = true,
      onRelayStatus,
      onStatusChange,
    } = options;

    const id = generateId();
    const timestamp = Date.now();

    // Resolve relays
    const resolution = await relayResolver.resolve(mode, event, {
      filterUnhealthy,
    });

    // Merge with additional relays if provided
    let resolvedRelays = resolution.relays;
    if (additionalRelays && additionalRelays.length > 0) {
      resolvedRelays = relayResolver.mergeRelays(
        resolvedRelays,
        additionalRelays,
      );
    }

    // Validate we have relays
    if (resolvedRelays.length === 0) {
      const request: PublishRequest = {
        id,
        eventId: event.id,
        event,
        timestamp,
        relayMode: mode,
        resolvedRelays: [],
        relayResults: {},
        status: "failed",
        duration: 0,
      };

      this.publishRequests.set(id, request);
      this.emitPublishHistory();
      await this.persistPublishRequest(request);

      return request;
    }

    // Initialize relay results
    const relayResults: Record<string, RelayPublishResult> = {};
    for (const relay of resolvedRelays) {
      relayResults[relay] = {
        relay,
        status: "pending",
        startedAt: timestamp,
      };
    }

    // Create initial request
    const request: PublishRequest = {
      id,
      eventId: event.id,
      event,
      timestamp,
      relayMode: mode,
      resolvedRelays,
      relayResults,
      status: "pending",
    };

    // Add to cache and emit
    this.publishRequests.set(id, request);
    this.emitPublishHistory();
    onStatusChange?.(request);

    // Publish to each relay individually for granular tracking
    const publishPromises = resolvedRelays.map(async (relay) => {
      const relayResult = relayResults[relay];

      try {
        // Publish to single relay
        await pool.publish([relay], event);

        relayResult.status = "success";
        relayResult.completedAt = Date.now();
        relayResult.okMessage = "OK";
      } catch (error) {
        relayResult.status = "failed";
        relayResult.completedAt = Date.now();
        relayResult.error =
          error instanceof Error ? error.message : "Unknown publish error";
      }

      // Notify per-relay callback
      onRelayStatus?.(relay, relayResult);

      // Update request status
      request.relayResults = { ...relayResults };
      request.status = calculatePublishStatus(relayResults);
      this.publishRequests.set(id, request);
      this.emitPublishHistory();
      onStatusChange?.(request);
    });

    // Wait for all publishes to complete
    await Promise.allSettled(publishPromises);

    // Final update
    request.duration = Date.now() - timestamp;
    request.status = calculatePublishStatus(relayResults);

    // Add to EventStore if at least one relay succeeded
    const successCount = Object.values(relayResults).filter(
      (r) => r.status === "success",
    ).length;
    if (successCount > 0) {
      eventStore.add(event);
    }

    // Persist final state
    this.publishRequests.set(id, request);
    this.emitPublishHistory();
    await this.persistPublishRequest(request);

    return request;
  }

  /**
   * Sign and publish an event in one operation
   * Returns a PublishOperation with both sign and publish tracking
   */
  async signAndPublish(
    unsignedEvent: UnsignedEvent,
    mode: RelayMode,
    options: PublishOptions = {},
  ): Promise<PublishOperation> {
    const id = generateId();
    const createdAt = Date.now();

    // Sign the event
    const signRequest = await this.sign(unsignedEvent);

    if (signRequest.status === "failed" || !signRequest.signedEvent) {
      // Create a failed publish operation
      return {
        id,
        signRequest,
        publishRequest: {
          id: generateId(),
          eventId: "",
          event: {} as NostrEvent,
          timestamp: createdAt,
          relayMode: mode,
          resolvedRelays: [],
          relayResults: {},
          status: "failed",
          duration: 0,
        },
        createdAt,
      };
    }

    // Publish the signed event
    const publishRequest = await this.publish(
      signRequest.signedEvent,
      mode,
      options,
    );

    return {
      id,
      signRequest,
      publishRequest,
      createdAt,
    };
  }

  /**
   * Republish a previously published event
   */
  async republish(
    publishRequestId: string,
    options: PublishOptions = {},
  ): Promise<PublishRequest> {
    const original = this.publishRequests.get(publishRequestId);
    if (!original) {
      throw new Error(`Publish request not found: ${publishRequestId}`);
    }

    // Republish using the same relay mode
    return this.publish(original.event, original.relayMode, options);
  }

  /**
   * Republish to a specific relay (for retry)
   */
  async republishToRelay(
    publishRequestId: string,
    relay: string,
  ): Promise<PublishRequest> {
    const original = this.publishRequests.get(publishRequestId);
    if (!original) {
      throw new Error(`Publish request not found: ${publishRequestId}`);
    }

    // Publish to explicit single relay
    return this.publish(original.event, { mode: "explicit", relays: [relay] });
  }

  /**
   * Get a sign request by ID
   */
  getSignRequest(id: string): SignRequest | undefined {
    return this.signRequests.get(id);
  }

  /**
   * Get a publish request by ID
   */
  getPublishRequest(id: string): PublishRequest | undefined {
    return this.publishRequests.get(id);
  }

  /**
   * Get all publish requests for a specific event
   */
  getPublishRequestsForEvent(eventId: string): PublishRequest[] {
    return Array.from(this.publishRequests.values())
      .filter((r) => r.eventId === eventId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get publishing statistics
   */
  getStats(): PublishStats {
    const signRequests = Array.from(this.signRequests.values());
    const publishRequests = Array.from(this.publishRequests.values());

    return {
      totalSignRequests: signRequests.length,
      successfulSigns: signRequests.filter((r) => r.status === "success")
        .length,
      failedSigns: signRequests.filter((r) => r.status === "failed").length,
      totalPublishRequests: publishRequests.length,
      successfulPublishes: publishRequests.filter((r) => r.status === "success")
        .length,
      partialPublishes: publishRequests.filter((r) => r.status === "partial")
        .length,
      failedPublishes: publishRequests.filter((r) => r.status === "failed")
        .length,
      pendingPublishes: publishRequests.filter((r) => r.status === "pending")
        .length,
    };
  }

  /**
   * Clear history older than a specific date
   */
  async clearHistory(olderThan: Date): Promise<void> {
    const cutoff = olderThan.getTime();

    // Clear from memory
    for (const [id, request] of this.signRequests) {
      if (request.timestamp < cutoff) {
        this.signRequests.delete(id);
      }
    }
    for (const [id, request] of this.publishRequests) {
      if (request.timestamp < cutoff) {
        this.publishRequests.delete(id);
      }
    }

    // Clear from Dexie
    await db.signHistory.where("timestamp").below(cutoff).delete();
    await db.publishHistory.where("timestamp").below(cutoff).delete();

    // Update observables
    this.emitSignHistory();
    this.emitPublishHistory();
  }

  /**
   * Clear all history
   */
  async clearAllHistory(): Promise<void> {
    this.signRequests.clear();
    this.publishRequests.clear();

    await db.signHistory.clear();
    await db.publishHistory.clear();

    this.emitSignHistory();
    this.emitPublishHistory();
  }

  /**
   * Check if history has been loaded
   */
  isLoaded(): boolean {
    return this.loaded;
  }
}

// Export class for testing
export { PublishingService };

// Singleton instance
export const publishingService = new PublishingService();
export default publishingService;
