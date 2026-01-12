import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { Nip53Adapter } from "./nip-53-adapter";

describe("Nip53Adapter", () => {
  const adapter = new Nip53Adapter();

  describe("parseIdentifier", () => {
    it("should parse kind 30311 naddr (live activity)", () => {
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "my-live-stream",
        relays: ["wss://relay.example.com"],
      });

      const result = adapter.parseIdentifier(naddr);
      expect(result).toEqual({
        type: "live-activity",
        value: {
          kind: 30311,
          pubkey:
            "0000000000000000000000000000000000000000000000000000000000000001",
          identifier: "my-live-stream",
        },
        relays: ["wss://relay.example.com"],
      });
    });

    it("should handle naddr with multiple relays", () => {
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "podcast-episode",
        relays: [
          "wss://relay1.example.com",
          "wss://relay2.example.com",
          "wss://relay3.example.com",
        ],
      });

      const result = adapter.parseIdentifier(naddr);
      expect(result).toEqual({
        type: "live-activity",
        value: {
          kind: 30311,
          pubkey:
            "0000000000000000000000000000000000000000000000000000000000000001",
          identifier: "podcast-episode",
        },
        relays: [
          "wss://relay1.example.com",
          "wss://relay2.example.com",
          "wss://relay3.example.com",
        ],
      });
    });

    it("should handle naddr without relay hints", () => {
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "stream-id",
        relays: [],
      });

      const result = adapter.parseIdentifier(naddr);
      expect(result).toEqual({
        type: "live-activity",
        value: {
          kind: 30311,
          pubkey:
            "0000000000000000000000000000000000000000000000000000000000000001",
          identifier: "stream-id",
        },
        relays: [],
      });
    });

    it("should return null for non-30311 kind naddr", () => {
      // kind 39000 (NIP-29 group) should not work for NIP-53
      const naddr = nip19.naddrEncode({
        kind: 39000,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "some-group",
        relays: ["wss://relay.example.com"],
      });

      expect(adapter.parseIdentifier(naddr)).toBeNull();
    });

    it("should return null for other naddr kinds", () => {
      // kind 30023 (long-form article) should not work
      const naddr = nip19.naddrEncode({
        kind: 30023,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "article-slug",
        relays: ["wss://relay.example.com"],
      });

      expect(adapter.parseIdentifier(naddr)).toBeNull();
    });

    it("should return null for malformed naddr", () => {
      expect(adapter.parseIdentifier("naddr1invaliddata")).toBeNull();
    });

    it("should return null for non-naddr formats", () => {
      // These should not match NIP-53 format
      expect(adapter.parseIdentifier("")).toBeNull();
      expect(adapter.parseIdentifier("npub1...")).toBeNull();
      expect(adapter.parseIdentifier("note1...")).toBeNull();
      expect(adapter.parseIdentifier("nevent1...")).toBeNull();
      expect(adapter.parseIdentifier("relay.example.com'group")).toBeNull();
      expect(adapter.parseIdentifier("alice@example.com")).toBeNull();
    });

    it("should return null for random strings", () => {
      expect(adapter.parseIdentifier("just-a-string")).toBeNull();
      expect(adapter.parseIdentifier("naddr")).toBeNull();
      expect(adapter.parseIdentifier("naddr1")).toBeNull();
    });
  });

  describe("protocol properties", () => {
    it("should have correct protocol and type", () => {
      expect(adapter.protocol).toBe("nip-53");
      expect(adapter.type).toBe("live-chat");
    });
  });

  describe("getCapabilities", () => {
    it("should return correct capabilities", () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities.supportsEncryption).toBe(false);
      expect(capabilities.supportsThreading).toBe(true);
      expect(capabilities.supportsModeration).toBe(false);
      expect(capabilities.supportsRoles).toBe(true);
      expect(capabilities.supportsGroupManagement).toBe(false);
      expect(capabilities.canCreateConversations).toBe(false);
      expect(capabilities.requiresRelay).toBe(false);
    });
  });
});
