import { describe, it, expect } from "vitest";
import { parseZapCommand } from "./zap-parser";

describe("parseZapCommand", () => {
  describe("positional arguments", () => {
    it("should parse npub as recipient", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
      ]);
      // npub decodes to this hex pubkey
      expect(result.recipientPubkey).toBe(
        "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
      );
    });

    it("should parse $me alias with active account", async () => {
      const activePubkey = "abc123def456";
      const result = await parseZapCommand(["$me"], activePubkey);
      expect(result.recipientPubkey).toBe(activePubkey);
    });

    it("should throw when $me used without active account", async () => {
      await expect(parseZapCommand(["$me"])).rejects.toThrow(
        "No active account",
      );
    });

    it("should throw for empty arguments", async () => {
      await expect(parseZapCommand([])).rejects.toThrow(
        "Recipient or event required",
      );
    });
  });

  describe("custom tags (-T, --tag)", () => {
    it("should parse single custom tag with -T", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
        "-T",
        "a",
        "30311:pubkey:identifier",
      ]);
      expect(result.customTags).toEqual([["a", "30311:pubkey:identifier"]]);
    });

    it("should parse custom tag with --tag", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
        "--tag",
        "e",
        "abc123",
      ]);
      expect(result.customTags).toEqual([["e", "abc123"]]);
    });

    it("should parse custom tag with relay hint", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
        "-T",
        "a",
        "30311:pubkey:identifier",
        "wss://relay.example.com",
      ]);
      expect(result.customTags).toEqual([
        ["a", "30311:pubkey:identifier", "wss://relay.example.com/"],
      ]);
    });

    it("should parse multiple custom tags", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
        "-T",
        "a",
        "30311:pubkey:identifier",
        "-T",
        "e",
        "goal123",
      ]);
      expect(result.customTags).toEqual([
        ["a", "30311:pubkey:identifier"],
        ["e", "goal123"],
      ]);
    });

    it("should throw for incomplete tag", async () => {
      await expect(
        parseZapCommand([
          "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
          "-T",
          "a",
        ]),
      ).rejects.toThrow("Tag requires at least 2 arguments");
    });

    it("should not include customTags when none provided", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
      ]);
      expect(result.customTags).toBeUndefined();
    });
  });

  describe("relays (-r, --relay)", () => {
    it("should parse single relay with -r", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
        "-r",
        "wss://relay1.example.com",
      ]);
      expect(result.relays).toEqual(["wss://relay1.example.com/"]);
    });

    it("should parse relay with --relay", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
        "--relay",
        "wss://relay.example.com",
      ]);
      expect(result.relays).toEqual(["wss://relay.example.com/"]);
    });

    it("should parse multiple relays", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
        "-r",
        "wss://relay1.example.com",
        "-r",
        "wss://relay2.example.com",
      ]);
      expect(result.relays).toEqual([
        "wss://relay1.example.com/",
        "wss://relay2.example.com/",
      ]);
    });

    it("should throw for missing relay URL", async () => {
      await expect(
        parseZapCommand([
          "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
          "-r",
        ]),
      ).rejects.toThrow("Relay option requires a URL");
    });

    it("should normalize relay URLs", async () => {
      // normalizeRelayURL is liberal - it normalizes most inputs
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
        "-r",
        "relay.example.com",
      ]);
      expect(result.relays).toEqual(["wss://relay.example.com/"]);
    });

    it("should not include relays when none provided", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
      ]);
      expect(result.relays).toBeUndefined();
    });
  });

  describe("combined flags", () => {
    it("should parse tags and relays together", async () => {
      const result = await parseZapCommand([
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
        "-T",
        "a",
        "30311:pubkey:identifier",
        "-r",
        "wss://relay.example.com",
        "-T",
        "e",
        "goalid",
        "wss://relay.example.com",
      ]);
      expect(result.customTags).toEqual([
        ["a", "30311:pubkey:identifier"],
        ["e", "goalid", "wss://relay.example.com/"],
      ]);
      expect(result.relays).toEqual(["wss://relay.example.com/"]);
    });

    it("should handle flags before positional args", async () => {
      const result = await parseZapCommand([
        "-r",
        "wss://relay.example.com",
        "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
      ]);
      expect(result.recipientPubkey).toBe(
        "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
      );
      expect(result.relays).toEqual(["wss://relay.example.com/"]);
    });
  });

  describe("unknown options", () => {
    it("should throw for unknown flags", async () => {
      await expect(
        parseZapCommand([
          "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s",
          "--unknown",
        ]),
      ).rejects.toThrow("Unknown option: --unknown");
    });
  });
});
