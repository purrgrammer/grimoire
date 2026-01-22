import { describe, it, expect } from "vitest";
import {
  getRelayUrl,
  getRttMetrics,
  getNetworkType,
  getRelayType,
  getSupportedNips,
  getRelayRequirements,
  getRelayTopics,
  getRelayKinds,
  getRelayGeohash,
  parseNip11Document,
  calculateRelayHealth,
  getMonitorFrequency,
  getMonitorTimeouts,
  getMonitorChecks,
  getMonitorGeohash,
  formatFrequency,
  formatTimeout,
  getCheckTypeName,
} from "./nip66-helpers";
import { NostrEvent } from "@/types/nostr";

// Helper to create a minimal kind 30166 event (Relay Discovery)
function createRelayDiscoveryEvent(
  overrides?: Partial<NostrEvent>,
): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: Math.floor(Date.now() / 1000), // Current time by default
    kind: 30166,
    tags: [],
    content: "",
    sig: "test-sig",
    ...overrides,
  };
}

// Helper to create a minimal kind 10166 event (Monitor Announcement)
function createMonitorEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    kind: 10166,
    tags: [],
    content: "",
    sig: "test-sig",
    ...overrides,
  };
}

describe("Kind 30166 (Relay Discovery) Helpers", () => {
  describe("getRelayUrl", () => {
    it("should extract relay URL from d tag", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "wss://relay.example.com"]],
      });
      expect(getRelayUrl(event)).toBe("wss://relay.example.com");
    });

    it("should handle normalized URL without wss://", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
      });
      expect(getRelayUrl(event)).toBe("relay.example.com");
    });

    it("should return undefined if no d tag", () => {
      const event = createRelayDiscoveryEvent({
        tags: [],
      });
      expect(getRelayUrl(event)).toBeUndefined();
    });
  });

  describe("getRttMetrics", () => {
    it("should parse all RTT values", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["rtt-open", "150"],
          ["rtt-read", "200"],
          ["rtt-write", "250"],
        ],
      });
      const rtt = getRttMetrics(event);
      expect(rtt.open).toBe(150);
      expect(rtt.read).toBe(200);
      expect(rtt.write).toBe(250);
    });

    it("should handle missing RTT values", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["rtt-open", "100"],
        ],
      });
      const rtt = getRttMetrics(event);
      expect(rtt.open).toBe(100);
      expect(rtt.read).toBeUndefined();
      expect(rtt.write).toBeUndefined();
    });

    it("should return all undefined if no RTT tags", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
      });
      const rtt = getRttMetrics(event);
      expect(rtt.open).toBeUndefined();
      expect(rtt.read).toBeUndefined();
      expect(rtt.write).toBeUndefined();
    });

    it("should handle non-numeric RTT values", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["rtt-open", "invalid"],
        ],
      });
      const rtt = getRttMetrics(event);
      expect(rtt.open).toBeNaN();
    });
  });

  describe("getNetworkType", () => {
    it("should extract clearnet network type", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["n", "clearnet"],
        ],
      });
      expect(getNetworkType(event)).toBe("clearnet");
    });

    it("should extract tor network type", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.onion"],
          ["n", "tor"],
        ],
      });
      expect(getNetworkType(event)).toBe("tor");
    });

    it("should return undefined if no network type tag", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
      });
      expect(getNetworkType(event)).toBeUndefined();
    });
  });

  describe("getRelayType", () => {
    it("should extract relay type", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["T", "Public"],
        ],
      });
      expect(getRelayType(event)).toBe("Public");
    });

    it("should return undefined if no type tag", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
      });
      expect(getRelayType(event)).toBeUndefined();
    });
  });

  describe("getSupportedNips", () => {
    it("should extract and sort NIP numbers", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["N", "11"],
          ["N", "1"],
          ["N", "65"],
          ["N", "42"],
        ],
      });
      expect(getSupportedNips(event)).toEqual([1, 11, 42, 65]);
    });

    it("should deduplicate NIPs", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["N", "1"],
          ["N", "11"],
          ["N", "1"],
        ],
      });
      expect(getSupportedNips(event)).toEqual([1, 11]);
    });

    it("should filter out invalid NIP numbers", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["N", "1"],
          ["N", "invalid"],
          ["N", "11"],
        ],
      });
      expect(getSupportedNips(event)).toEqual([1, 11]);
    });

    it("should return empty array if no NIP tags", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
      });
      expect(getSupportedNips(event)).toEqual([]);
    });
  });

  describe("getRelayRequirements", () => {
    it("should parse positive requirements", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["R", "auth"],
          ["R", "payment"],
        ],
      });
      const reqs = getRelayRequirements(event);
      expect(reqs.auth).toBe(true);
      expect(reqs.payment).toBe(true);
    });

    it("should parse negative requirements with ! prefix", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["R", "!auth"],
          ["R", "!payment"],
        ],
      });
      const reqs = getRelayRequirements(event);
      expect(reqs.auth).toBe(false);
      expect(reqs.payment).toBe(false);
    });

    it("should handle mixed positive and negative requirements", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["R", "auth"],
          ["R", "!payment"],
          ["R", "writes"],
          ["R", "!pow"],
        ],
      });
      const reqs = getRelayRequirements(event);
      expect(reqs.auth).toBe(true);
      expect(reqs.payment).toBe(false);
      expect(reqs.writes).toBe(true);
      expect(reqs.pow).toBe(false);
    });

    it("should return empty object if no requirement tags", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
      });
      expect(getRelayRequirements(event)).toEqual({});
    });

    it("should ignore unknown requirements", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["R", "auth"],
          ["R", "unknown"],
        ],
      });
      const reqs = getRelayRequirements(event);
      expect(reqs.auth).toBe(true);
      expect(Object.keys(reqs)).toHaveLength(1);
    });
  });

  describe("getRelayTopics", () => {
    it("should extract all topics", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["t", "bitcoin"],
          ["t", "nostr"],
          ["t", "general"],
        ],
      });
      expect(getRelayTopics(event)).toEqual(["bitcoin", "nostr", "general"]);
    });

    it("should return empty array if no topics", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
      });
      expect(getRelayTopics(event)).toEqual([]);
    });
  });

  describe("getRelayKinds", () => {
    it("should separate accepted and rejected kinds", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["k", "1"],
          ["k", "3"],
          ["k", "!7"],
          ["k", "!1984"],
        ],
      });
      const kinds = getRelayKinds(event);
      expect(kinds.accepted).toEqual([1, 3]);
      expect(kinds.rejected).toEqual([7, 1984]);
    });

    it("should deduplicate kinds", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["k", "1"],
          ["k", "1"],
          ["k", "!7"],
          ["k", "!7"],
        ],
      });
      const kinds = getRelayKinds(event);
      expect(kinds.accepted).toEqual([1]);
      expect(kinds.rejected).toEqual([7]);
    });

    it("should return empty arrays if no kind tags", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
      });
      const kinds = getRelayKinds(event);
      expect(kinds.accepted).toEqual([]);
      expect(kinds.rejected).toEqual([]);
    });

    it("should filter out invalid kind numbers", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["k", "1"],
          ["k", "invalid"],
          ["k", "!7"],
        ],
      });
      const kinds = getRelayKinds(event);
      expect(kinds.accepted).toEqual([1]);
      expect(kinds.rejected).toEqual([7]);
    });
  });

  describe("getRelayGeohash", () => {
    it("should extract geohash", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["g", "u4pruydqqvj"],
        ],
      });
      expect(getRelayGeohash(event)).toBe("u4pruydqqvj");
    });

    it("should return undefined if no geohash tag", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
      });
      expect(getRelayGeohash(event)).toBeUndefined();
    });
  });

  describe("parseNip11Document", () => {
    it("should parse valid JSON content", () => {
      const nip11 = {
        name: "Test Relay",
        description: "A test relay",
        supported_nips: [1, 11, 42],
      };
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
        content: JSON.stringify(nip11),
      });
      expect(parseNip11Document(event)).toEqual(nip11);
    });

    it("should return undefined for empty content", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
        content: "",
      });
      expect(parseNip11Document(event)).toBeUndefined();
    });

    it("should return undefined for invalid JSON", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
        content: "not json",
      });
      expect(parseNip11Document(event)).toBeUndefined();
    });
  });

  describe("calculateRelayHealth", () => {
    it("should return 100 for recent event with low RTT", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["rtt-open", "50"],
          ["rtt-read", "60"],
          ["rtt-write", "70"],
        ],
        created_at: Math.floor(Date.now() / 1000), // Now
      });
      expect(calculateRelayHealth(event)).toBe(100);
    });

    it("should penalize high RTT", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["rtt-open", "1500"],
          ["rtt-read", "1500"],
          ["rtt-write", "1500"],
        ],
        created_at: Math.floor(Date.now() / 1000), // Now
      });
      const health = calculateRelayHealth(event);
      expect(health).toBeLessThan(100);
      expect(health).toBeGreaterThanOrEqual(0);
    });

    it("should penalize old events", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["rtt-open", "50"],
          ["rtt-read", "60"],
          ["rtt-write", "70"],
        ],
        created_at: Math.floor(Date.now() / 1000) - 10 * 24 * 60 * 60, // 10 days ago
      });
      const health = calculateRelayHealth(event);
      expect(health).toBeLessThan(100);
      expect(health).toBeGreaterThanOrEqual(0);
    });

    it("should handle events with no RTT data", () => {
      const event = createRelayDiscoveryEvent({
        tags: [["d", "relay.example.com"]],
        created_at: Math.floor(Date.now() / 1000), // Now
      });
      const health = calculateRelayHealth(event);
      expect(health).toBe(100); // No RTT penalty
    });

    it("should never return negative health", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["rtt-open", "5000"],
          ["rtt-read", "5000"],
          ["rtt-write", "5000"],
        ],
        created_at: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, // 30 days ago
      });
      const health = calculateRelayHealth(event);
      expect(health).toBeGreaterThanOrEqual(0);
    });

    it("should never return health above 100", () => {
      const event = createRelayDiscoveryEvent({
        tags: [
          ["d", "relay.example.com"],
          ["rtt-open", "10"],
          ["rtt-read", "10"],
          ["rtt-write", "10"],
        ],
        created_at: Math.floor(Date.now() / 1000), // Now
      });
      const health = calculateRelayHealth(event);
      expect(health).toBeLessThanOrEqual(100);
    });
  });
});

