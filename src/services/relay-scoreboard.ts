/**
 * Relay Performance Scoreboard
 *
 * Tracks relay performance metrics and calculates scores to prefer
 * fast, reliable relays during outbox selection.
 *
 * Metrics tracked:
 * - Response time: How fast the relay answers queries (REQ → EOSE)
 * - Connection time: How fast WebSocket connection establishes
 * - Session stability: How long before the relay disconnects
 * - Success rate: Ratio of successful vs failed queries
 *
 * Scores range from 0-10, with 10 being the best.
 */

import db, { RelayPerformanceEntry } from "./db";
import { normalizeRelayURL } from "@/lib/relay-url";

// Weights for score calculation
const WEIGHTS = {
  responseTime: 0.4, // Most important for UX
  connectTime: 0.2,
  stability: 0.2,
  successRate: 0.2,
};

// Alpha for exponential moving average (0.3 = 30% weight on new value)
const EMA_ALPHA = 0.3;

// Auto-save interval (30 seconds)
const AUTO_SAVE_INTERVAL = 30 * 1000;

// Default metrics for unknown relays
const DEFAULT_METRICS: Omit<RelayPerformanceEntry, "url"> = {
  responseTimeMs: 500, // Assume average
  responseTimeCount: 0,
  connectTimeMs: 500,
  connectTimeCount: 0,
  avgSessionDurationMs: 60000, // Assume 1 minute
  sessionCount: 0,
  successfulQueries: 0,
  failedQueries: 0,
  lastUpdated: 0,
  lastSuccess: 0,
  lastFailure: 0,
};

/**
 * Calculate a score component based on response/connect time
 * Returns 0-10, with faster times scoring higher
 */
function calculateTimeScore(timeMs: number): number {
  // 1 point per 100ms under 1000ms, max 10, min 0
  // Fast relay (100ms) = 9 points
  // Average relay (500ms) = 5 points
  // Slow relay (1000ms) = 0 points
  // Very slow relay (2000ms) = -10 (clamped to 0)
  const score = (1000 - timeMs) / 100;
  return Math.max(0, Math.min(10, score));
}

/**
 * Calculate stability score based on session duration
 * Returns 0-10, with longer sessions scoring higher
 */
function calculateStabilityScore(avgSessionDurationMs: number): number {
  // 1 point per 30 seconds of stability, max 10 (5 min)
  const score = avgSessionDurationMs / 30000;
  return Math.max(0, Math.min(10, score));
}

/**
 * Calculate success rate score
 * Returns 0-10 based on query success ratio
 */
function calculateSuccessScore(
  successfulQueries: number,
  failedQueries: number,
): number {
  const total = successfulQueries + failedQueries;
  if (total === 0) {
    // No data - assume 50% (neutral)
    return 5;
  }
  const successRate = successfulQueries / total;
  return successRate * 10;
}

/**
 * Calculate the overall relay score (0-10)
 */
export function calculateRelayScore(
  metrics: Omit<RelayPerformanceEntry, "url">,
): number {
  const responseScore = calculateTimeScore(metrics.responseTimeMs);
  const connectScore = calculateTimeScore(metrics.connectTimeMs);
  const stabilityScore = calculateStabilityScore(metrics.avgSessionDurationMs);
  const successScore = calculateSuccessScore(
    metrics.successfulQueries,
    metrics.failedQueries,
  );

  // Weighted combination
  const score =
    responseScore * WEIGHTS.responseTime +
    connectScore * WEIGHTS.connectTime +
    stabilityScore * WEIGHTS.stability +
    successScore * WEIGHTS.successRate;

  return Math.max(0, Math.min(10, score));
}

/**
 * Calculate adaptive timeout based on historical performance
 * Returns timeout in milliseconds
 */
export function calculateAdaptiveTimeout(
  metrics: Omit<RelayPerformanceEntry, "url"> | undefined,
  defaultTimeout: number = 1000,
): number {
  if (!metrics || metrics.responseTimeCount < 3) {
    // Not enough data - use default
    return defaultTimeout;
  }

  // Base timeout: 2x average response time
  let timeout = metrics.responseTimeMs * 2;

  // Adjust based on success rate
  const totalQueries = metrics.successfulQueries + metrics.failedQueries;
  if (totalQueries > 5) {
    const successRate = metrics.successfulQueries / totalQueries;
    if (successRate < 0.5) {
      // Unreliable relay - shorter timeout to fail fast
      timeout = Math.min(timeout, 500);
    }
  }

  // Clamp to reasonable bounds
  return Math.max(300, Math.min(2000, timeout));
}

/**
 * Update a metric using exponential moving average
 */
function updateEMA(current: number, newValue: number, count: number): number {
  if (count === 0) {
    // First measurement
    return newValue;
  }
  // EMA: new = alpha * newValue + (1 - alpha) * current
  return EMA_ALPHA * newValue + (1 - EMA_ALPHA) * current;
}

class RelayScoreboard {
  private metrics = new Map<string, RelayPerformanceEntry>();
  private dirty = new Set<string>(); // URLs with unsaved changes
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private loaded = false;

  constructor() {
    // Load persisted metrics on construction
    this.load();
    // Start auto-save
    this.startAutoSave();
  }

  /**
   * Record a successful query response time
   */
  recordResponse(url: string, responseTimeMs: number): void {
    const normalized = this.normalize(url);
    if (!normalized) return;

    const entry = this.getOrCreate(normalized);
    entry.responseTimeMs = updateEMA(
      entry.responseTimeMs,
      responseTimeMs,
      entry.responseTimeCount,
    );
    entry.responseTimeCount++;
    entry.lastUpdated = Date.now();
    entry.lastSuccess = Date.now();

    this.dirty.add(normalized);
  }

