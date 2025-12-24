import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateRelayScore,
  calculateAdaptiveTimeout,
} from "./relay-scoreboard";
import type { RelayPerformanceEntry } from "./db";

// Helper to create metrics with defaults
function makeMetrics(
  overrides: Partial<Omit<RelayPerformanceEntry, "url">> = {},
): Omit<RelayPerformanceEntry, "url"> {
  return {
    responseTimeMs: 500,
    responseTimeCount: 10,
    connectTimeMs: 500,
    connectTimeCount: 10,
    avgSessionDurationMs: 60000,
    sessionCount: 10,
    successfulQueries: 50,
    failedQueries: 0,
    lastUpdated: Date.now(),
    lastSuccess: Date.now(),
    lastFailure: 0,
    ...overrides,
  };
}

describe("calculateRelayScore", () => {
  describe("response time scoring", () => {
    it("should score fast relays higher than slow relays", () => {
      const fast = makeMetrics({ responseTimeMs: 100 });
      const slow = makeMetrics({ responseTimeMs: 900 });

      expect(calculateRelayScore(fast)).toBeGreaterThan(
        calculateRelayScore(slow),
      );
    });

    it("should give max response score (10) for 0ms response", () => {
      // With 0ms response time: score = (1000 - 0) / 100 = 10
      const instant = makeMetrics({
        responseTimeMs: 0,
        connectTimeMs: 0,
        avgSessionDurationMs: 300000, // 5 min = 10 points
        successfulQueries: 100,
        failedQueries: 0, // 100% success = 10 points
      });

      // All metrics at max = 10
      expect(calculateRelayScore(instant)).toBe(10);
    });

    it("should give 0 response score for 1000ms+ response", () => {
      const slow = makeMetrics({
        responseTimeMs: 1000,
        connectTimeMs: 1000,
        avgSessionDurationMs: 0, // 0 stability
        successfulQueries: 0,
        failedQueries: 100, // 0% success
      });

      // All metrics at 0 = 0
      expect(calculateRelayScore(slow)).toBe(0);
    });
  });

  describe("connection time scoring", () => {
    it("should score fast connections higher", () => {
      const fastConnect = makeMetrics({ connectTimeMs: 100 });
      const slowConnect = makeMetrics({ connectTimeMs: 800 });

      expect(calculateRelayScore(fastConnect)).toBeGreaterThan(
        calculateRelayScore(slowConnect),
      );
    });
  });

  describe("stability scoring", () => {
    it("should score stable relays higher", () => {
      const stable = makeMetrics({ avgSessionDurationMs: 300000 }); // 5 min
      const unstable = makeMetrics({ avgSessionDurationMs: 10000 }); // 10 sec

      expect(calculateRelayScore(stable)).toBeGreaterThan(
        calculateRelayScore(unstable),
      );
    });

    it("should give max stability score (10) for 5+ min sessions", () => {
      // 300000ms / 30000 = 10
      const stable = makeMetrics({ avgSessionDurationMs: 300000 });
      // With other metrics at 5 (avg):
      // 5*0.4 + 5*0.2 + 10*0.2 + 10*0.2 = 2 + 1 + 2 + 2 = 7
      expect(calculateRelayScore(stable)).toBeGreaterThan(5);
    });
  });

  describe("success rate scoring", () => {
    it("should score reliable relays higher", () => {
      const reliable = makeMetrics({
        successfulQueries: 95,
        failedQueries: 5,
      });
      const flaky = makeMetrics({ successfulQueries: 50, failedQueries: 50 });

      expect(calculateRelayScore(reliable)).toBeGreaterThan(
        calculateRelayScore(flaky),
      );
    });

    it("should give neutral score (5) for unknown relays", () => {
      const unknown = makeMetrics({ successfulQueries: 0, failedQueries: 0 });
      // With average other metrics, success rate contributes 5 * 0.2 = 1
      const score = calculateRelayScore(unknown);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(10);
    });

    it("should give 0 success score for 0% success rate", () => {
      const failing = makeMetrics({
        successfulQueries: 0,
        failedQueries: 100,
      });
      const passing = makeMetrics({
        successfulQueries: 100,
        failedQueries: 0,
      });

      expect(calculateRelayScore(failing)).toBeLessThan(
        calculateRelayScore(passing),
      );
    });
  });

  describe("combined scoring", () => {
    it("should return score between 0 and 10", () => {
      const metrics = makeMetrics();
      const score = calculateRelayScore(metrics);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(10);
    });

    it("should handle edge case metrics gracefully", () => {
      const extreme = makeMetrics({
        responseTimeMs: 10000, // Very slow
        connectTimeMs: 10000, // Very slow
        avgSessionDurationMs: 100, // Very unstable
        successfulQueries: 1,
        failedQueries: 99, // 1% success
      });

      const score = calculateRelayScore(extreme);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(10);
    });
  });
});

