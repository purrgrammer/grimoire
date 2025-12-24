/**
 * Relay Metrics Collector
 *
 * Hooks into the relay pool to automatically collect performance metrics
 * for the RelayScoreboard. Tracks:
 * - Connection time (WebSocket connect duration)
 * - Session duration (time connected before disconnect)
 * - Response time (time from subscription start to EOSE)
 *
 * This is a singleton that initializes once when the app starts.
 */

import type { IRelay } from "applesauce-relay";
import type { Subscription } from "rxjs";
import { distinctUntilChanged, pairwise, startWith } from "rxjs/operators";
import pool from "./relay-pool";
import relayScoreboard from "./relay-scoreboard";

// Track connection timing per relay
interface ConnectionTiming {
  connectingStartedAt?: number;
  connectedAt?: number;
}

class RelayMetricsCollector {
  private connectionTimings = new Map<string, ConnectionTiming>();
  private subscriptions = new Map<string, Subscription>();
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  /**
   * Initialize the collector
   * Starts monitoring all relays in the pool
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    console.debug("[RelayMetricsCollector] Initializing...");

    // Monitor existing relays
    pool.relays.forEach((relay) => {
      this.monitorRelay(relay);
    });

    // Poll for new relays every second
    this.pollingInterval = setInterval(() => {
      pool.relays.forEach((relay) => {
        if (!this.subscriptions.has(relay.url)) {
          this.monitorRelay(relay);
        }
      });
    }, 1000);

    console.debug("[RelayMetricsCollector] Initialized");
  }

  /**
   * Monitor a single relay for connection state changes
   */
  private monitorRelay(relay: IRelay): void {
    const url = relay.url;

    // Skip if already monitoring
    if (this.subscriptions.has(url)) return;

    // Initialize timing
    this.connectionTimings.set(url, {});

    // Track when connecting starts (before WebSocket opens)
    // We'll use the transition from false->true in connected$
    const subscription = relay.connected$
      .pipe(
        startWith(relay.connected),
        distinctUntilChanged(),
        pairwise(), // Emit [previous, current] pairs
      )
      .subscribe(([wasConnected, isConnected]) => {
        const timing = this.connectionTimings.get(url) || {};
        const now = Date.now();

        if (!wasConnected && isConnected) {
          // Just connected
          const connectingStartedAt = timing.connectingStartedAt || now;
          const connectTimeMs = now - connectingStartedAt;

          // Record connection time
          relayScoreboard.recordConnect(url, connectTimeMs);

          // Update timing
          timing.connectedAt = now;
          timing.connectingStartedAt = undefined;

          console.debug(
            `[RelayMetricsCollector] ${url} connected in ${connectTimeMs}ms`,
          );
        } else if (wasConnected && !isConnected) {
          // Just disconnected
          if (timing.connectedAt) {
            const sessionDurationMs = now - timing.connectedAt;

            // Record session duration
            relayScoreboard.recordSessionEnd(url, sessionDurationMs);

            console.debug(
              `[RelayMetricsCollector] ${url} disconnected after ${Math.round(sessionDurationMs / 1000)}s`,
            );
          }

          // Reset timing for next connection
          timing.connectedAt = undefined;
          timing.connectingStartedAt = now; // Start timing next connect attempt
        }

        this.connectionTimings.set(url, timing);
      });

    this.subscriptions.set(url, subscription);
  }

  /**
   * Record a query response time for a relay
   * Called by subscription handlers when EOSE is received
   */
  recordResponseTime(url: string, responseTimeMs: number): void {
    relayScoreboard.recordResponse(url, responseTimeMs);
    console.debug(
      `[RelayMetricsCollector] ${url} responded in ${responseTimeMs}ms`,
    );
  }

  /**
   * Record a successful query for a relay
   */
  recordSuccess(url: string): void {
    relayScoreboard.recordSuccess(url);
  }

  /**
   * Record a failed query for a relay
   */
  recordFailure(url: string): void {
    relayScoreboard.recordFailure(url);
  }

  /**
   * Clean up all subscriptions
   */
  cleanup(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions.clear();
    this.connectionTimings.clear();
    this.initialized = false;
  }

  /**
   * Check if the collector is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
export const relayMetricsCollector = new RelayMetricsCollector();
export default relayMetricsCollector;
