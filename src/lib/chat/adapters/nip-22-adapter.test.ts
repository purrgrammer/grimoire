import { describe, it, expect } from "vitest";
import { Nip22Adapter } from "./nip-22-adapter";
import { nip19 } from "nostr-tools";

describe("Nip22Adapter", () => {
  const adapter = new Nip22Adapter();

  describe("parseIdentifier", () => {
    it("should parse note1 identifier (simple event ID)", () => {
      const eventId =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const note = nip19.noteEncode(eventId);

      const result = adapter.parseIdentifier(note);

      expect(result).toBeTruthy();
      expect(result?.type).toBe("comment-thread");
      if (result && result.type === "comment-thread") {
        expect(result.value.id).toBe(eventId);
      }
    });

    it("should parse nevent1 identifier with relay hints", () => {
      const eventId =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const relays = ["wss://relay.example.com", "wss://nos.lol"];
      const nevent = nip19.neventEncode({
        id: eventId,
        relays,
        kind: 30023, // Article
      });

      const result = adapter.parseIdentifier(nevent);

      expect(result).toBeTruthy();
      expect(result?.type).toBe("comment-thread");
      if (result && result.type === "comment-thread") {
        expect(result.value.id).toBe(eventId);
        expect(result.value.kind).toBe(30023);
        expect(result.relays).toEqual(relays);
      }
    });

    it("should parse naddr1 identifier for addressable events", () => {
      const pubkey =
        "7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194";
      const identifier = "grimoire";
      const relays = ["wss://relay.example.com"];
      const naddr = nip19.naddrEncode({
        kind: 30023,
        pubkey,
        identifier,
        relays,
      });

      const result = adapter.parseIdentifier(naddr);

      expect(result).toBeTruthy();
      expect(result?.type).toBe("comment-thread");
      if (result && result.type === "comment-thread") {
        expect(result.value.kind).toBe(30023);
        expect(result.value.pubkey).toBe(pubkey);
        expect(result.value.identifier).toBe(identifier);
        expect(result.relays).toEqual(relays);
      }
    });

    it("should reject kind 1 nevent (handled by NIP-10 adapter)", () => {
      const eventId =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const nevent = nip19.neventEncode({
        id: eventId,
        kind: 1, // Kind 1 should be handled by NIP-10
      });

      const result = adapter.parseIdentifier(nevent);

      expect(result).toBeNull();
    });

    it("should return null for invalid formats", () => {
      expect(adapter.parseIdentifier("invalid")).toBeNull();
      expect(adapter.parseIdentifier("npub1...")).toBeNull();
      expect(adapter.parseIdentifier("")).toBeNull();
    });

    it("should reject naddr with kind outside addressable range", () => {
      const pubkey =
        "7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194";
      const naddr = nip19.naddrEncode({
        kind: 1000, // Not in addressable range (30000-39999)
        pubkey,
        identifier: "test",
      });

      const result = adapter.parseIdentifier(naddr);

      expect(result).toBeNull();
    });
  });

  describe("protocol and type", () => {
    it("should have protocol 'nip-22'", () => {
      expect(adapter.protocol).toBe("nip-22");
    });

    it("should have type 'channel' (public comments)", () => {
      expect(adapter.type).toBe("channel");
    });
  });

  describe("getCapabilities", () => {
    it("should return correct capabilities", () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities.supportsThreading).toBe(true);
      expect(capabilities.supportsReactions).toBe(true);
      expect(capabilities.supportsZaps).toBe(true);
      expect(capabilities.supportsEncryption).toBe(false);
      expect(capabilities.supportsModeration).toBe(false);
      expect(capabilities.supportsRoles).toBe(true);
      expect(capabilities.supportsGroupManagement).toBe(false);
      expect(capabilities.requiresRelay).toBe(false);
    });
  });

  describe("getZapConfig", () => {
    it("should return zap config for a message", () => {
      const message = {
        id: "comment123",
        conversationId: "nip-22:root123",
        author:
          "7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194",
        content: "Great article!",
        timestamp: 1234567890,
        protocol: "nip-22" as const,
        event: {} as any,
      };

      const conversation = {
        id: "nip-22:root123",
        type: "channel" as const,
        protocol: "nip-22" as const,
        title: "Test Article",
        participants: [],
        unreadCount: 0,
        metadata: {
          relays: ["wss://relay.example.com"],
        },
      };

      const zapConfig = adapter.getZapConfig(message, conversation);

      expect(zapConfig.supported).toBe(true);
      expect(zapConfig.recipientPubkey).toBe(message.author);
      expect(zapConfig.eventPointer?.id).toBe(message.id);
      expect(zapConfig.eventPointer?.author).toBe(message.author);
      expect(zapConfig.eventPointer?.relays).toEqual(
        conversation.metadata.relays,
      );
    });
  });
});
