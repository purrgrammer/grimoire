import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventLoader } from "./loaders";
import type { NostrEvent } from "@/types/nostr";
import { SeenRelaysSymbol } from "applesauce-core/helpers/relays";
import type { EventPointer } from "nostr-tools/nip19";

// Mock dependencies
vi.mock("./relay-pool", () => ({
  default: {}, // Mock pool object
}));

vi.mock("./event-store", () => ({
  default: {
    getEvent: vi.fn(),
  },
}));

vi.mock("./relay-list-cache", () => ({
  relayListCache: {
    getOutboxRelaysSync: vi.fn(),
  },
}));

vi.mock("applesauce-loaders/loaders", () => ({
  createEventLoader: vi.fn(
    () => (pointer: EventPointer) =>
      ({
        subscribe: () => ({
          unsubscribe: () => {},
        }),
        // Return pointer so we can inspect it in tests
        _testPointer: pointer,
      }) as any,
  ),
  createAddressLoader: vi.fn(() => () => ({ subscribe: () => {} })),
  createTimelineLoader: vi.fn(),
  createEventLoaderForStore: vi.fn(),
}));

import eventStore from "./event-store";
import { relayListCache } from "./relay-list-cache";

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

function createEventWithTags(tags: string[][]): NostrEvent {
  return createMockEvent({ tags });
}

