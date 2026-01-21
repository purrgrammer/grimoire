import { describe, it, expect } from "vitest";
import { encodeSpell, decodeSpell } from "./spell-conversion";
import type { SpellEvent } from "@/types/spell";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";

describe("Spell Conversion", () => {
  describe("encodeSpell", () => {
    it("should encode a simple REQ command with kinds", () => {
      const result = encodeSpell({
        command: "req -k 1,3,7",
        description: "Test spell",
      });

      expect(result.tags).toContainEqual(["cmd", "REQ"]);
      expect(result.tags).toContainEqual(GRIMOIRE_CLIENT_TAG);
      expect(result.tags).toContainEqual(["k", "1"]);
      expect(result.tags).toContainEqual(["k", "3"]);
      expect(result.tags).toContainEqual(["k", "7"]);
      expect(result.filter.kinds).toEqual([1, 3, 7]);
      expect(result.content).toBe("Test spell");
    });

    it("should encode with optional description", () => {
      const result = encodeSpell({
        command: "req -k 1",
        description: "Test spell",
      });

      expect(result.tags).toContainEqual(["cmd", "REQ"]);
      expect(result.content).toBe("Test spell");
    });

    it("should encode with empty description", () => {
      const result = encodeSpell({
        command: "req -k 1",
      });

      expect(result.tags).toContainEqual(["cmd", "REQ"]);
      expect(result.content).toBe("");
    });

    it("should encode optional name tag", () => {
      const result = encodeSpell({
        command: "req -k 1",
        name: "Bitcoin Feed",
      });

      expect(result.tags).toContainEqual(["name", "Bitcoin Feed"]);
      expect(result.tags).toContainEqual(["cmd", "REQ"]);
    });

    it("should skip name tag if not provided", () => {
      const result = encodeSpell({
        command: "req -k 1",
      });

      const nameTag = result.tags.find((t) => t[0] === "name");
      expect(nameTag).toBeUndefined();
    });

    it("should trim and skip empty name", () => {
      const result = encodeSpell({
        command: "req -k 1",
        name: "   ",
      });

      const nameTag = result.tags.find((t) => t[0] === "name");
      expect(nameTag).toBeUndefined();
    });

    it("should encode both name and description", () => {
      const result = encodeSpell({
        command: "req -k 1",
        name: "Bitcoin Feed",
        description: "Notes about Bitcoin",
      });

      expect(result.tags).toContainEqual(["name", "Bitcoin Feed"]);
      expect(result.content).toBe("Notes about Bitcoin");
    });

    it("should encode authors as array tag", () => {
      const hex1 = "a".repeat(64);
      const hex2 = "b".repeat(64);
      const result = encodeSpell({
        command: `req -k 1 -a ${hex1},${hex2}`,
        description: "Author spell",
      });

      const authorsTag = result.tags.find((t) => t[0] === "authors");
      expect(authorsTag).toEqual(["authors", hex1, hex2]);
      expect(result.filter.authors).toEqual([hex1, hex2]);
    });

    it("should encode limit, since, until", () => {
      const result = encodeSpell({
        command: "req -k 1 -l 50 --since 7d --until now",
        description: "Time spell",
      });

      expect(result.tags).toContainEqual(["limit", "50"]);
      expect(result.tags).toContainEqual(["since", "7d"]);
      expect(result.tags).toContainEqual(["until", "now"]);
      expect(result.filter.limit).toBe(50);
    });

    it("should encode tag filters with new format", () => {
      const hex = "c".repeat(64);
      const result = encodeSpell({
        command: `req -k 1 -t bitcoin,nostr -p ${hex} -d article1`,
        description: "Tag spell",
      });

      expect(result.tags).toContainEqual(["tag", "t", "bitcoin", "nostr"]);
      expect(result.tags).toContainEqual(["tag", "p", hex]);
      expect(result.tags).toContainEqual(["tag", "d", "article1"]);
      expect(result.filter["#t"]).toEqual(["bitcoin", "nostr"]);
      expect(result.filter["#p"]).toEqual([hex]);
      expect(result.filter["#d"]).toEqual(["article1"]);
    });

    it("should encode search query", () => {
      const result = encodeSpell({
        command: 'req -k 1 --search "bitcoin price"',
        description: "Search spell",
      });

      expect(result.tags).toContainEqual(["search", "bitcoin price"]);
      expect(result.filter.search).toBe("bitcoin price");
    });

    it("should encode relays", () => {
      const result = encodeSpell({
        command: "req -k 1 wss://relay1.com wss://relay2.com",
        description: "Relay spell",
      });

      const relaysTag = result.tags.find((t) => t[0] === "relays");
      expect(relaysTag).toEqual([
        "relays",
        "wss://relay1.com/",
        "wss://relay2.com/",
      ]);
      expect(result.relays).toEqual(["wss://relay1.com/", "wss://relay2.com/"]);
    });

    it("should encode close-on-eose flag", () => {
      const result = encodeSpell({
        command: "req -k 1 --close-on-eose",
        description: "Close spell",
      });

      const closeTag = result.tags.find((t) => t[0] === "close-on-eose");
      expect(closeTag).toBeDefined();
      expect(result.closeOnEose).toBe(true);
    });

    it("should add topic tags", () => {
      const result = encodeSpell({
        command: "req -k 1",
        description: "A test spell",
        topics: ["bitcoin", "news"],
      });

      expect(result.tags).toContainEqual([
        "alt",
        "Grimoire REQ spell: A test spell",
      ]);
      expect(result.tags).toContainEqual(["t", "bitcoin"]);
      expect(result.tags).toContainEqual(["t", "news"]);
      expect(result.content).toBe("A test spell");
    });

    it("should add fork provenance", () => {
      const result = encodeSpell({
        command: "req -k 1",
        description: "Forked spell",
        forkedFrom: "abc123def456",
      });

      expect(result.tags).toContainEqual(["e", "abc123def456"]);
    });

    it("should handle special aliases $me and $contacts", () => {
      const result = encodeSpell({
        command: "req -k 1 -a $me,$contacts",
        description: "Alias spell",
      });

      const authorsTag = result.tags.find((t) => t[0] === "authors");
      expect(authorsTag).toEqual(["authors", "$me", "$contacts"]);
      expect(result.filter.authors).toEqual(["$me", "$contacts"]);
    });

    it("should handle uppercase P tag separately from lowercase p", () => {
      const hex1 = "d".repeat(64);
      const hex2 = "e".repeat(64);
      const result = encodeSpell({
        command: `req -k 9735 -p ${hex1} -P ${hex2}`,
        description: "P tag spell",
      });

      expect(result.tags).toContainEqual(["tag", "p", hex1]);
      expect(result.tags).toContainEqual(["tag", "P", hex2]);
      expect(result.filter["#p"]).toEqual([hex1]);
      expect(result.filter["#P"]).toEqual([hex2]);
    });

    it("should handle generic tags with -T flag", () => {
      const result = encodeSpell({
        command: "req -k 1 -T x value1,value2",
        description: "Generic tag spell",
      });

      expect(result.tags).toContainEqual(["tag", "x", "value1", "value2"]);
      expect(result.filter["#x"]).toEqual(["value1", "value2"]);
    });

    it("should handle complex command with multiple filters", () => {
      const hex1 = "f".repeat(64);
      const hex2 = "0".repeat(64);
      const result = encodeSpell({
        command: `req -k 1,3,30023 -a ${hex1},${hex2} -l 100 -t bitcoin,nostr --since 7d --search crypto wss://relay.com --close-on-eose`,
        description: "Multi-filter spell",
        topics: ["test"],
      });

      // Verify all components are present
      expect(result.tags).toContainEqual(["k", "1"]);
      expect(result.tags).toContainEqual(["k", "3"]);
      expect(result.tags).toContainEqual(["k", "30023"]);
      expect(result.tags).toContainEqual(["authors", hex1, hex2]);
      expect(result.tags).toContainEqual(["limit", "100"]);
      expect(result.tags).toContainEqual(["tag", "t", "bitcoin", "nostr"]);
      expect(result.tags).toContainEqual(["since", "7d"]);
      expect(result.tags).toContainEqual(["search", "crypto"]);
      expect(result.tags).toContainEqual(["relays", "wss://relay.com/"]);
      expect(result.tags).toContainEqual(["close-on-eose", ""]);
      expect(result.tags).toContainEqual(["t", "test"]);

      // Verify filter
      expect(result.filter.kinds).toEqual([1, 3, 30023]);
      expect(result.filter.authors).toEqual([hex1, hex2]);
      expect(result.filter.limit).toBe(100);
      expect(result.filter["#t"]).toEqual(["bitcoin", "nostr"]);
      expect(result.filter.search).toBe("crypto");
    });
  });

  describe("decodeSpell", () => {
    it("should decode a simple spell back to command", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [["cmd", "REQ"], GRIMOIRE_CLIENT_TAG, ["k", "1"], ["k", "3"]],
        content: "Test spell",
        sig: "test-sig",
      };

      const parsed = decodeSpell(event);

      expect(parsed.description).toBe("Test spell");
      expect(parsed.filter.kinds).toEqual([1, 3]);
      expect(parsed.command).toContain("-k 1,3");
    });

    it("should decode description from content", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [
          ["cmd", "REQ"],
          ["k", "1"],
        ],
        content: "Test spell description",
        sig: "test-sig",
      };

      const parsed = decodeSpell(event);

      expect(parsed.description).toBe("Test spell description");
      expect(parsed.filter.kinds).toEqual([1]);
    });

    it("should handle empty content", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [
          ["cmd", "REQ"],
          ["k", "1"],
        ],
        content: "",
        sig: "test-sig",
      };

      const parsed = decodeSpell(event);

      expect(parsed.description).toBeUndefined();
      expect(parsed.filter.kinds).toEqual([1]);
    });

    it("should decode name from tags", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [
          ["cmd", "REQ"],
          ["name", "Bitcoin Feed"],
          ["k", "1"],
        ],
        content: "Notes about Bitcoin",
        sig: "test-sig",
      };

      const parsed = decodeSpell(event);

      expect(parsed.name).toBe("Bitcoin Feed");
      expect(parsed.description).toBe("Notes about Bitcoin");
      expect(parsed.filter.kinds).toEqual([1]);
    });

    it("should handle missing name tag", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [
          ["cmd", "REQ"],
          ["k", "1"],
        ],
        content: "Test",
        sig: "test-sig",
      };

      const parsed = decodeSpell(event);

      expect(parsed.name).toBeUndefined();
      expect(parsed.description).toBe("Test");
    });

    it("should decode authors", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [
          ["cmd", "REQ"],
          GRIMOIRE_CLIENT_TAG,
          ["k", "1"],
          ["authors", "abc123", "def456"],
        ],
        content: "Author spell",
        sig: "test-sig",
      };

      const parsed = decodeSpell(event);

      expect(parsed.filter.authors).toEqual(["abc123", "def456"]);
      expect(parsed.command).toContain("-a abc123,def456");
    });

    it("should decode tag filters with new format", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [
          ["cmd", "REQ"],
          GRIMOIRE_CLIENT_TAG,
          ["k", "1"],
          ["tag", "t", "bitcoin", "nostr"],
          ["tag", "p", "abc123"],
          ["tag", "P", "def456"],
        ],
        content: "Tag spell",
        sig: "test-sig",
      };

      const parsed = decodeSpell(event);

      expect(parsed.filter["#t"]).toEqual(["bitcoin", "nostr"]);
      expect(parsed.filter["#p"]).toEqual(["abc123"]);
      expect(parsed.filter["#P"]).toEqual(["def456"]);
      expect(parsed.command).toContain("-t bitcoin,nostr");
      expect(parsed.command).toContain("-p abc123");
      expect(parsed.command).toContain("-P def456");
    });

    it("should decode time bounds with relative format", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [
          ["cmd", "REQ"],
          GRIMOIRE_CLIENT_TAG,
          ["k", "1"],
          ["since", "7d"],
          ["until", "now"],
        ],
        content: "Time spell",
        sig: "test-sig",
      };

      const parsed = decodeSpell(event);

      expect(parsed.command).toContain("--since 7d");
      expect(parsed.command).toContain("--until now");
    });

    it("should decode topics", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [
          ["cmd", "REQ"],
          GRIMOIRE_CLIENT_TAG,
          ["k", "1"],
          ["t", "bitcoin"],
          ["t", "news"],
        ],
        content: "A test spell",
        sig: "test-sig",
      };

      const parsed = decodeSpell(event);

      expect(parsed.description).toBe("A test spell");
      expect(parsed.topics).toEqual(["bitcoin", "news"]);
    });

    it("should decode fork provenance", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [
          ["cmd", "REQ"],
          GRIMOIRE_CLIENT_TAG,
          ["k", "1"],
          ["e", "abc123def456"],
        ],
        content: "Forked spell",
        sig: "test-sig",
      };

      const parsed = decodeSpell(event);

      expect(parsed.forkedFrom).toBe("abc123def456");
    });

    it("should throw error if cmd is not REQ", () => {
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: [["cmd", "INVALID"]],
        content: "Test",
        sig: "test-sig",
      };

      expect(() => decodeSpell(event)).toThrow(
        "Invalid spell command type: INVALID",
      );
    });
  });

  describe("Round-trip conversion", () => {
    it("should preserve filter semantics through encode → decode", () => {
      const hex1 = "1".repeat(64);
      const hex2 = "2".repeat(64);
      const original = {
        command: `req -k 1,3,7 -a ${hex1},${hex2} -l 50 -t bitcoin,nostr --since 7d --search crypto`,
        description: "Testing round-trip conversion",
        topics: ["test"],
      };

      // Encode
      const encoded = encodeSpell(original);

      // Create event
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: encoded.tags,
        content: encoded.content,
        sig: "test-sig",
      };

      // Decode
      const decoded = decodeSpell(event);

      // Verify filter semantics are preserved
      expect(decoded.filter.kinds).toEqual([1, 3, 7]);
      expect(decoded.filter.authors).toEqual([hex1, hex2]);
      expect(decoded.filter.limit).toBe(50);
      expect(decoded.filter["#t"]).toEqual(["bitcoin", "nostr"]);
      expect(decoded.filter.search).toBe("crypto");

      // Verify metadata
      expect(decoded.description).toBe("Testing round-trip conversion");
      expect(decoded.topics).toEqual(["test"]);

      // Verify command contains key components (order may differ)
      expect(decoded.command).toContain("-k 1,3,7");
      expect(decoded.command).toContain(`-a ${hex1},${hex2}`);
      expect(decoded.command).toContain("-l 50");
      expect(decoded.command).toContain("-t bitcoin,nostr");
      expect(decoded.command).toContain("--since 7d");
      expect(decoded.command).toContain("--search");
    });

    it("should handle minimal spell without description", () => {
      const original = {
        command: "req -k 1",
      };

      const encoded = encodeSpell(original);
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: encoded.tags,
        content: encoded.content,
        sig: "test-sig",
      };

      const decoded = decodeSpell(event);

      expect(decoded.description).toBeUndefined();
      expect(decoded.filter.kinds).toEqual([1]);
      expect(decoded.command).toBe("req -k 1");
    });

    it("should round-trip with name", () => {
      const original = {
        command: "req -k 1",
        name: "Bitcoin Feed",
        description: "Notes about Bitcoin",
      };

      const encoded = encodeSpell(original);
      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: encoded.tags,
        content: encoded.content,
        sig: "test-sig",
      };

      const decoded = decodeSpell(event);

      expect(decoded.name).toBe("Bitcoin Feed");
      expect(decoded.description).toBe("Notes about Bitcoin");
      expect(decoded.filter.kinds).toEqual([1]);
    });

    it("should preserve special aliases through round-trip", () => {
      const original = {
        command: "req -k 1 -a $me,$contacts -p $me",
        description: "Alias spell",
      };

      const encoded = encodeSpell(original);

      // Debug: Check what was encoded
      const authorsTag = encoded.tags.find((t) => t[0] === "authors");
      const pTag = encoded.tags.find((t) => t[0] === "tag" && t[1] === "p");

      // Verify encoding worked
      expect(authorsTag).toEqual(["authors", "$me", "$contacts"]);
      expect(pTag).toEqual(["tag", "p", "$me"]);

      const event: SpellEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: 777,
        tags: encoded.tags,
        content: encoded.content,
        sig: "test-sig",
      };

      const decoded = decodeSpell(event);

      expect(decoded.filter.authors).toEqual(["$me", "$contacts"]);
      expect(decoded.filter["#p"]).toEqual(["$me"]);
      expect(decoded.command).toContain("-a $me,$contacts");
      expect(decoded.command).toContain("-p $me");
    });
  });

  describe("Validation and edge cases", () => {
    it("should throw error for empty command", () => {
      expect(() =>
        encodeSpell({
          command: "",
        }),
      ).toThrow("Spell command is required");
    });

    it("should throw error for whitespace-only command", () => {
      expect(() =>
        encodeSpell({
          command: "   ",
        }),
      ).toThrow("Spell command is required");
    });

    it("should throw error for 'req' with no filters", () => {
      expect(() =>
        encodeSpell({
          command: "req",
        }),
      ).toThrow(); // Will throw either empty tokens or no constraints error
    });

    it("should throw error for command with no valid filters", () => {
      expect(() =>
        encodeSpell({
          command: "req --invalid-flag",
        }),
      ).toThrow(
        "Spell command must specify at least one filter (kinds, authors, tags, time bounds, search, or limit)",
      );
    });

    it("should throw error for command with only invalid values", () => {
      expect(() =>
        encodeSpell({
          command: "req -k invalid",
        }),
      ).toThrow(
        "Spell command must specify at least one filter (kinds, authors, tags, time bounds, search, or limit)",
      );
    });

    it("should handle malformed author values gracefully", () => {
      // Invalid hex should be ignored, not cause errors
      const result = encodeSpell({
        command: "req -k 1 -a invalid",
      });

      // Should have kinds but no authors
      expect(result.filter.kinds).toEqual([1]);
      expect(result.filter.authors).toBeUndefined();
    });

    it("should handle mixed valid and invalid values", () => {
      const hex = "a".repeat(64);
      const result = encodeSpell({
        command: `req -k 1,invalid,3 -a ${hex},invalid`,
      });

      // Should keep only valid values
      expect(result.filter.kinds).toEqual([1, 3]);
      expect(result.filter.authors).toEqual([hex]);
    });

    it("should handle quotes in search query", () => {
      const result = encodeSpell({
        command: 'req -k 1 --search "quoted text"',
      });

      expect(result.filter.search).toBe("quoted text");
    });

    it("should handle single quotes in search query", () => {
      const result = encodeSpell({
        command: "req -k 1 --search 'single quoted'",
      });

      expect(result.filter.search).toBe("single quoted");
    });

    it("should handle special characters in search", () => {
      const result = encodeSpell({
        command: "req -k 1 --search 'text with #hashtag @mention'",
      });

      expect(result.filter.search).toBe("text with #hashtag @mention");
    });

    it("should accept commands with only limit", () => {
      const result = encodeSpell({
        command: "req -l 50",
      });

      expect(result.filter.limit).toBe(50);
    });

    it("should accept commands with only time bounds", () => {
      const result = encodeSpell({
        command: "req --since 7d",
      });

      expect(result.filter.since).toBeDefined();
    });

    it("should accept commands with only search", () => {
      const result = encodeSpell({
        command: "req --search bitcoin",
      });

      expect(result.filter.search).toBe("bitcoin");
    });

    it("should handle very long commands", () => {
      // Generate 10 different hex values to test long author lists
      const hexValues = Array(10)
        .fill(0)
        .map((_, i) => i.toString(16).repeat(64).slice(0, 64))
        .join(",");

      const result = encodeSpell({
        command: `req -k 1 -a ${hexValues}`,
      });

      expect(result.filter.authors).toBeDefined();
      expect(result.filter.authors!.length).toBe(10);
    });

    it("should handle Unicode in descriptions", () => {
      const result = encodeSpell({
        command: "req -k 1",
        description: "Testing with emoji 🎨 and unicode 你好",
      });

      expect(result.content).toBe("Testing with emoji 🎨 and unicode 你好");
    });

    it("should preserve exact capitalization in $me/$contacts", () => {
      const result = encodeSpell({
        command: "req -k 1 -a $Me,$CONTACTS",
      });

      // Parser normalizes to lowercase
      const authorsTag = result.tags.find((t) => t[0] === "authors");
      expect(authorsTag).toEqual(["authors", "$me", "$contacts"]);
    });
  });
});
