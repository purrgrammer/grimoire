import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { selectZapRelays, getZapRelays } from "./zap-relay-selection";

// Mock the relay list cache
vi.mock("@/services/relay-list-cache", () => ({
  relayListCache: {
    getInboxRelays: vi.fn(),
  },
}));

// Mock the loaders for AGGREGATOR_RELAYS
vi.mock("@/services/loaders", () => ({
  AGGREGATOR_RELAYS: [
    "wss://nos.lol/",
    "wss://relay.snort.social/",
    "wss://relay.primal.net/",
    "wss://relay.damus.io/",
  ],
}));

import { relayListCache } from "@/services/relay-list-cache";

describe("selectZapRelays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("explicit relays", () => {
    it("should use explicit relays when provided", async () => {
      const explicitRelays = ["wss://explicit1.com", "wss://explicit2.com"];

      const result = await selectZapRelays({
        recipientPubkey: "recipient123",
        senderPubkey: "sender456",
        explicitRelays,
      });

      expect(result.relays).toEqual(explicitRelays);
      expect(result.sources.recipientInbox).toEqual([]);
      expect(result.sources.senderInbox).toEqual([]);
      expect(result.sources.fallback).toEqual([]);
      // Should not call cache when explicit relays provided
      expect(relayListCache.getInboxRelays).not.toHaveBeenCalled();
    });

    it("should limit explicit relays to 10", async () => {
      const explicitRelays = Array.from(
        { length: 15 },
        (_, i) => `wss://relay${i}.com`,
      );

      const result = await selectZapRelays({
        recipientPubkey: "recipient123",
        explicitRelays,
      });

      expect(result.relays.length).toBe(10);
    });
  });

  describe("recipient inbox priority", () => {
    it("should prioritize recipient's inbox relays", async () => {
      const recipientRelays = [
        "wss://recipient1.com",
        "wss://recipient2.com",
        "wss://recipient3.com",
      ];
      const senderRelays = [
        "wss://sender1.com",
        "wss://sender2.com",
        "wss://sender3.com",
      ];

      vi.mocked(relayListCache.getInboxRelays).mockImplementation(
        async (pubkey) => {
          if (pubkey === "recipient123") return recipientRelays;
          if (pubkey === "sender456") return senderRelays;
          return null;
        },
      );

      const result = await selectZapRelays({
        recipientPubkey: "recipient123",
        senderPubkey: "sender456",
      });

      // Recipient relays should come first
      expect(result.relays.slice(0, 3)).toEqual(recipientRelays);
      expect(result.sources.recipientInbox).toEqual(recipientRelays);
      expect(result.sources.senderInbox).toEqual(senderRelays);
    });

    it("should use only recipient relays when sender is anonymous", async () => {
      const recipientRelays = ["wss://recipient1.com", "wss://recipient2.com"];

      vi.mocked(relayListCache.getInboxRelays).mockResolvedValue(
        recipientRelays,
      );

      const result = await selectZapRelays({
        recipientPubkey: "recipient123",
        // No senderPubkey - anonymous zap
      });

      expect(result.relays).toEqual(recipientRelays);
      expect(result.sources.recipientInbox).toEqual(recipientRelays);
      expect(result.sources.senderInbox).toEqual([]);
    });
  });

  describe("relay deduplication", () => {
    it("should deduplicate relays shared by recipient and sender", async () => {
      const sharedRelay = "wss://shared.com";
      const recipientRelays = [sharedRelay, "wss://recipient-only.com"];
      const senderRelays = [sharedRelay, "wss://sender-only.com"];

      vi.mocked(relayListCache.getInboxRelays).mockImplementation(
        async (pubkey) => {
          if (pubkey === "recipient123") return recipientRelays;
          if (pubkey === "sender456") return senderRelays;
          return null;
        },
      );

      const result = await selectZapRelays({
        recipientPubkey: "recipient123",
        senderPubkey: "sender456",
      });

      // Count occurrences of shared relay
      const sharedCount = result.relays.filter((r) => r === sharedRelay).length;
      expect(sharedCount).toBe(1);

      // Should have all unique relays
      expect(result.relays).toContain(sharedRelay);
      expect(result.relays).toContain("wss://recipient-only.com");
      expect(result.relays).toContain("wss://sender-only.com");
    });
  });

  describe("fallback relays", () => {
    it("should use fallback relays when neither party has preferences", async () => {
      vi.mocked(relayListCache.getInboxRelays).mockResolvedValue(null);

      const result = await selectZapRelays({
        recipientPubkey: "recipient123",
        senderPubkey: "sender456",
      });

      expect(result.relays.length).toBeGreaterThan(0);
      expect(result.sources.fallback.length).toBeGreaterThan(0);
      expect(result.relays).toContain("wss://relay.damus.io/");
    });

    it("should use fallback when recipient has empty relay list", async () => {
      vi.mocked(relayListCache.getInboxRelays).mockResolvedValue([]);

      const result = await selectZapRelays({
        recipientPubkey: "recipient123",
      });

      expect(result.relays.length).toBeGreaterThan(0);
      expect(result.sources.fallback.length).toBeGreaterThan(0);
    });
  });

  describe("relay limits", () => {
    it("should limit total relays to 10", async () => {
      const recipientRelays = Array.from(
        { length: 8 },
        (_, i) => `wss://recipient${i}.com`,
      );
      const senderRelays = Array.from(
        { length: 8 },
        (_, i) => `wss://sender${i}.com`,
      );

      vi.mocked(relayListCache.getInboxRelays).mockImplementation(
        async (pubkey) => {
          if (pubkey === "recipient123") return recipientRelays;
          if (pubkey === "sender456") return senderRelays;
          return null;
        },
      );

      const result = await selectZapRelays({
        recipientPubkey: "recipient123",
        senderPubkey: "sender456",
      });

      expect(result.relays.length).toBeLessThanOrEqual(10);
    });

    it("should ensure minimum relays per party when possible", async () => {
      const recipientRelays = [
        "wss://r1.com",
        "wss://r2.com",
        "wss://r3.com",
        "wss://r4.com",
        "wss://r5.com",
      ];
      const senderRelays = [
        "wss://s1.com",
        "wss://s2.com",
        "wss://s3.com",
        "wss://s4.com",
        "wss://s5.com",
      ];

      vi.mocked(relayListCache.getInboxRelays).mockImplementation(
        async (pubkey) => {
          if (pubkey === "recipient123") return recipientRelays;
          if (pubkey === "sender456") return senderRelays;
          return null;
        },
      );

      const result = await selectZapRelays({
        recipientPubkey: "recipient123",
        senderPubkey: "sender456",
      });

      // Should have at least 3 recipient relays (MIN_RELAYS_PER_PARTY)
      const recipientCount = result.relays.filter((r) =>
        r.startsWith("wss://r"),
      ).length;
      expect(recipientCount).toBeGreaterThanOrEqual(3);

      // Should have at least 3 sender relays
      const senderCount = result.relays.filter((r) =>
        r.startsWith("wss://s"),
      ).length;
      expect(senderCount).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("getZapRelays", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return just the relay URLs", async () => {
    const recipientRelays = ["wss://recipient1.com", "wss://recipient2.com"];

    vi.mocked(relayListCache.getInboxRelays).mockResolvedValue(recipientRelays);

    const relays = await getZapRelays("recipient123", "sender456");

    expect(Array.isArray(relays)).toBe(true);
    expect(relays).toEqual(recipientRelays);
  });

  it("should work without sender pubkey (anonymous)", async () => {
    const recipientRelays = ["wss://recipient1.com"];

    vi.mocked(relayListCache.getInboxRelays).mockResolvedValue(recipientRelays);

    const relays = await getZapRelays("recipient123");

    expect(relays).toEqual(recipientRelays);
  });
});
