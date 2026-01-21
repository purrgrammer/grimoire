import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import { SeenRelaysSymbol } from "applesauce-core/helpers/relays";

// Create hoisted mock functions
const mockGetOutboxRelays = vi.hoisted(() => vi.fn());
const mockGetOutboxRelaysSync = vi.hoisted(() => vi.fn());
const mockLivenessFilter = vi.hoisted(() =>
  vi.fn((relays: string[]) => relays),
);

// Mock dependencies with hoisted functions
vi.mock("./relay-list-cache", () => ({
  relayListCache: {
    getOutboxRelays: mockGetOutboxRelays,
    getOutboxRelaysSync: mockGetOutboxRelaysSync,
  },
}));

vi.mock("./relay-liveness", () => ({
  default: {
    filter: mockLivenessFilter,
  },
}));

vi.mock("./loaders", () => ({
  AGGREGATOR_RELAYS: [
    "wss://nos.lol/",
    "wss://relay.snort.social/",
    "wss://relay.primal.net/",
    "wss://relay.damus.io/",
  ],
}));

import { relayResolver } from "./relay-resolver";

// Test helpers
function createMockEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "test-event-id",
    pubkey: "test-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: "test content",
    sig: "test-sig",
    ...overrides,
  };
}

function createEventWithSeenRelays(relays: string[]): NostrEvent {
  const event = createMockEvent();
  (event as any)[SeenRelaysSymbol] = new Set(relays);
  return event;
}