describe("eventLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic functionality", () => {
    it("should handle string ID with no context", () => {
      const result = eventLoader({ id: "test123" });

      expect(result).toBeDefined();
      expect((result as any)._testPointer.id).toBe("test123");
      // mergeRelaySets normalizes URLs with trailing slash
      expect((result as any)._testPointer.relays).toContain("wss://nos.lol/");
    });

    it("should handle EventPointer with relay hints", () => {
      const pointer: EventPointer = {
        id: "test123",
        relays: ["wss://relay.example.com/"],
      };

      const result = eventLoader(pointer);

      // mergeRelaySets normalizes URLs with trailing slash
      expect((result as any)._testPointer.relays).toContain(
        "wss://relay.example.com/",
      );
    });

    it("should handle undefined context gracefully", () => {
      const result = eventLoader({ id: "test123" }, undefined);

      expect(result).toBeDefined();
      // mergeRelaySets normalizes URLs with trailing slash
      expect((result as any)._testPointer.relays).toContain("wss://nos.lol/");
    });
  });

  describe("backward compatibility with string authorHint", () => {
    it("should accept string pubkey as context", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://author-relay.com/",
      ]);

      const result = eventLoader({ id: "test123" }, "author-pubkey");

      expect(relayListCache.getOutboxRelaysSync).toHaveBeenCalledWith(
        "author-pubkey",
      );
      expect((result as any)._testPointer.relays).toContain(
        "wss://author-relay.com/",
      );
    });

    it("should use cached relays when authorHint provided", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://cached1.com/",
        "wss://cached2.com/",
        "wss://cached3.com/",
        "wss://cached4.com/", // Should be limited to 3
      ]);

      const result = eventLoader({ id: "test123" }, "author-pubkey");

      const relays = (result as any)._testPointer.relays;
      expect(relays).toContain("wss://cached1.com/");
      expect(relays).toContain("wss://cached2.com/");
      expect(relays).toContain("wss://cached3.com/");
      // Should be limited to top 3 cached relays
      expect(
        relays.filter((r: string) => r.startsWith("wss://cached")).length,
      ).toBeLessThanOrEqual(3);
    });
  });

  describe("comprehensive context with NostrEvent", () => {
    it("should extract and use seen-at relays", () => {
      const event = createEventWithSeenRelays([
        "wss://seen1.com/",
        "wss://seen2.com/",
      ]);

      const result = eventLoader({ id: "parent123" }, event);

      const relays = (result as any)._testPointer.relays;
      expect(relays).toContain("wss://seen1.com/");
      expect(relays).toContain("wss://seen2.com/");
    });

    it("should extract and use r tags", () => {
      const event = createEventWithTags([
        ["r", "wss://r-tag1.com/"],
        ["r", "wss://r-tag2.com/"],
        ["r", "wss://r-tag3.com/"],
      ]);

      const result = eventLoader({ id: "parent123" }, event);

      const relays = (result as any)._testPointer.relays;
      expect(relays).toContain("wss://r-tag1.com/");
      expect(relays).toContain("wss://r-tag2.com/");
      expect(relays).toContain("wss://r-tag3.com/");
    });

    it("should extract relay hints from e tags", () => {
      // Use valid 64-char hex event IDs (v5 validates event ID format)
      const validEventId1 =
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const validEventId2 =
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const validEventId3 =
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

      const event = createEventWithTags([
        ["e", validEventId1, "wss://e-tag1.com/", "reply"],
        ["e", validEventId2, "wss://e-tag2.com/", "root"],
        ["e", validEventId3], // No relay hint, should be skipped
      ]);

      const result = eventLoader({ id: "parent123" }, event);

      const relays = (result as any)._testPointer.relays;
      expect(relays).toContain("wss://e-tag1.com/");
      expect(relays).toContain("wss://e-tag2.com/");
    });

    it("should extract author hint from p tags", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://author-outbox.com/",
      ]);

      const event = createEventWithTags([
        ["p", "mentioned-author-pubkey"],
        ["p", "second-author"], // Should use first p tag
      ]);

      const result = eventLoader({ id: "parent123" }, event);

      expect(relayListCache.getOutboxRelaysSync).toHaveBeenCalledWith(
        "mentioned-author-pubkey",
      );
      const relays = (result as any)._testPointer.relays;
      expect(relays).toContain("wss://author-outbox.com/");
    });

    it("should combine all relay sources", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://cached.com/",
      ]);

      // Use valid 64-char hex event ID (v5 validates event ID format)
      const validEventId =
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

      const event = createMockEvent({
        tags: [
          ["p", "author-pubkey"],
          ["r", "wss://r-tag.com/"],
          ["e", validEventId, "wss://e-tag.com/"],
        ],
      });

      // Add seen relays
      (event as any)[SeenRelaysSymbol] = new Set(["wss://seen.com/"]);

      const pointer: EventPointer = {
        id: "parent123",
        relays: ["wss://direct.com/"],
      };

      const result = eventLoader(pointer, event);

      const relays = (result as any)._testPointer.relays;

      // Verify all sources are present
      expect(relays).toContain("wss://direct.com/");
      expect(relays).toContain("wss://seen.com/");
      expect(relays).toContain("wss://cached.com/");
      expect(relays).toContain("wss://r-tag.com/");
      expect(relays).toContain("wss://e-tag.com/");
      // mergeRelaySets normalizes aggregator relays with trailing slash
      expect(relays).toContain("wss://nos.lol/");
    });
  });

  describe("relay priority ordering", () => {
    it("should prioritize direct hints over seen relays", () => {
      const event = createEventWithSeenRelays(["wss://seen.com/"]);

      const pointer: EventPointer = {
        id: "test123",
        relays: ["wss://direct.com/"],
      };

      const result = eventLoader(pointer, event);
      const relays = (result as any)._testPointer.relays;

      // Direct hints should come before seen relays due to mergeRelaySets priority
      const directIndex = relays.indexOf("wss://direct.com/");
      const seenIndex = relays.indexOf("wss://seen.com/");
      expect(directIndex).toBeLessThan(seenIndex);
    });

    it("should prioritize seen relays over cached relays", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://cached.com/",
      ]);

      const event = createMockEvent({
        tags: [["p", "author-pubkey"]],
      });
      (event as any)[SeenRelaysSymbol] = new Set(["wss://seen.com/"]);

      const result = eventLoader({ id: "test123" }, event);
      const relays = (result as any)._testPointer.relays;

      const seenIndex = relays.indexOf("wss://seen.com/");
      const cachedIndex = relays.indexOf("wss://cached.com/");
      expect(seenIndex).toBeLessThan(cachedIndex);
    });
  });

  describe("deduplication", () => {
    it("should deduplicate same relay from different sources", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://duplicate.com/",
      ]);

      const event = createMockEvent({
        tags: [
          ["p", "author-pubkey"],
          ["r", "wss://duplicate.com/"],
        ],
      });
      (event as any)[SeenRelaysSymbol] = new Set(["wss://duplicate.com/"]);

      const pointer: EventPointer = {
        id: "test123",
        relays: ["wss://duplicate.com/"],
      };

      const result = eventLoader(pointer, event);
      const relays = (result as any)._testPointer.relays;

      // Should only appear once despite being in 4 sources
      const count = relays.filter(
        (r: string) => r === "wss://duplicate.com/",
      ).length;
      expect(count).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle event with no tags", () => {
      const event = createMockEvent({ tags: [] });

      const result = eventLoader({ id: "test123" }, event);

      expect(result).toBeDefined();
      // mergeRelaySets normalizes aggregator relays with trailing slash
      expect((result as any)._testPointer.relays).toContain("wss://nos.lol/");
    });

    it("should handle invalid e tags gracefully", () => {
      // Use valid 64-char hex event ID (v5 validates event ID format)
      const validEventId =
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

      const event = createEventWithTags([
        ["e"], // Missing event ID - invalid, should be skipped
        ["e", validEventId, "wss://valid.com/"],
      ]);

      const result = eventLoader({ id: "test123" }, event);

      // Should still include the valid relay
      expect((result as any)._testPointer.relays).toContain("wss://valid.com/");
    });

    it("should handle empty r tags", () => {
      const event = createEventWithTags([
        ["r", ""], // Empty URL
        ["r", "wss://valid.com/"],
      ]);

      const result = eventLoader({ id: "test123" }, event);

      // Should filter out empty r tag
      expect((result as any)._testPointer.relays).toContain("wss://valid.com/");
    });

    it("should use existing event author when event is in store", () => {
      const existingEvent = createMockEvent({ pubkey: "existing-author" });
      vi.mocked(eventStore.getEvent).mockReturnValue(existingEvent);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://existing-author-relay.com/",
      ]);

      const result = eventLoader({ id: "test123" });

      expect(eventStore.getEvent).toHaveBeenCalledWith("test123");
      expect(relayListCache.getOutboxRelaysSync).toHaveBeenCalledWith(
        "existing-author",
      );
      expect((result as any)._testPointer.relays).toContain(
        "wss://existing-author-relay.com/",
      );
    });

    it("should fall back to aggregators when no other relays available", () => {
      vi.mocked(eventStore.getEvent).mockReturnValue(undefined);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([]);

      const event = createMockEvent({ tags: [] });

      const result = eventLoader({ id: "test123" }, event);

      const relays = (result as any)._testPointer.relays;

      // Should only have aggregator relays (normalized with trailing slash)
      expect(relays).toContain("wss://nos.lol/");
      expect(relays).toContain("wss://relay.snort.social/");
      expect(relays).toContain("wss://relay.primal.net/");
      expect(relays).toContain("wss://relay.damus.io/");
    });

    it("should limit cached relays to 3", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://cached1.com/",
        "wss://cached2.com/",
        "wss://cached3.com/",
        "wss://cached4.com/",
        "wss://cached5.com/",
      ]);

      const event = createMockEvent({
        tags: [["p", "author-pubkey"]],
      });

      const result = eventLoader({ id: "test123" }, event);
      const relays = (result as any)._testPointer.relays;

      // Count how many cached relays made it through
      const cachedCount = relays.filter((r: string) =>
        r.startsWith("wss://cached"),
      ).length;

      // Should be exactly 3 (top 3 cached relays)
      expect(cachedCount).toBe(3);
    });
  });

  describe("event with no seen relays (standard NostrEvent)", () => {
    it("should handle event without SeenRelaysSymbol", () => {
      const event = createMockEvent({
        tags: [
          ["p", "author-pubkey"],
          ["r", "wss://r-tag.com/"],
        ],
      });
      // No SeenRelaysSymbol added

      const result = eventLoader({ id: "test123" }, event);

      expect(result).toBeDefined();
      // Should still work with r tags and p tags
      expect((result as any)._testPointer.relays).toContain("wss://r-tag.com/");
    });
  });
});