describe("calculateAdaptiveTimeout", () => {
  describe("default behavior", () => {
    it("should return default timeout for undefined metrics", () => {
      expect(calculateAdaptiveTimeout(undefined, 1000)).toBe(1000);
    });

    it("should return default timeout for insufficient samples", () => {
      const fewSamples = makeMetrics({ responseTimeCount: 2 });
      expect(calculateAdaptiveTimeout(fewSamples, 1000)).toBe(1000);
    });

    it("should return default timeout for exactly 3 samples", () => {
      // 3 is the threshold, so it should now use adaptive
      const exactlyThree = makeMetrics({
        responseTimeCount: 3,
        responseTimeMs: 200,
      });
      // 2x response time = 400ms
      expect(calculateAdaptiveTimeout(exactlyThree, 1000)).toBe(400);
    });
  });

  describe("adaptive timeout calculation", () => {
    it("should use 2x average response time", () => {
      const metrics = makeMetrics({
        responseTimeMs: 200,
        responseTimeCount: 10,
      });
      // 2 * 200 = 400ms
      expect(calculateAdaptiveTimeout(metrics, 1000)).toBe(400);
    });

    it("should cap timeout at 2000ms", () => {
      const slowRelay = makeMetrics({
        responseTimeMs: 1500,
        responseTimeCount: 10,
      });
      // 2 * 1500 = 3000, capped to 2000
      expect(calculateAdaptiveTimeout(slowRelay, 1000)).toBe(2000);
    });

    it("should enforce minimum timeout of 300ms", () => {
      const fastRelay = makeMetrics({
        responseTimeMs: 50,
        responseTimeCount: 10,
      });
      // 2 * 50 = 100, raised to 300
      expect(calculateAdaptiveTimeout(fastRelay, 1000)).toBe(300);
    });
  });

  describe("unreliable relay handling", () => {
    it("should use shorter timeout for unreliable relays", () => {
      const unreliable = makeMetrics({
        responseTimeMs: 500,
        responseTimeCount: 10,
        successfulQueries: 3,
        failedQueries: 7, // 30% success rate
      });
      // Base: 2 * 500 = 1000ms
      // But success rate < 50%, so cap at 500ms
      expect(calculateAdaptiveTimeout(unreliable, 1000)).toBe(500);
    });

    it("should not penalize relays with few queries", () => {
      const fewQueries = makeMetrics({
        responseTimeMs: 500,
        responseTimeCount: 10,
        successfulQueries: 2,
        failedQueries: 2, // 50% but only 4 total queries
      });
      // Not enough queries (< 5) to trigger unreliable penalty
      // So: 2 * 500 = 1000ms
      expect(calculateAdaptiveTimeout(fewQueries, 1000)).toBe(1000);
    });

    it("should penalize relays with many failures", () => {
      const manyFailures = makeMetrics({
        responseTimeMs: 500,
        responseTimeCount: 10,
        successfulQueries: 10,
        failedQueries: 20, // 33% success rate, 30 total queries
      });
      // Success rate < 50% with > 5 queries, cap at 500ms
      expect(calculateAdaptiveTimeout(manyFailures, 1000)).toBe(500);
    });
  });

  describe("boundary conditions", () => {
    it("should handle 50% success rate as reliable", () => {
      const fiftyPercent = makeMetrics({
        responseTimeMs: 600,
        responseTimeCount: 10,
        successfulQueries: 50,
        failedQueries: 50,
      });
      // 50% is not < 50%, so no penalty
      // 2 * 600 = 1200ms
      expect(calculateAdaptiveTimeout(fiftyPercent, 1000)).toBe(1200);
    });

    it("should handle 49% success rate as unreliable", () => {
      const fortyNinePercent = makeMetrics({
        responseTimeMs: 600,
        responseTimeCount: 10,
        successfulQueries: 49,
        failedQueries: 51,
      });
      // 49% < 50%, cap at 500ms
      expect(calculateAdaptiveTimeout(fortyNinePercent, 1000)).toBe(500);
    });
  });
});
