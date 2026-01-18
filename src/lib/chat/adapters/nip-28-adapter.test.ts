import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { Nip28Adapter } from "./nip-28-adapter";

describe("Nip28Adapter", () => {
  const adapter = new Nip28Adapter();

  describe("parseIdentifier", () => {
    it("should parse note1 format (kind 40 event ID)", () => {
      const eventId =
        "0000000000000000000000000000000000000000000000000000000000000001";
      const note = nip19.noteEncode(eventId);

      const result = adapter.parseIdentifier(note);
      expect(result).toEqual({
        type: "channel",
        value: eventId,
        relays: [],
      });
    });

    it("should parse nevent1 format with relay hints", () => {
      const eventId =
        "0000000000000000000000000000000000000000000000000000000000000001";
      const nevent = nip19.neventEncode({
        id: eventId,
        relays: ["wss://relay.example.com", "wss://nos.lol"],
      });

      const result = adapter.parseIdentifier(nevent);
      expect(result).toEqual({
        type: "channel",
        value: eventId,
        relays: ["wss://relay.example.com", "wss://nos.lol"],
      });
    });

    it("should parse nevent1 format without relay hints", () => {
      const eventId =
        "0000000000000000000000000000000000000000000000000000000000000001";
      const nevent = nip19.neventEncode({
        id: eventId,
      });

      const result = adapter.parseIdentifier(nevent);
      expect(result).toEqual({
        type: "channel",
        value: eventId,
        relays: [],
      });
    });

    it("should return null for kind 41 naddr (not yet supported)", () => {
      const naddr = nip19.naddrEncode({
        kind: 41,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "channel-metadata",
        relays: ["wss://relay.example.com"],
      });

      expect(adapter.parseIdentifier(naddr)).toBeNull();
    });

    it("should return null for non-channel identifiers", () => {
      // NIP-29 group format
      expect(adapter.parseIdentifier("relay.example.com'group-id")).toBeNull();

      // npub (profile)
      const npub = nip19.npubEncode(
        "0000000000000000000000000000000000000000000000000000000000000001",
      );
      expect(adapter.parseIdentifier(npub)).toBeNull();

      // naddr kind 30311 (live activity)
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "live-event",
        relays: ["wss://relay.example.com"],
      });
      expect(adapter.parseIdentifier(naddr)).toBeNull();
    });

    it("should return null for invalid formats", () => {
      expect(adapter.parseIdentifier("")).toBeNull();
      expect(adapter.parseIdentifier("just-a-string")).toBeNull();
      expect(adapter.parseIdentifier("note1invaliddata")).toBeNull();
      expect(adapter.parseIdentifier("nevent1invaliddata")).toBeNull();
    });
  });

  describe("protocol properties", () => {
    it("should have correct protocol and type", () => {
      expect(adapter.protocol).toBe("nip-28");
      expect(adapter.type).toBe("channel");
    });
  });

  describe("getCapabilities", () => {
    it("should return correct capabilities", () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities.supportsEncryption).toBe(false);
      expect(capabilities.supportsThreading).toBe(true);
      expect(capabilities.supportsModeration).toBe(true);
      expect(capabilities.supportsRoles).toBe(false);
      expect(capabilities.supportsGroupManagement).toBe(false);
      expect(capabilities.canCreateConversations).toBe(true);
      expect(capabilities.requiresRelay).toBe(false);
    });
  });
});
