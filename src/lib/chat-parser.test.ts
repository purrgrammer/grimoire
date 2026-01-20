import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { parseChatCommand } from "./chat-parser";

describe("parseChatCommand", () => {
  describe("NIP-29 relay groups", () => {
    it("should parse NIP-29 group ID without protocol (single arg)", async () => {
      const result = await parseChatCommand(["groups.0xchat.com'chachi"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier).toEqual({
        type: "group",
        value: "chachi",
        relays: ["wss://groups.0xchat.com"],
      });
      expect(result.adapter.protocol).toBe("nip-29");
    });

    it("should parse NIP-29 group ID when split by shell-quote", async () => {
      // shell-quote splits on ' so "groups.0xchat.com'chachi" becomes ["groups.0xchat.com", "chachi"]
      const result = await parseChatCommand(["groups.0xchat.com", "chachi"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier).toEqual({
        type: "group",
        value: "chachi",
        relays: ["wss://groups.0xchat.com"],
      });
      expect(result.adapter.protocol).toBe("nip-29");
    });

    it("should parse NIP-29 group ID with wss:// protocol (single arg)", async () => {
      const result = await parseChatCommand(["wss://groups.0xchat.com'chachi"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier).toEqual({
        type: "group",
        value: "chachi",
        relays: ["wss://groups.0xchat.com"],
      });
    });

    it("should parse NIP-29 group ID with wss:// when split by shell-quote", async () => {
      const result = await parseChatCommand([
        "wss://groups.0xchat.com",
        "chachi",
      ]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier).toEqual({
        type: "group",
        value: "chachi",
        relays: ["wss://groups.0xchat.com"],
      });
    });

    it("should parse NIP-29 group with different relay and group-id (single arg)", async () => {
      const result = await parseChatCommand(["relay.example.com'bitcoin-dev"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier.value).toBe("bitcoin-dev");
      expect(result.identifier.relays).toEqual(["wss://relay.example.com"]);
    });

    it("should parse NIP-29 group with different relay when split", async () => {
      const result = await parseChatCommand([
        "relay.example.com",
        "bitcoin-dev",
      ]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier.value).toBe("bitcoin-dev");
      expect(result.identifier.relays).toEqual(["wss://relay.example.com"]);
    });

    it("should parse NIP-29 group from nos.lol", async () => {
      const result = await parseChatCommand(["nos.lol'welcome"]);

      expect(result.protocol).toBe("nip-29");
      expect(result.identifier.value).toBe("welcome");
      expect(result.identifier.relays).toEqual(["wss://nos.lol"]);
    });
  });

  describe("error handling", () => {
    it("should throw error when no identifier provided", async () => {
      await expect(parseChatCommand([])).rejects.toThrow(
        "Chat identifier required. Usage: chat <identifier>",
      );
    });

    it("should throw error for unsupported identifier format", async () => {
      await expect(parseChatCommand(["unsupported-format"])).rejects.toThrow(
        /Unable to determine chat protocol/,
      );
    });

    it("should throw error for npub (NIP-C7 disabled)", async () => {
      await expect(parseChatCommand(["npub1xyz"])).rejects.toThrow(
        /Unable to determine chat protocol/,
      );
    });

    it("should throw error for note/nevent (NIP-28 not implemented)", async () => {
      await expect(parseChatCommand(["note1xyz"])).rejects.toThrow(
        /Unable to determine chat protocol/,
      );
    });

    it("should throw error for malformed naddr", async () => {
      await expect(parseChatCommand(["naddr1xyz"])).rejects.toThrow(
        /Unable to determine chat protocol/,
      );
    });
  });

  describe("NIP-53 live activity chat", () => {
    it("should parse NIP-53 live activity naddr", async () => {
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "my-stream",
        relays: ["wss://relay.example.com"],
      });

      const result = await parseChatCommand([naddr]);

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

    it("should parse NIP-53 live activity naddr with multiple relays", async () => {
      const naddr = nip19.naddrEncode({
        kind: 30311,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "podcast-episode-42",
        relays: ["wss://relay1.example.com", "wss://relay2.example.com"],
      });

      const result = await parseChatCommand([naddr]);

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

    it("should not parse NIP-29 group naddr as NIP-53", async () => {
      const naddr = nip19.naddrEncode({
        kind: 39000,
        pubkey:
          "0000000000000000000000000000000000000000000000000000000000000001",
        identifier: "test-group",
        relays: ["wss://relay.example.com"],
      });

      // NIP-29 adapter should handle kind 39000
      const result = await parseChatCommand([naddr]);

      expect(result.protocol).toBe("nip-29");
    });
  });
});