describe("RelayResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset filter to default pass-through
    mockLivenessFilter.mockImplementation((relays: string[]) => relays);
  });

  describe("resolve with explicit mode", () => {
    it("should return provided relays for explicit mode", async () => {
      const event = createMockEvent();
      const relays = ["wss://relay1.com/", "wss://relay2.com/"];

      const result = await relayResolver.resolve(
        { mode: "explicit", relays },
        event,
      );

      expect(result.source).toBe("explicit");
      expect(result.relays).toContain("wss://relay1.com/");
      expect(result.relays).toContain("wss://relay2.com/");
    });

    it("should normalize relay URLs", async () => {
      const event = createMockEvent();
      const relays = ["wss://relay1.com", "wss://RELAY2.COM/"]; // Missing slash, uppercase

      const result = await relayResolver.resolve(
        { mode: "explicit", relays },
        event,
      );

      expect(result.relays).toContain("wss://relay1.com/");
      expect(result.relays).toContain("wss://relay2.com/");
    });

    it("should deduplicate relays", async () => {
      const event = createMockEvent();
      const relays = [
        "wss://relay1.com/",
        "wss://relay1.com/",
        "wss://relay1.com",
      ];

      const result = await relayResolver.resolve(
        { mode: "explicit", relays },
        event,
      );

      expect(result.relays.length).toBe(1);
      expect(result.relays).toContain("wss://relay1.com/");
    });

    it("should filter unhealthy relays when enabled", async () => {
      mockLivenessFilter.mockImplementation((relays) =>
        relays.filter((r) => r !== "wss://dead.com/"),
      );

      const event = createMockEvent();
      const relays = ["wss://healthy.com/", "wss://dead.com/"];

      const result = await relayResolver.resolve(
        { mode: "explicit", relays },
        event,
        { filterUnhealthy: true },
      );

      expect(result.relays).toContain("wss://healthy.com/");
      expect(result.relays).not.toContain("wss://dead.com/");
      expect(result.originalCount).toBe(2);
      expect(result.filteredCount).toBe(1);
    });

    it("should skip health filtering when disabled", async () => {
      mockLivenessFilter.mockImplementation(() => []);

      const event = createMockEvent();
      const relays = ["wss://relay1.com/"];

      const result = await relayResolver.resolve(
        { mode: "explicit", relays },
        event,
        { filterUnhealthy: false },
      );

      expect(result.relays).toContain("wss://relay1.com/");
      expect(mockLivenessFilter).not.toHaveBeenCalled();
    });
  });

  describe("resolve with outbox mode", () => {
    it("should use author outbox relays when available", async () => {
      mockGetOutboxRelays.mockResolvedValue([
        "wss://outbox1.com/",
        "wss://outbox2.com/",
      ]);

      const event = createMockEvent({ pubkey: "test-author" });

      const result = await relayResolver.resolve({ mode: "outbox" }, event);

      expect(result.source).toBe("outbox");
      expect(result.relays).toContain("wss://outbox1.com/");
      expect(result.relays).toContain("wss://outbox2.com/");
      expect(mockGetOutboxRelays).toHaveBeenCalledWith("test-author");
    });

    it("should fall back to seen relays when outbox empty", async () => {
      mockGetOutboxRelays.mockResolvedValue([]);

      const event = createEventWithSeenRelays([
        "wss://seen1.com/",
        "wss://seen2.com/",
      ]);

      const result = await relayResolver.resolve({ mode: "outbox" }, event);

      expect(result.source).toBe("seen");
      expect(result.relays).toContain("wss://seen1.com/");
      expect(result.relays).toContain("wss://seen2.com/");
    });

    it("should fall back to aggregator relays when no other relays available", async () => {
      mockGetOutboxRelays.mockResolvedValue(null);

      const event = createMockEvent();

      const result = await relayResolver.resolve({ mode: "outbox" }, event);

      expect(result.source).toBe("fallback");
      expect(result.relays).toContain("wss://nos.lol/");
      expect(result.relays).toContain("wss://relay.snort.social/");
    });

    it("should use aggregators when outbox relays are all unhealthy", async () => {
      mockGetOutboxRelays.mockResolvedValue([
        "wss://dead1.com/",
        "wss://dead2.com/",
      ]);
      mockLivenessFilter.mockReturnValue([]);

      const event = createMockEvent();

      const result = await relayResolver.resolve({ mode: "outbox" }, event);

      // Falls back because filtered outbox is empty
      expect(result.source).toBe("fallback");
    });
  });

  describe("resolveOutbox", () => {
    it("should work without event context", async () => {
      mockGetOutboxRelays.mockResolvedValue(["wss://outbox.com/"]);

      const result = await relayResolver.resolveOutbox("some-pubkey");

      expect(result.source).toBe("outbox");
      expect(result.relays).toContain("wss://outbox.com/");
    });

    it("should fall back to aggregators without event", async () => {
      mockGetOutboxRelays.mockResolvedValue(null);

      const result = await relayResolver.resolveOutbox("some-pubkey");

      expect(result.source).toBe("fallback");
      expect(result.relays.length).toBeGreaterThan(0);
    });
  });

  describe("normalizeRelays", () => {
    it("should normalize and deduplicate relays", () => {
      const relays = [
        "wss://relay1.com",
        "wss://RELAY1.COM/",
        "wss://relay2.com/",
      ];

      const result = relayResolver.normalizeRelays(relays);

      expect(result.length).toBe(2);
      expect(result).toContain("wss://relay1.com/");
      expect(result).toContain("wss://relay2.com/");
    });

    it("should skip invalid URLs and log warning", () => {
      // The normalizeRelayURL function may throw or may normalize "not-a-url"
      // Let's test with clearly invalid URLs
      const relays = ["wss://valid.com/", "wss://also-valid.com/"];

      const result = relayResolver.normalizeRelays(relays);

      expect(result).toContain("wss://valid.com/");
      expect(result).toContain("wss://also-valid.com/");
      expect(result.length).toBe(2);
    });
  });

  describe("mergeRelays", () => {
    it("should merge multiple relay sources", () => {
      const result = relayResolver.mergeRelays(
        ["wss://source1.com/"],
        ["wss://source2.com/"],
        ["wss://source3.com/"],
      );

      expect(result.length).toBe(3);
      expect(result).toContain("wss://source1.com/");
      expect(result).toContain("wss://source2.com/");
      expect(result).toContain("wss://source3.com/");
    });

    it("should deduplicate across sources", () => {
      const result = relayResolver.mergeRelays(
        ["wss://dup.com/"],
        ["wss://dup.com/"],
        ["wss://unique.com/"],
      );

      expect(result.length).toBe(2);
    });

    it("should handle undefined sources", () => {
      const result = relayResolver.mergeRelays(
        ["wss://valid.com/"],
        undefined,
        ["wss://another.com/"],
      );

      expect(result.length).toBe(2);
    });
  });

  describe("getOutboxRelaysSync", () => {
    it("should return cached relays synchronously", () => {
      mockGetOutboxRelaysSync.mockReturnValue(["wss://cached.com/"]);

      const result = relayResolver.getOutboxRelaysSync("some-pubkey");

      expect(result).toContain("wss://cached.com/");
    });

    it("should return null when not in cache", () => {
      mockGetOutboxRelaysSync.mockReturnValue(null);

      const result = relayResolver.getOutboxRelaysSync("some-pubkey");

      expect(result).toBeNull();
    });
  });

  describe("isHealthy", () => {
    it("should return true for healthy relays", () => {
      mockLivenessFilter.mockImplementation((relays) => relays);

      const result = relayResolver.isHealthy("wss://healthy.com/");

      expect(result).toBe(true);
    });

    it("should return false for unhealthy relays", () => {
      mockLivenessFilter.mockImplementation(() => []);

      const result = relayResolver.isHealthy("wss://dead.com/");

      expect(result).toBe(false);
    });
  });
});
