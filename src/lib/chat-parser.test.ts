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

    it("should throw error for npub (NIP-C7 disabled)", () => {
      expect(() => parseChatCommand(["npub1xyz"])).toThrow(
        /Unable to determine chat protocol/,
      );
    });

    it("should throw error for note/nevent (NIP-28 not implemented)", () => {
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
});
