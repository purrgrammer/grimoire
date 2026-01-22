import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { Nip29Adapter } from "./nip-29-adapter";

describe("Nip29Adapter", () => {
  const adapter = new Nip29Adapter();

  describe("parseIdentifier", () => {
    it("should parse group ID with relay domain (no protocol)", () => {
      const result = adapter.parseIdentifier("groups.0xchat.com'chachi");
      expect(result).toEqual({
        type: "group",
        value: "chachi",
        relays: ["wss://groups.0xchat.com"],
      });
    });

    it("should parse group ID with wss:// protocol", () => {
      const result = adapter.parseIdentifier("wss://groups.0xchat.com'chachi");
      expect(result).toEqual({
        type: "group",
        value: "chachi",
        relays: ["wss://groups.0xchat.com"],
      });
    });

    it("should parse group ID with ws:// protocol", () => {
      const result = adapter.parseIdentifier("ws://relay.example.com'test");
      expect(result).toEqual({
        type: "group",
        value: "test",
        relays: ["ws://relay.example.com"],
      });
    });

    it("should parse various group-id formats", () => {
      const result1 = adapter.parseIdentifier("relay.example.com'bitcoin-dev");
      expect(result1?.value).toBe("bitcoin-dev");
      expect(result1?.relays).toEqual(["wss://relay.example.com"]);

      const result2 = adapter.parseIdentifier("nos.lol'welcome");
      expect(result2?.value).toBe("welcome");
      expect(result2?.relays).toEqual(["wss://nos.lol"]);

      const result3 = adapter.parseIdentifier("relay.test.com'my_group_123");
      expect(result3?.value).toBe("my_group_123");
      expect(result3?.relays).toEqual(["wss://relay.test.com"]);
    });

    it("should handle relay URLs with ports", () => {
      const result = adapter.parseIdentifier(
        "relay.example.com:7777'testgroup",
      );
      expect(result).toEqual({
        type: "group",
        value: "testgroup",
        relays: ["wss://relay.example.com:7777"],
      });
    });

    it("should return null for invalid formats", () => {
      expect(adapter.parseIdentifier("")).toBeNull();
      expect(adapter.parseIdentifier("just-a-string")).toBeNull();
      expect(adapter.parseIdentifier("no-apostrophe")).toBeNull();
      expect(adapter.parseIdentifier("'missing-relay")).toBeNull();
      expect(adapter.parseIdentifier("missing-groupid'")).toBeNull();
      expect(adapter.parseIdentifier("multiple'apostrophes'here")).toBeNull();
    });

    it("should return null for non-NIP-29 identifiers", () => {
      // These should not match NIP-29 format
      expect(adapter.parseIdentifier("npub1...")).toBeNull();
      expect(adapter.parseIdentifier("note1...")).toBeNull();
      expect(adapter.parseIdentifier("alice@example.com")).toBeNull();
    });

    it("should parse kind 39000 naddr (group metadata)", () => {
      // Create a valid kind 39000 naddr
      const naddr = nip19.naddrEncode({
        kind: 39000,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "bitcoin-dev",
        relays: ["wss://relay.example.com"],
      });

      const result = adapter.parseIdentifier(naddr);
      expect(result).toEqual({
        type: "group",
        value: "bitcoin-dev",
        relays: ["wss://relay.example.com"],
      });
    });

    it("should handle naddr with multiple relays (uses first)", () => {
      const naddr = nip19.naddrEncode({
        kind: 39000,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "test-group",
        relays: [
          "wss://relay1.example.com",
          "wss://relay2.example.com",
          "wss://relay3.example.com",
        ],
      });

      const result = adapter.parseIdentifier(naddr);
      expect(result).toEqual({
        type: "group",
        value: "test-group",
        relays: ["wss://relay1.example.com"],
      });
    });

    it("should add wss:// prefix to naddr relay if missing", () => {
      const naddr = nip19.naddrEncode({
        kind: 39000,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "test-group",
        relays: ["relay.example.com"], // No protocol prefix
      });

      const result = adapter.parseIdentifier(naddr);
      expect(result).toEqual({
        type: "group",
        value: "test-group",
        relays: ["wss://relay.example.com"],
      });
    });

    it("should return null for non-39000 kind naddr", () => {
      // kind 30311 (live activity) should not work for NIP-29
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "some-event",
        relays: ["wss://relay.example.com"],
      });

      expect(adapter.parseIdentifier(naddr)).toBeNull();
    });

    it("should return null for naddr without relays", () => {
      const naddr = nip19.naddrEncode({
        kind: 39000,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "test-group",
        relays: [], // No relays
      });

      expect(adapter.parseIdentifier(naddr)).toBeNull();
    });

    it("should return null for malformed naddr", () => {
      expect(adapter.parseIdentifier("naddr1invaliddata")).toBeNull();
    });
  });

  describe("protocol properties", () => {
    it("should have correct protocol and type", () => {
      expect(adapter.protocol).toBe("nip-29");
      expect(adapter.type).toBe("group");
    });
  });

  describe("getCapabilities", () => {
    it("should return correct capabilities", () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities.supportsEncryption).toBe(false);
      expect(capabilities.supportsThreading).toBe(true);
      expect(capabilities.supportsModeration).toBe(true);
      expect(capabilities.supportsRoles).toBe(true);
      expect(capabilities.supportsGroupManagement).toBe(true);
      expect(capabilities.canCreateConversations).toBe(false);
      expect(capabilities.requiresRelay).toBe(true);
    });
  });

  describe("profile fallback for pubkey group IDs", () => {
    it("should parse valid pubkey as group ID", () => {
      const validPubkey =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const result = adapter.parseIdentifier(
        `wss://relay.example.com'${validPubkey}`,
      );

      expect(result).toEqual({
        type: "group",
        value: validPubkey,
        relays: ["wss://relay.example.com"],
      });
    });

    it("should parse uppercase pubkey as group ID", () => {
      const validPubkey =
        "3BF0C63FCB93463407AF97A5E5EE64FA883D107EF9E558472C4EB9AAAEFA459D";
      const result = adapter.parseIdentifier(
        `wss://relay.example.com'${validPubkey}`,
      );

      expect(result).toEqual({
        type: "group",
        value: validPubkey,
        relays: ["wss://relay.example.com"],
      });
    });

    it("should parse mixed case pubkey as group ID", () => {
      const validPubkey =
        "3bF0c63Fcb93463407aF97a5e5Ee64fA883d107eF9e558472c4eB9aaaEfa459D";
      const result = adapter.parseIdentifier(
        `wss://relay.example.com'${validPubkey}`,
      );

      expect(result).toEqual({
        type: "group",
        value: validPubkey,
        relays: ["wss://relay.example.com"],
      });
    });

    it("should not treat short hex strings as valid pubkeys", () => {
      // Less than 64 characters should be treated as normal group IDs
      const shortHex = "3bf0c63f";
      const result = adapter.parseIdentifier(
        `wss://relay.example.com'${shortHex}`,
      );

      expect(result).toEqual({
        type: "group",
        value: shortHex,
        relays: ["wss://relay.example.com"],
      });
    });

    it("should not treat non-hex strings as valid pubkeys", () => {
      // 64 characters but contains non-hex characters
      const nonHex =
        "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
      const result = adapter.parseIdentifier(
        `wss://relay.example.com'${nonHex}`,
      );

      expect(result).toEqual({
        type: "group",
        value: nonHex,
        relays: ["wss://relay.example.com"],
      });
    });
  });
});
