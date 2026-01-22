import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { parseChatCommand } from "./chat-parser";

describe("parseChatCommand", () => {
  describe("NIP-29 relay groups", () => {
    it("should parse NIP-29 group ID without protocol (single arg)", () => {
      const result = parseChatCommand(["groups.0xchat.com'chachi"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier).toEqual({
        type: "group",
        value: "chachi",
        relays: ["wss://groups.0xchat.com"],
      });
      expect(result.adapter.protocol).toBe("nip-29");
    });

    it("should parse NIP-29 group ID when split by shell-quote", () => {
      // shell-quote splits on ' so "groups.0xchat.com'chachi" becomes ["groups.0xchat.com", "chachi"]
      const result = parseChatCommand(["groups.0xchat.com", "chachi"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier).toEqual({
        type: "group",
        value: "chachi",
        relays: ["wss://groups.0xchat.com"],
      });
      expect(result.adapter.protocol).toBe("nip-29");
    });

    it("should parse NIP-29 group ID with wss:// protocol (single arg)", () => {
      const result = parseChatCommand(["wss://groups.0xchat.com'chachi"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier).toEqual({
        type: "group",
        value: "chachi",
        relays: ["wss://groups.0xchat.com"],
      });
    });

    it("should parse NIP-29 group ID with wss:// when split by shell-quote", () => {
      const result = parseChatCommand(["wss://groups.0xchat.com", "chachi"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier).toEqual({
        type: "group",
        value: "chachi",
        relays: ["wss://groups.0xchat.com"],
      });
    });

    it("should parse NIP-29 group with different relay and group-id (single arg)", () => {
      const result = parseChatCommand(["relay.example.com'bitcoin-dev"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier.value).toBe("bitcoin-dev");
      expect(result.identifier.relays).toEqual(["wss://relay.example.com"]);
    });

    it("should parse NIP-29 group with different relay when split", () => {
      const result = parseChatCommand(["relay.example.com", "bitcoin-dev"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier.value).toBe("bitcoin-dev");
      expect(result.identifier.relays).toEqual(["wss://relay.example.com"]);
    });

    it("should parse NIP-29 group from nos.lol", () => {
      const result = parseChatCommand(["nos.lol'welcome"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier.value).toBe("welcome");
      expect(result.identifier.relays).toEqual(["wss://nos.lol"]);
    });
  });

  describe("error handling", () => {
    it("should throw error when no identifier provided", () => {
      expect(() => parseChatCommand([])).toThrow(
        "Chat identifier required. Usage: chat <identifier>",
      );
    });

    it("should throw error for unsupported identifier format", () => {
      expect(() => parseChatCommand(["unsupported-format"])).toThrow(
        /Unable to determine chat protocol/,
      );
    });

    it("should throw error for npub (not an event)", () => {
      expect(() => parseChatCommand(["npub1xyz"])).toThrow(
        /Unable to determine chat protocol/,
      );
    });

    it("should throw error for malformed note/nevent", () => {
      expect(() => parseChatCommand(["note1xyz"])).toThrow(
        /Unable to determine chat protocol/,
      );
    });

    it("should throw error for malformed naddr", () => {
      expect(() => parseChatCommand(["naddr1xyz"])).toThrow(
        /Unable to determine chat protocol/,
      );
    });
  });

  describe("NIP-53 live activity chat", () => {
    it("should parse NIP-53 live activity naddr", () => {
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "my-stream",
        relays: ["wss://relay.example.com"],
      });

      const result = parseChatCommand([naddr]);

      expect(result.protocol).toBe("nip-53");
      expect(result.identifier).toEqual({
        type: "live-activity",
        value: {
          kind: 30311,
          pubkey:
            "0000000000000000000000000000000000000000000000000000000000000001",
          identifier: "my-stream",
        },
        relays: ["wss://relay.example.com"],
      });
      expect(result.adapter.protocol).toBe("nip-53");
    });

    it("should parse NIP-53 live activity naddr with multiple relays", () => {
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "podcast-episode-42",
        relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
      });

      const result = parseChatCommand([naddr]);

      expect(result.protocol).toBe("nip-53");
      expect(result.identifier.value).toEqual({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "podcast-episode-42",
      });
      expect(result.identifier.relays).toEqual([
        "wss://relay1.example.com",
        "wss://relay2.example.com",
      ]);
    });

    it("should not parse NIP-29 group naddr as NIP-53", () => {
      const naddr = nip19.naddrEncode({
        kind: 39000,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "test-group",
        relays: ["wss://relay.example.com"],
      });

      // NIP-29 adapter should handle kind 39000
      const result = parseChatCommand([naddr]);

      expect(result.protocol).toBe("nip-29");
    });
  });

  describe("NIP-22 event comments (catch-all)", () => {
    it("should parse note1 format", () => {
      const eventId =
        "0000000000000000000000000000000000000000000000000000000000000001";
      const note = nip19.noteEncode(eventId);

      const result = parseChatCommand([note]);

      // NIP-10 handles kind 1 notes specifically, so note1 goes to NIP-10
      // For NIP-22, we need nevent with non-kind-1 kind
      expect(result.protocol).toBe("nip-10"); // note1 defaults to NIP-10
    });

    it("should parse nevent for non-kind-1 events", () => {
      const nevent = nip19.neventEncode({
        id: "0000000000000000000000000000000000000000000000000000000000000001",
        kind: 30023, // Long-form article
        relays: ["wss://relay.example.com"],
      });

      const result = parseChatCommand([nevent]);

      expect(result.protocol).toBe("nip-22");
      expect(result.identifier.type).toBe("thread");
      expect(result.adapter.protocol).toBe("nip-22");
    });

    it("should parse naddr for non-NIP-29/NIP-53 addressable events", () => {
      const naddr = nip19.naddrEncode({
        kind: 30023, // Long-form article (not 39000 or 30311)
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "my-article",
        relays: ["wss://relay.example.com"],
      });

      const result = parseChatCommand([naddr]);

      expect(result.protocol).toBe("nip-22");
      expect(result.identifier.type).toBe("thread");
      expect(result.adapter.protocol).toBe("nip-22");
    });

    it("should parse nevent without kind (defaults to NIP-10)", () => {
      const nevent = nip19.neventEncode({
        id: "0000000000000000000000000000000000000000000000000000000000000001",
        relays: ["wss://relay.example.com"],
      });

      const result = parseChatCommand([nevent]);

      // Without kind hint, NIP-10 accepts it (assumes kind 1 thread)
      // Only nevents with explicit non-kind-1 kind hint go to NIP-22
      expect(result.protocol).toBe("nip-10");
    });
  });
});