describe("Kind 10166 (Monitor Announcement) Helpers", () => {
  describe("getMonitorFrequency", () => {
    it("should extract frequency in seconds", () => {
      const event = createMonitorEvent({
        tags: [["frequency", "300"]],
      });
      expect(getMonitorFrequency(event)).toBe(300);
    });

    it("should return undefined if no frequency tag", () => {
      const event = createMonitorEvent({
        tags: [],
      });
      expect(getMonitorFrequency(event)).toBeUndefined();
    });

    it("should handle invalid frequency value", () => {
      const event = createMonitorEvent({
        tags: [["frequency", "invalid"]],
      });
      expect(getMonitorFrequency(event)).toBeNaN();
    });
  });

  describe("getMonitorTimeouts", () => {
    it("should extract timeout configurations", () => {
      const event = createMonitorEvent({
        tags: [
          ["timeout", "open", "1000"],
          ["timeout", "read", "2000"],
          ["timeout", "write", "3000"],
        ],
      });
      const timeouts = getMonitorTimeouts(event);
      expect(timeouts.open).toBe(1000);
      expect(timeouts.read).toBe(2000);
      expect(timeouts.write).toBe(3000);
    });

    it("should return empty object if no timeout tags", () => {
      const event = createMonitorEvent({
        tags: [],
      });
      expect(getMonitorTimeouts(event)).toEqual({});
    });

    it("should ignore malformed timeout tags", () => {
      const event = createMonitorEvent({
        tags: [
          ["timeout", "open", "1000"],
          ["timeout", "invalid"],
          ["timeout", "read"],
        ],
      });
      const timeouts = getMonitorTimeouts(event);
      expect(timeouts.open).toBe(1000);
      expect(Object.keys(timeouts)).toHaveLength(1);
    });
  });

  describe("getMonitorChecks", () => {
    it("should extract all check types", () => {
      const event = createMonitorEvent({
        tags: [
          ["c", "open"],
          ["c", "read"],
          ["c", "write"],
          ["c", "auth"],
        ],
      });
      expect(getMonitorChecks(event)).toEqual([
        "open",
        "read",
        "write",
        "auth",
      ]);
    });

    it("should deduplicate check types", () => {
      const event = createMonitorEvent({
        tags: [
          ["c", "open"],
          ["c", "read"],
          ["c", "open"],
        ],
      });
      expect(getMonitorChecks(event)).toEqual(["open", "read"]);
    });

    it("should return empty array if no check tags", () => {
      const event = createMonitorEvent({
        tags: [],
      });
      expect(getMonitorChecks(event)).toEqual([]);
    });
  });

  describe("getMonitorGeohash", () => {
    it("should extract geohash", () => {
      const event = createMonitorEvent({
        tags: [["g", "u4pruydqqvj"]],
      });
      expect(getMonitorGeohash(event)).toBe("u4pruydqqvj");
    });

    it("should return undefined if no geohash tag", () => {
      const event = createMonitorEvent({
        tags: [],
      });
      expect(getMonitorGeohash(event)).toBeUndefined();
    });
  });
});