  /**
   * Record connection establishment time
   */
  recordConnect(url: string, connectTimeMs: number): void {
    const normalized = this.normalize(url);
    if (!normalized) return;

    const entry = this.getOrCreate(normalized);
    entry.connectTimeMs = updateEMA(
      entry.connectTimeMs,
      connectTimeMs,
      entry.connectTimeCount,
    );
    entry.connectTimeCount++;
    entry.lastUpdated = Date.now();

    this.dirty.add(normalized);
  }

  /**
   * Record session end for stability tracking
   */
  recordSessionEnd(url: string, durationMs: number): void {
    const normalized = this.normalize(url);
    if (!normalized) return;

    const entry = this.getOrCreate(normalized);
    entry.avgSessionDurationMs = updateEMA(
      entry.avgSessionDurationMs,
      durationMs,
      entry.sessionCount,
    );
    entry.sessionCount++;
    entry.lastUpdated = Date.now();

    this.dirty.add(normalized);
  }

  /**
   * Record query success
   */
  recordSuccess(url: string): void {
    const normalized = this.normalize(url);
    if (!normalized) return;

    const entry = this.getOrCreate(normalized);
    entry.successfulQueries++;
    entry.lastUpdated = Date.now();
    entry.lastSuccess = Date.now();

    this.dirty.add(normalized);
  }

  /**
   * Record query failure
   */
  recordFailure(url: string): void {
    const normalized = this.normalize(url);
    if (!normalized) return;

    const entry = this.getOrCreate(normalized);
    entry.failedQueries++;
    entry.lastUpdated = Date.now();
    entry.lastFailure = Date.now();

    this.dirty.add(normalized);
  }

  /**
   * Get score for a relay (0-10)
   * Returns 5 (neutral) for unknown relays
   */
  getScore(url: string): number {
    const normalized = this.normalize(url);
    if (!normalized) return 5;

    const entry = this.metrics.get(normalized);
    if (!entry) {
      return 5; // Neutral score for unknown relays
    }

    return calculateRelayScore(entry);
  }

  /**
   * Get adaptive timeout for a relay
   */
  getAdaptiveTimeout(url: string, defaultTimeout: number = 1000): number {
    const normalized = this.normalize(url);
    if (!normalized) return defaultTimeout;

    const entry = this.metrics.get(normalized);
    return calculateAdaptiveTimeout(entry, defaultTimeout);
  }

  /**
   * Get raw metrics for a relay (for debugging/diagnostics)
   */
  getMetrics(url: string): RelayPerformanceEntry | undefined {
    const normalized = this.normalize(url);
    if (!normalized) return undefined;

    return this.metrics.get(normalized);
  }

  /**
   * Get all tracked relays and their scores
   */
  getAllScores(): Array<{ url: string; score: number }> {
    const results: Array<{ url: string; score: number }> = [];

    for (const [url, entry] of this.metrics) {
      results.push({
        url,
        score: calculateRelayScore(entry),
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Check if scoreboard has been loaded
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Save dirty entries to Dexie
   */
  async save(): Promise<void> {
    if (this.dirty.size === 0) return;

    const entries: RelayPerformanceEntry[] = [];
    for (const url of this.dirty) {
      const entry = this.metrics.get(url);
      if (entry) {
        entries.push(entry);
      }
    }

    try {
      await db.relayPerformance.bulkPut(entries);
      this.dirty.clear();
      console.debug(
        `[RelayScoreboard] Saved ${entries.length} entries to database`,
      );
    } catch (error) {
      console.error("[RelayScoreboard] Failed to save metrics:", error);
    }
  }

  /**
   * Load metrics from Dexie
   */
  async load(): Promise<void> {
    try {
      const entries = await db.relayPerformance.toArray();
      for (const entry of entries) {
        this.metrics.set(entry.url, entry);
      }
      this.loaded = true;
      console.debug(
        `[RelayScoreboard] Loaded ${entries.length} entries from database`,
      );
    } catch (error) {
      console.error("[RelayScoreboard] Failed to load metrics:", error);
      this.loaded = true; // Mark as loaded even on error to allow fresh start
    }
  }

  /**
   * Clear all metrics (for testing or reset)
   */
  async clear(): Promise<void> {
    this.metrics.clear();
    this.dirty.clear();
    try {
      await db.relayPerformance.clear();
      console.debug("[RelayScoreboard] Cleared all metrics");
    } catch (error) {
      console.error("[RelayScoreboard] Failed to clear metrics:", error);
    }
  }

  /**
   * Get or create metrics entry for a URL
   */
  private getOrCreate(url: string): RelayPerformanceEntry {
    let entry = this.metrics.get(url);
    if (!entry) {
      entry = {
        url,
        ...DEFAULT_METRICS,
      };
      this.metrics.set(url, entry);
    }
    return entry;
  }

  /**
   * Normalize URL safely
   */
  private normalize(url: string): string | null {
    try {
      return normalizeRelayURL(url);
    } catch {
      console.warn(`[RelayScoreboard] Invalid relay URL: ${url}`);
      return null;
    }
  }

  /**
   * Start auto-save interval
   */
  private startAutoSave(): void {
    if (this.saveInterval) return;

    this.saveInterval = setInterval(() => {
      this.save().catch((error) => {
        console.error("[RelayScoreboard] Auto-save failed:", error);
      });
    }, AUTO_SAVE_INTERVAL);
  }

  /**
   * Stop auto-save interval
   */
  stopAutoSave(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
  }
}

// Singleton instance
export const relayScoreboard = new RelayScoreboard();
export default relayScoreboard;
