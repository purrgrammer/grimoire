import { describe, it, expect } from "vitest";
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

    it("should throw error for naddr (NIP-53 not implemented)", () => {
      expect(() => parseChatCommand(["naddr1xyz"])).toThrow(
        /Unable to determine chat protocol/,
      );
    });
  });
});
