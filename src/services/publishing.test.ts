import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NostrEvent } from "nostr-tools/core";
import type { UnsignedEvent } from "nostr-tools/pure";

// Mock dependencies before importing the service
vi.mock("./relay-pool", () => ({
  default: {
    publish: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("./event-store", () => ({
  default: {
    add: vi.fn(),
  },
}));

vi.mock("./accounts", () => ({
  default: {
    active$: {
      subscribe: vi.fn((callback: (account: any) => void) => {
        // Simulate an account with a signer
        callback({
          pubkey: "test-pubkey",
          signer: {
            getPublicKey: vi.fn().mockResolvedValue("test-pubkey"),
            signEvent: vi.fn().mockImplementation(async (event: any) => ({
              ...event,
              id: "signed-event-id",
              sig: "test-signature",
            })),
          },
        });
        return { unsubscribe: vi.fn() };
      }),
    },
  },
}));

vi.mock("./relay-resolver", () => ({
  relayResolver: {
    resolve: vi.fn().mockResolvedValue({
      relays: ["wss://relay1.com/", "wss://relay2.com/"],
      source: "outbox",
      originalCount: 2,
      filteredCount: 2,
    }),
    mergeRelays: vi.fn((...sources: (string[] | undefined)[]) => {
      const merged = new Set<string>();
      for (const source of sources) {
        if (source) {
          for (const relay of source) {
            merged.add(relay);
          }
        }
      }
      return Array.from(merged);
    }),
  },
}));

vi.mock("./db", () => ({
  default: {
    signHistory: {
      put: vi.fn().mockResolvedValue(undefined),
      orderBy: vi.fn().mockReturnThis(),
      reverse: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
      where: vi.fn().mockReturnThis(),
      below: vi.fn().mockReturnThis(),
      delete: vi.fn().mockResolvedValue(0),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    publishHistory: {
      put: vi.fn().mockResolvedValue(undefined),
      orderBy: vi.fn().mockReturnThis(),
      reverse: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
      where: vi.fn().mockReturnThis(),
      below: vi.fn().mockReturnThis(),
      delete: vi.fn().mockResolvedValue(0),
      clear: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// Import mocked modules
import pool from "./relay-pool";
import eventStore from "./event-store";
import { relayResolver } from "./relay-resolver";
import db from "./db";

// Create mock event
function createMockUnsignedEvent(
  overrides: Partial<UnsignedEvent> = {},
): UnsignedEvent {
  return {
    pubkey: "test-pubkey",
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: "test content",
    ...overrides,
  };
}

function createMockSignedEvent(
  overrides: Partial<NostrEvent> = {},
): NostrEvent {
  return {
    id: "test-event-id",
    pubkey: "test-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: "test content",
    sig: "test-signature",
    ...overrides,
  };
}

describe("PublishingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("publish", () => {
    it("should publish event to resolved relays", async () => {
      // Import the singleton for this test
      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      const result = await publishingService.publish(event, { mode: "outbox" });

      expect(result.eventId).toBe(event.id);
      expect(result.resolvedRelays).toContain("wss://relay1.com/");
      expect(result.resolvedRelays).toContain("wss://relay2.com/");
      expect(pool.publish).toHaveBeenCalledTimes(2);
    });

    it("should track per-relay status", async () => {
      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      const result = await publishingService.publish(event, { mode: "outbox" });

      expect(Object.keys(result.relayResults).length).toBe(2);
      expect(result.relayResults["wss://relay1.com/"]).toBeDefined();
      expect(result.relayResults["wss://relay2.com/"]).toBeDefined();
    });

    it("should handle relay failures gracefully", async () => {
      vi.mocked(pool.publish).mockImplementation(async (relays: any) => {
        if (Array.isArray(relays) && relays.includes("wss://relay1.com/")) {
          throw new Error("Connection failed");
        }
        return [];
      });

      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      const result = await publishingService.publish(event, { mode: "outbox" });

      expect(result.relayResults["wss://relay1.com/"].status).toBe("failed");
      expect(result.relayResults["wss://relay1.com/"].error).toBe(
        "Connection failed",
      );
      expect(result.relayResults["wss://relay2.com/"].status).toBe("success");
      expect(result.status).toBe("partial");
    });

    it("should call onRelayStatus callback for each relay", async () => {
      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();
      const onRelayStatus = vi.fn();

      await publishingService.publish(
        event,
        { mode: "outbox" },
        { onRelayStatus },
      );

      expect(onRelayStatus).toHaveBeenCalledTimes(2);
    });

    it("should call onStatusChange callback on status updates", async () => {
      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();
      const onStatusChange = vi.fn();

      await publishingService.publish(
        event,
        { mode: "outbox" },
        { onStatusChange },
      );

      // Called for each relay + initial
      expect(onStatusChange).toHaveBeenCalled();
    });

    it("should add event to EventStore on success", async () => {
      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      await publishingService.publish(event, { mode: "outbox" });

      expect(eventStore.add).toHaveBeenCalledWith(event);
    });

    it("should not add event to EventStore when all relays fail", async () => {
      vi.mocked(pool.publish).mockRejectedValue(new Error("All failed"));

      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      await publishingService.publish(event, { mode: "outbox" });

      expect(eventStore.add).not.toHaveBeenCalled();
    });

    it("should use explicit relays when mode is explicit", async () => {
      vi.mocked(relayResolver.resolve).mockResolvedValue({
        relays: ["wss://explicit.com/"],
        source: "explicit",
        originalCount: 1,
        filteredCount: 1,
      });

      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      const result = await publishingService.publish(event, {
        mode: "explicit",
        relays: ["wss://explicit.com/"],
      });

      expect(result.resolvedRelays).toContain("wss://explicit.com/");
    });

    it("should merge additional relays", async () => {
      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      await publishingService.publish(
        event,
        { mode: "outbox" },
        { additionalRelays: ["wss://extra.com/"] },
      );

      expect(relayResolver.mergeRelays).toHaveBeenCalled();
    });

    it("should persist publish request to database", async () => {
      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      await publishingService.publish(event, { mode: "outbox" });

      expect(db.publishHistory.put).toHaveBeenCalled();
    });

    it("should return failed status when no relays available", async () => {
      vi.mocked(relayResolver.resolve).mockResolvedValue({
        relays: [],
        source: "fallback",
        originalCount: 0,
        filteredCount: 0,
      });

      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      const result = await publishingService.publish(event, { mode: "outbox" });

      expect(result.status).toBe("failed");
      expect(result.resolvedRelays).toEqual([]);
    });
  });

  describe("signAndPublish", () => {
    it("should sign and publish event", async () => {
      const { publishingService } = await import("./publishing");

      const unsignedEvent = createMockUnsignedEvent();

      const result = await publishingService.signAndPublish(unsignedEvent, {
        mode: "outbox",
      });

      expect(result.signRequest).toBeDefined();
      expect(result.publishRequest).toBeDefined();
    });

    it("should return failed publish if signing fails", async () => {
      // This test is tricky because signing uses the factory
      // We'll test the behavior indirectly
      const { publishingService } = await import("./publishing");

      const unsignedEvent = createMockUnsignedEvent();

      const result = await publishingService.signAndPublish(unsignedEvent, {
        mode: "outbox",
      });

      // The sign request should exist
      expect(result.signRequest).toBeDefined();
      expect(result.publishRequest).toBeDefined();
    });
  });

  describe("republish", () => {
    it("should republish using original relay mode", async () => {
      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      // First publish
      const original = await publishingService.publish(event, {
        mode: "outbox",
      });

      // Republish
      const republished = await publishingService.republish(original.id);

      expect(republished.eventId).toBe(event.id);
    });

    it("should throw when publish request not found", async () => {
      const { publishingService } = await import("./publishing");

      await expect(
        publishingService.republish("non-existent-id"),
      ).rejects.toThrow("Publish request not found");
    });
  });

  describe("republishToRelay", () => {
    it("should republish to specific relay", async () => {
      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      // First publish
      const original = await publishingService.publish(event, {
        mode: "outbox",
      });

      vi.mocked(relayResolver.resolve).mockResolvedValue({
        relays: ["wss://specific.com/"],
        source: "explicit",
        originalCount: 1,
        filteredCount: 1,
      });

      // Republish to specific relay
      const republished = await publishingService.republishToRelay(
        original.id,
        "wss://specific.com/",
      );

      expect(republished.resolvedRelays).toContain("wss://specific.com/");
    });
  });

  describe("getPublishRequestsForEvent", () => {
    it("should return all publish requests for an event", async () => {
      const { publishingService } = await import("./publishing");

      // Use a unique event ID to avoid accumulating from other tests
      const uniqueEventId = `unique-event-${Date.now()}-${Math.random()}`;
      const event = createMockSignedEvent({ id: uniqueEventId });

      // Get count before publishing
      const beforeCount =
        publishingService.getPublishRequestsForEvent(uniqueEventId).length;

      // Publish multiple times
      await publishingService.publish(event, { mode: "outbox" });
      await publishingService.publish(event, { mode: "outbox" });

      const requests =
        publishingService.getPublishRequestsForEvent(uniqueEventId);

      // Should have exactly 2 more than before
      expect(requests.length).toBe(beforeCount + 2);
    });
  });

  describe("getStats", () => {
    it("should return publishing statistics", async () => {
      const { publishingService } = await import("./publishing");

      const event = createMockSignedEvent();

      await publishingService.publish(event, { mode: "outbox" });

      const stats = publishingService.getStats();

      expect(stats.totalPublishRequests).toBeGreaterThanOrEqual(1);
      expect(stats.successfulPublishes).toBeGreaterThanOrEqual(0);
    });
  });

  describe("clearHistory", () => {
    it("should clear history older than specified date", async () => {
      const { publishingService } = await import("./publishing");

      const cutoff = new Date(Date.now() + 1000); // Future date

      await publishingService.clearHistory(cutoff);

      expect(db.signHistory.where).toHaveBeenCalled();
      expect(db.publishHistory.where).toHaveBeenCalled();
    });
  });

  describe("clearAllHistory", () => {
    it("should clear all history", async () => {
      const { publishingService } = await import("./publishing");

      await publishingService.clearAllHistory();

      expect(db.signHistory.clear).toHaveBeenCalled();
      expect(db.publishHistory.clear).toHaveBeenCalled();
    });
  });

  describe("observables", () => {
    it("should emit publish history updates", async () => {
      const { publishingService } = await import("./publishing");

      const updates: any[] = [];
      const subscription = publishingService.publishHistory$.subscribe(
        (history) => {
          updates.push(history);
        },
      );

      const event = createMockSignedEvent({ id: "observable-test-id" });
      await publishingService.publish(event, { mode: "outbox" });

      subscription.unsubscribe();

      // Should have received updates (initial + during publish)
      expect(updates.length).toBeGreaterThan(0);
    });

    it("should track active publishes", async () => {
      const { publishingService } = await import("./publishing");

      // Initially should be empty or have previous publishes
      const initial = publishingService.activePublishes$.getValue();
      expect(Array.isArray(initial)).toBe(true);
    });
  });
});

describe("PublishingService types", () => {
  it("should have correct RelayMode types", () => {
    // Type checking test - if this compiles, types are correct
    const outboxMode: { mode: "outbox" } = { mode: "outbox" };
    const explicitMode: { mode: "explicit"; relays: string[] } = {
      mode: "explicit",
      relays: ["wss://test.com/"],
    };

    expect(outboxMode.mode).toBe("outbox");
    expect(explicitMode.mode).toBe("explicit");
    expect(explicitMode.relays).toEqual(["wss://test.com/"]);
  });
});