describe("Formatting Utilities", () => {
  describe("formatFrequency", () => {
    it("should format seconds", () => {
      expect(formatFrequency(1)).toBe("1 second");
      expect(formatFrequency(30)).toBe("30 seconds");
    });

    it("should format minutes", () => {
      expect(formatFrequency(60)).toBe("1 minute");
      expect(formatFrequency(300)).toBe("5 minutes");
    });

    it("should format hours", () => {
      expect(formatFrequency(3600)).toBe("1 hour");
      expect(formatFrequency(7200)).toBe("2 hours");
    });

    it("should format days", () => {
      expect(formatFrequency(86400)).toBe("1 day");
      expect(formatFrequency(172800)).toBe("2 days");
    });
  });

  describe("formatTimeout", () => {
    it("should format milliseconds", () => {
      expect(formatTimeout(500)).toBe("500ms");
      expect(formatTimeout(999)).toBe("999ms");
    });

    it("should format seconds", () => {
      expect(formatTimeout(1000)).toBe("1s");
      expect(formatTimeout(2500)).toBe("2.5s");
    });

    it("should format minutes", () => {
      expect(formatTimeout(60000)).toBe("1m");
      expect(formatTimeout(120000)).toBe("2m");
    });
  });

  describe("getCheckTypeName", () => {
    it("should return human-readable names for known check types", () => {
      expect(getCheckTypeName("open")).toBe("Connection");
      expect(getCheckTypeName("read")).toBe("Read");
      expect(getCheckTypeName("write")).toBe("Write");
      expect(getCheckTypeName("auth")).toBe("Authentication");
      expect(getCheckTypeName("nip11")).toBe("NIP-11 Info");
      expect(getCheckTypeName("dns")).toBe("DNS");
      expect(getCheckTypeName("geo")).toBe("Geolocation");
    });

    it("should return input for unknown check types", () => {
      expect(getCheckTypeName("unknown")).toBe("unknown");
      expect(getCheckTypeName("custom-check")).toBe("custom-check");
    });
  });
});
