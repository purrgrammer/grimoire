import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { Nip22Adapter } from "./nip-22-adapter";

describe("Nip22Adapter", () => {
  const adapter = new Nip22Adapter();

  describe("parseIdentifier", () => {
    it("should parse note1 format (simple event ID)", () => {
      const eventId =
        "0000000000000000000000000000000000000000000000000000000000000001";
      const note = nip19.noteEncode(eventId);

      const result = adapter.parseIdentifier(note);
      expect(result).toEqual({
        type: "thread",
        value: { id: eventId },
        relays: [],
      });
    });

    it("should parse nevent format with relay hints", () => {
      const nevent = nip19.neventEncode({
        id: "0000000000000000000000000000000000000000000000000000000000000001",
        relays: ["wss://relay.example.com"],
      });

      const result = adapter.parseIdentifier(nevent);
      expect(result).toEqual({
        type: "thread",
        value: {
          id: "0000000000000000000000000000000000000000000000000000000000000001",
          relays: ["wss://relay.example.com"],
          author: undefined,
          kind: undefined,
        },
        relays: ["wss://relay.example.com"],
      });
    });

    it("should parse nevent with author and kind hints", () => {
      const nevent = nip19.neventEncode({
        id: "0000000000000000000000000000000000000000000000000000000000000001",
        relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
        author:
          "0000000000000000000000000000000000000000000000000000000000000002",
        kind: 30023,
      });

      const result = adapter.parseIdentifier(nevent);
      expect(result).toEqual({
        type: "thread",
        value: {
          id: "0000000000000000000000000000000000000000000000000000000000000001",
          relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
          author:
            "0000000000000000000000000000000000000000000000000000000000000002",
          kind: 30023,
        },
        relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
      });
    });

    it("should parse naddr format (addressable events)", () => {
      const naddr = nip19.naddrEncode({
        kind: 30023,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "my-article",
        relays: ["wss://relay.example.com"],
      });

      const result = adapter.parseIdentifier(naddr);
      expect(result).toEqual({
        type: "thread",
        value: {
          id: "30023:0000000000000000000000000000000000000000000000000000000000000001:my-article",
          relays: ["wss://relay.example.com"],
          author:
            "0000000000000000000000000000000000000000000000000000000000000001",
          kind: 30023,
        },
        relays: ["wss://relay.example.com"],
      });
    });

    it("should parse naddr with empty identifier", () => {
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "",
        relays: ["wss://relay.example.com"],
      });

      const result = adapter.parseIdentifier(naddr);
      expect(result).toEqual({
        type: "thread",
        value: {
          id: "30311:0000000000000000000000000000000000000000000000000000000000000001:",
          relays: ["wss://relay.example.com"],
          author:
            "0000000000000000000000000000000000000000000000000000000000000001",
          kind: 30311,
        },
        relays: ["wss://relay.example.com"],
      });
    });

    it("should accept any event kind (catch-all)", () => {
      // Kind 6 (repost)
      const nevent1 = nip19.neventEncode({
        id: "0000000000000000000000000000000000000000000000000000000000000001",
        kind: 6,
      });
      expect(adapter.parseIdentifier(nevent1)).not.toBeNull();

      // Kind 30023 (long-form article)
      const nevent2 = nip19.neventEncode({
        id: "0000000000000000000000000000000000000000000000000000000000000002",
        kind: 30023,
      });
      expect(adapter.parseIdentifier(nevent2)).not.toBeNull();

      // Kind 1063 (file metadata)
      const nevent3 = nip19.neventEncode({
        id: "0000000000000000000000000000000000000000000000000000000000000003",
        kind: 1063,
      });
      expect(adapter.parseIdentifier(nevent3)).not.toBeNull();
    });

    it("should return null for invalid formats", () => {
      expect(adapter.parseIdentifier("")).toBeNull();
      expect(adapter.parseIdentifier("just-a-string")).toBeNull();
      expect(adapter.parseIdentifier("invalid1xyz")).toBeNull();
    });

    it("should return null for npub (not an event)", () => {
      const npub = nip19.npubEncode(
        "0000000000000000000000000000000000000000000000000000000000000001",
      );
      expect(adapter.parseIdentifier(npub)).toBeNull();
    });

    it("should handle malformed nevent gracefully", () => {
      expect(adapter.parseIdentifier("nevent1xyz")).toBeNull();
    });

    it("should handle malformed naddr gracefully", () => {
      expect(adapter.parseIdentifier("naddr1xyz")).toBeNull();
    });

    it("should handle malformed note gracefully", () => {
      expect(adapter.parseIdentifier("note1xyz")).toBeNull();
    });
  });

  describe("protocol and type", () => {
    it("should have correct protocol identifier", () => {
      expect(adapter.protocol).toBe("nip-22");
    });

    it("should have correct conversation type", () => {
      expect(adapter.type).toBe("group");
    });
  });

  describe("capabilities", () => {
    it("should return correct capabilities", () => {
      const caps = adapter.getCapabilities();
      expect(caps).toEqual({
        supportsEncryption: false,
        supportsThreading: true,
        supportsModeration: false,
        supportsRoles: false,
        supportsGroupManagement: false,
        canCreateConversations: false,
        requiresRelay: false,
      });
    });
  });
});
