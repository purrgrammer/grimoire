import { describe, it, expect } from "vitest";
import {
  encodeSpell,
  decodeSpell,
  applySpellParameters,
} from "./spell-conversion";
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

  describe("Parameterized spells (lenses)", () => {
    describe("Encoding with parameters", () => {
      it("should encode $pubkey parameter with default", () => {
        const result = encodeSpell({
          command: "req -k 1 -a $pubkey",
          name: "Notes",
          description: "Notes by author",
          parameter: {
            type: "$pubkey",
            default: ["$me"],
          },
        });

        expect(result.tags).toContainEqual(["l", "$pubkey", "$me"]);
        expect(result.tags).toContainEqual(["name", "Notes"]);
      });

      it("should encode $pubkey parameter without default", () => {
        const result = encodeSpell({
          command: "req -k 1 -a $pubkey",
          parameter: {
            type: "$pubkey",
          },
        });

        const lTag = result.tags.find((t) => t[0] === "l");
        expect(lTag).toEqual(["l", "$pubkey"]);
      });

      it("should encode $event parameter", () => {
        const result = encodeSpell({
          command: "req -k 1 -e $event",
          parameter: {
            type: "$event",
          },
        });

        expect(result.tags).toContainEqual(["l", "$event"]);
      });

      it("should encode $relay parameter", () => {
        const result = encodeSpell({
          command: "req -k 1",
          parameter: {
            type: "$relay",
          },
        });

        expect(result.tags).toContainEqual(["l", "$relay"]);
      });

      it("should encode parameter with multiple defaults", () => {
        const hex1 = "a".repeat(64);
        const hex2 = "b".repeat(64);
        const result = encodeSpell({
          command: "req -k 1 -a $pubkey",
          parameter: {
            type: "$pubkey",
            default: [hex1, hex2],
          },
        });

        expect(result.tags).toContainEqual(["l", "$pubkey", hex1, hex2]);
      });

      it("should work without parameter (regular spell)", () => {
        const result = encodeSpell({
          command: "req -k 1",
        });

        const lTag = result.tags.find((t) => t[0] === "l");
        expect(lTag).toBeUndefined();
      });

      it("should convert $me to $pubkey placeholder when parameterized", () => {
        const result = encodeSpell({
          command: "req -k 1 -a $me",
          parameter: { type: "$pubkey" as const },
        });

        expect(result.filter.authors).toEqual(["$pubkey"]);
        const authorsTag = result.tags.find((t) => t[0] === "authors");
        expect(authorsTag).toEqual(["authors", "$pubkey"]);
      });

      it("should convert $contacts to $pubkey placeholder when parameterized", () => {
        const result = encodeSpell({
          command: "req -k 1 -a $contacts",
          parameter: { type: "$pubkey" as const },
        });

        expect(result.filter.authors).toEqual(["$pubkey"]);
      });

      it("should preserve $me when not parameterized", () => {
        const result = encodeSpell({
          command: "req -k 1 -a $me",
        });

        expect(result.filter.authors).toEqual(["$me"]);
      });
    });

    describe("Decoding parameters", () => {
      it("should decode $pubkey parameter with default", () => {
        const event: SpellEvent = {
          id: "test-id",
          pubkey: "test-pubkey",
          created_at: 1234567890,
          kind: 777,
          tags: [
            ["cmd", "REQ"],
            ["l", "$pubkey", "$me"],
            ["k", "1"],
            ["authors", "$pubkey"],
          ],
          content: "Notes by author",
          sig: "test-sig",
        };

        const parsed = decodeSpell(event);

        expect(parsed.parameter).toEqual({
          type: "$pubkey",
          default: ["$me"],
        });
      });

      it("should decode $event parameter without default", () => {
        const event: SpellEvent = {
          id: "test-id",
          pubkey: "test-pubkey",
          created_at: 1234567890,
          kind: 777,
          tags: [
            ["cmd", "REQ"],
            ["l", "$event"],
            ["k", "1"],
          ],
          content: "Replies",
          sig: "test-sig",
        };

        const parsed = decodeSpell(event);

        expect(parsed.parameter).toEqual({
          type: "$event",
          default: undefined,
        });
      });

      it("should decode $relay parameter", () => {
        const event: SpellEvent = {
          id: "test-id",
          pubkey: "test-pubkey",
          created_at: 1234567890,
          kind: 777,
          tags: [
            ["cmd", "REQ"],
            ["l", "$relay"],
            ["k", "1"],
          ],
          content: "Popular posts",
          sig: "test-sig",
        };

        const parsed = decodeSpell(event);

        expect(parsed.parameter).toEqual({
          type: "$relay",
          default: undefined,
        });
      });

      it("should decode parameter with multiple defaults", () => {
        const hex1 = "a".repeat(64);
        const hex2 = "b".repeat(64);
        const event: SpellEvent = {
          id: "test-id",
          pubkey: "test-pubkey",
          created_at: 1234567890,
          kind: 777,
          tags: [
            ["cmd", "REQ"],
            ["l", "$pubkey", hex1, hex2],
            ["k", "1"],
          ],
          content: "Test",
          sig: "test-sig",
        };

        const parsed = decodeSpell(event);

        expect(parsed.parameter).toEqual({
          type: "$pubkey",
          default: [hex1, hex2],
        });
      });

      it("should ignore invalid parameter types", () => {
        const event: SpellEvent = {
          id: "test-id",
          pubkey: "test-pubkey",
          created_at: 1234567890,
          kind: 777,
          tags: [
            ["cmd", "REQ"],
            ["l", "$invalid"],
            ["k", "1"],
          ],
          content: "Test",
          sig: "test-sig",
        };

        const parsed = decodeSpell(event);

        expect(parsed.parameter).toBeUndefined();
      });

      it("should handle missing l tag (regular spell)", () => {
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

        expect(parsed.parameter).toBeUndefined();
      });
    });

    describe("applySpellParameters", () => {
      describe("$pubkey parameters", () => {
        it("should substitute $pubkey in authors array", () => {
          const parsed = {
            filter: { kinds: [1], authors: ["$pubkey"] },
            parameter: { type: "$pubkey" as const },
          } as any;

          const hex = "a".repeat(64);
          const result = applySpellParameters(parsed, { targetPubkey: hex });

          expect(result.authors).toEqual([hex]);
        });

        it("should substitute $pubkey in #p tag filters", () => {
          const parsed = {
            filter: { kinds: [1], "#p": ["$pubkey"] },
            parameter: { type: "$pubkey" as const },
          } as any;

          const hex = "c".repeat(64);
          const result = applySpellParameters(parsed, { targetPubkey: hex });

          expect(result["#p"]).toEqual([hex]);
        });

        it("should substitute $pubkey in #P tag filters", () => {
          const parsed = {
            filter: { kinds: [9735], "#P": ["$pubkey"] },
            parameter: { type: "$pubkey" as const },
          } as any;

          const hex = "d".repeat(64);
          const result = applySpellParameters(parsed, { targetPubkey: hex });

          expect(result["#P"]).toEqual([hex]);
        });

        it("should preserve non-$pubkey values when substituting", () => {
          const hex1 = "a".repeat(64);
          const hex2 = "b".repeat(64);
          const parsed = {
            filter: { kinds: [1], authors: [hex1, "$pubkey"] },
            parameter: { type: "$pubkey" as const },
          } as any;

          const result = applySpellParameters(parsed, { targetPubkey: hex2 });

          expect(result.authors).toEqual([hex1, hex2]);
        });

        it("should use default values when no target provided", () => {
          const hex = "a".repeat(64);
          const parsed = {
            filter: { kinds: [1], authors: ["$pubkey"] },
            parameter: { type: "$pubkey" as const, default: [hex] },
          } as any;

          const result = applySpellParameters(parsed, {});

          expect(result.authors).toEqual([hex]);
        });
      });

      describe("$event parameters", () => {
        it("should substitute $event in #e tag filters", () => {
          const parsed = {
            filter: { kinds: [1], "#e": ["$event"] },
            parameter: { type: "$event" as const },
          } as any;

          const eventId = "abc123def456";
          const result = applySpellParameters(parsed, {
            targetEventId: eventId,
          });

          expect(result["#e"]).toEqual([eventId]);
        });

        it("should substitute $event in #a tag filters", () => {
          const parsed = {
            filter: { kinds: [1], "#a": ["$event"] },
            parameter: { type: "$event" as const },
          } as any;

          const addr = "30023:pubkey:article";
          const result = applySpellParameters(parsed, { targetEventId: addr });

          expect(result["#a"]).toEqual([addr]);
        });

        it("should substitute $event in ids array", () => {
          const parsed = {
            filter: { kinds: [1], ids: ["$event"] },
            parameter: { type: "$event" as const },
          } as any;

          const eventId = "abc123def456";
          const result = applySpellParameters(parsed, {
            targetEventId: eventId,
          });

          expect(result.ids).toEqual([eventId]);
        });
      });

      describe("$relay parameters", () => {
        it("should substitute $relay in #r tag filters", () => {
          const parsed = {
            filter: { kinds: [1], "#r": ["$relay"] },
            parameter: { type: "$relay" as const },
          } as any;

          const relay = "wss://relay.example.com/";
          const result = applySpellParameters(parsed, { targetRelay: relay });

          expect(result["#r"]).toEqual([relay]);
        });
      });

      describe("Edge cases", () => {
        it("should return filter as-is for non-parameterized spell", () => {
          const parsed = {
            filter: { kinds: [1], authors: ["abc123"] },
          } as any;

          const result = applySpellParameters(parsed, {
            targetPubkey: "def456",
          });

          expect(result).toEqual({ kinds: [1], authors: ["abc123"] });
        });

        it("should throw error when no args and no defaults", () => {
          const parsed = {
            filter: { kinds: [1], authors: ["$pubkey"] },
            parameter: { type: "$pubkey" as const },
          } as any;

          expect(() => applySpellParameters(parsed, {})).toThrow(
            "Parameterized $pubkey spell requires target pubkey",
          );
        });

        it("should not modify original filter object", () => {
          const original = { kinds: [1], authors: ["$pubkey"] };
          const parsed = {
            filter: original,
            parameter: { type: "$pubkey" as const },
          } as any;

          const hex = "a".repeat(64);
          applySpellParameters(parsed, { targetPubkey: hex });

          // Original should be unchanged
          expect(original.authors).toEqual(["$pubkey"]);
        });

        it("should handle empty filter arrays gracefully", () => {
          const parsed = {
            filter: { kinds: [1], authors: [] },
            parameter: { type: "$pubkey" as const },
          } as any;

          const hex = "a".repeat(64);
          const result = applySpellParameters(parsed, { targetPubkey: hex });

          expect(result.authors).toEqual([]);
        });

        it("should handle missing filter fields gracefully", () => {
          const parsed = {
            filter: { kinds: [1] },
            parameter: { type: "$pubkey" as const },
          } as any;

          const hex = "a".repeat(64);
          const result = applySpellParameters(parsed, { targetPubkey: hex });

          expect(result.authors).toBeUndefined();
          expect(result.kinds).toEqual([1]);
        });
      });

      describe("Implicit $me and $contacts resolution", () => {
        it("should resolve $me to targetPubkey", () => {
          const parsed = {
            filter: { kinds: [1], authors: ["$me"] },
          } as any;

          const targetPubkey = "a".repeat(64);
          const result = applySpellParameters(parsed, { targetPubkey });

          expect(result.authors).toEqual([targetPubkey]);
        });

        it("should resolve $contacts to targetContacts array", () => {
          const parsed = {
            filter: { kinds: [1], authors: ["$contacts"] },
          } as any;

          const contact1 = "a".repeat(64);
          const contact2 = "b".repeat(64);
          const result = applySpellParameters(parsed, {
            targetContacts: [contact1, contact2],
          });

          expect(result.authors).toEqual([contact1, contact2]);
        });

        it("should resolve both $me and $contacts in same filter", () => {
          const parsed = {
            filter: { kinds: [1], authors: ["$me", "$contacts"] },
          } as any;

          const targetPubkey = "a".repeat(64);
          const contact1 = "b".repeat(64);
          const contact2 = "c".repeat(64);
          const result = applySpellParameters(parsed, {
            targetPubkey,
            targetContacts: [contact1, contact2],
          });

          expect(result.authors).toEqual([targetPubkey, contact1, contact2]);
        });

        it("should resolve $me and $contacts in #p tags", () => {
          const parsed = {
            filter: { kinds: [1], "#p": ["$me", "$contacts"] },
          } as any;

          const targetPubkey = "a".repeat(64);
          const contact1 = "b".repeat(64);
          const result = applySpellParameters(parsed, {
            targetPubkey,
            targetContacts: [contact1],
          });

          expect(result["#p"]).toEqual([targetPubkey, contact1]);
        });

        it("should preserve other values when resolving $me/$contacts", () => {
          const otherPubkey = "z".repeat(64);
          const parsed = {
            filter: { kinds: [1], authors: [otherPubkey, "$me", "$contacts"] },
          } as any;

          const targetPubkey = "a".repeat(64);
          const contact = "b".repeat(64);
          const result = applySpellParameters(parsed, {
            targetPubkey,
            targetContacts: [contact],
          });

          expect(result.authors).toEqual([otherPubkey, targetPubkey, contact]);
        });
      });
    });

    describe("Round-trip with parameters", () => {
      it("should preserve parameter configuration through encode → decode", () => {
        const original = {
          command: "req -k 1 -a $pubkey",
          name: "Notes",
          description: "Notes by author",
          parameter: {
            type: "$pubkey" as const,
            default: ["$me"],
          },
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

        expect(decoded.parameter).toEqual({
          type: "$pubkey",
          default: ["$me"],
        });
        expect(decoded.name).toBe("Notes");
        expect(decoded.description).toBe("Notes by author");
      });

      it("should work end-to-end: encode → decode → apply", () => {
        const hex1 = "a".repeat(64);

        // Create parameterized spell using $me as placeholder
        // Encoding will convert $me to $pubkey automatically
        const encoded = encodeSpell({
          command: "req -k 1 -a $me",
          parameter: { type: "$pubkey" as const },
        });

        // Publish
        const event: SpellEvent = {
          id: "test-id",
          pubkey: "test-pubkey",
          created_at: 1234567890,
          kind: 777,
          tags: encoded.tags,
          content: encoded.content,
          sig: "test-sig",
        };

        // Retrieve and decode
        const decoded = decodeSpell(event);

        // Filter should now have $pubkey placeholder
        expect(decoded.filter.authors).toEqual(["$pubkey"]);

        // Apply with single target pubkey
        const filter = applySpellParameters(decoded, { targetPubkey: hex1 });

        expect(filter.kinds).toEqual([1]);
        expect(filter.authors).toEqual([hex1]);
      });

      it("should handle complex parameterized spell", () => {
        const encoded = encodeSpell({
          command: "req -k 1,30023 -a $me -t bitcoin -l 50 --since 7d",
          name: "User Content",
          description: "All content from a user about Bitcoin",
          parameter: { type: "$pubkey" as const, default: ["$me"] },
          topics: ["bitcoin"],
        });

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

        // Filter should have $pubkey placeholder
        expect(decoded.filter.authors).toEqual(["$pubkey"]);

        const hex = "c".repeat(64);
        const filter = applySpellParameters(decoded, { targetPubkey: hex });

        expect(filter.kinds).toEqual([1, 30023]);
        expect(filter.authors).toEqual([hex]);
        expect(filter["#t"]).toEqual(["bitcoin"]);
        expect(filter.limit).toBe(50);
        expect(decoded.topics).toEqual(["bitcoin"]);
      });
    });
  });
});
