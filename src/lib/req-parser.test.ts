import { describe, it, expect } from "vitest";
import { parseReqCommand } from "./req-parser";

describe("parseReqCommand", () => {
  describe("kind flag (-k, --kind)", () => {
    it("should parse single kind", () => {
      const result = parseReqCommand(["-k", "1"]);
      expect(result.filter.kinds).toEqual([1]);
    });

    it("should parse comma-separated kinds", () => {
      const result = parseReqCommand(["-k", "1,3,7"]);
      expect(result.filter.kinds).toEqual([1, 3, 7]);
    });

    it("should parse comma-separated kinds with spaces", () => {
      const result = parseReqCommand(["-k", "1, 3, 7"]);
      expect(result.filter.kinds).toEqual([1, 3, 7]);
    });

    it("should deduplicate kinds", () => {
      const result = parseReqCommand(["-k", "1,3,1,3"]);
      expect(result.filter.kinds).toEqual([1, 3]);
    });

    it("should deduplicate across multiple -k flags", () => {
      const result = parseReqCommand(["-k", "1", "-k", "3", "-k", "1"]);
      expect(result.filter.kinds).toEqual([1, 3]);
    });

    it("should handle --kind long form", () => {
      const result = parseReqCommand(["--kind", "1,3,7"]);
      expect(result.filter.kinds).toEqual([1, 3, 7]);
    });

    it("should ignore invalid kinds", () => {
      const result = parseReqCommand(["-k", "1,invalid,3"]);
      expect(result.filter.kinds).toEqual([1, 3]);
    });
  });

  describe("author flag (-a, --author)", () => {
    it("should parse hex pubkey", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-a", hex]);
      expect(result.filter.authors).toEqual([hex]);
    });

    it("should parse comma-separated hex pubkeys", () => {
      const hex1 = "a".repeat(64);
      const hex2 = "b".repeat(64);
      const result = parseReqCommand(["-a", `${hex1},${hex2}`]);
      expect(result.filter.authors).toEqual([hex1, hex2]);
    });

    it("should deduplicate authors", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-a", `${hex},${hex}`]);
      expect(result.filter.authors).toEqual([hex]);
    });

    it("should accumulate NIP-05 identifiers for async resolution", () => {
      const result = parseReqCommand([
        "-a",
        "user@domain.com,alice@example.com",
      ]);
      expect(result.nip05Authors).toEqual([
        "user@domain.com",
        "alice@example.com",
      ]);
      expect(result.filter.authors).toBeUndefined();
    });

    it("should handle mixed hex and NIP-05", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-a", `${hex},user@domain.com`]);
      expect(result.filter.authors).toEqual([hex]);
      expect(result.nip05Authors).toEqual(["user@domain.com"]);
    });

    it("should deduplicate NIP-05 identifiers", () => {
      const result = parseReqCommand(["-a", "user@domain.com,user@domain.com"]);
      expect(result.nip05Authors).toEqual(["user@domain.com"]);
    });
  });

  describe("event ID flag (-e)", () => {
    it("should parse hex event ID", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-e", hex]);
      expect(result.filter["#e"]).toEqual([hex]);
    });

    it("should parse comma-separated event IDs", () => {
      const hex1 = "a".repeat(64);
      const hex2 = "b".repeat(64);
      const result = parseReqCommand(["-e", `${hex1},${hex2}`]);
      expect(result.filter["#e"]).toEqual([hex1, hex2]);
    });

    it("should deduplicate event IDs", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-e", `${hex},${hex}`]);
      expect(result.filter["#e"]).toEqual([hex]);
    });
  });

  describe("pubkey tag flag (-p)", () => {
    it("should parse hex pubkey for #p tag", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-p", hex]);
      expect(result.filter["#p"]).toEqual([hex]);
    });

    it("should parse comma-separated pubkeys", () => {
      const hex1 = "a".repeat(64);
      const hex2 = "b".repeat(64);
      const result = parseReqCommand(["-p", `${hex1},${hex2}`]);
      expect(result.filter["#p"]).toEqual([hex1, hex2]);
    });

    it("should accumulate NIP-05 identifiers for #p tags", () => {
      const result = parseReqCommand([
        "-p",
        "user@domain.com,alice@example.com",
      ]);
      expect(result.nip05PTags).toEqual([
        "user@domain.com",
        "alice@example.com",
      ]);
      expect(result.filter["#p"]).toBeUndefined();
    });

    it("should deduplicate #p tags", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-p", `${hex},${hex}`]);
      expect(result.filter["#p"]).toEqual([hex]);
    });
  });

  describe("hashtag flag (-t)", () => {
    it("should parse single hashtag", () => {
      const result = parseReqCommand(["-t", "nostr"]);
      expect(result.filter["#t"]).toEqual(["nostr"]);
    });

    it("should parse comma-separated hashtags", () => {
      const result = parseReqCommand(["-t", "nostr,bitcoin,lightning"]);
      expect(result.filter["#t"]).toEqual(["nostr", "bitcoin", "lightning"]);
    });

    it("should parse comma-separated hashtags with spaces", () => {
      const result = parseReqCommand(["-t", "nostr, bitcoin, lightning"]);
      expect(result.filter["#t"]).toEqual(["nostr", "bitcoin", "lightning"]);
    });

    it("should deduplicate hashtags", () => {
      const result = parseReqCommand(["-t", "nostr,bitcoin,nostr"]);
      expect(result.filter["#t"]).toEqual(["nostr", "bitcoin"]);
    });
  });

  describe("d-tag flag (-d)", () => {
    it("should parse single d-tag", () => {
      const result = parseReqCommand(["-d", "article1"]);
      expect(result.filter["#d"]).toEqual(["article1"]);
    });

    it("should parse comma-separated d-tags", () => {
      const result = parseReqCommand(["-d", "article1,article2,article3"]);
      expect(result.filter["#d"]).toEqual(["article1", "article2", "article3"]);
    });

    it("should deduplicate d-tags", () => {
      const result = parseReqCommand(["-d", "article1,article2,article1"]);
      expect(result.filter["#d"]).toEqual(["article1", "article2"]);
    });
  });

  describe("limit flag (-l, --limit)", () => {
    it("should parse limit", () => {
      const result = parseReqCommand(["-l", "100"]);
      expect(result.filter.limit).toBe(100);
    });

    it("should handle --limit long form", () => {
      const result = parseReqCommand(["--limit", "50"]);
      expect(result.filter.limit).toBe(50);
    });
  });

  describe("time flags (--since, --until)", () => {
    it("should parse unix timestamp for --since", () => {
      const result = parseReqCommand(["--since", "1234567890"]);
      expect(result.filter.since).toBe(1234567890);
    });

    it("should parse relative time for --since (hours)", () => {
      const result = parseReqCommand(["--since", "2h"]);
      expect(result.filter.since).toBeDefined();
      expect(result.filter.since).toBeGreaterThan(0);
    });

    it("should parse relative time for --since (days)", () => {
      const result = parseReqCommand(["--since", "7d"]);
      expect(result.filter.since).toBeDefined();
      expect(result.filter.since).toBeGreaterThan(0);
    });

    it("should parse unix timestamp for --until", () => {
      const result = parseReqCommand(["--until", "1234567890"]);
      expect(result.filter.until).toBe(1234567890);
    });
  });

  describe("search flag (--search)", () => {
    it("should parse search query", () => {
      const result = parseReqCommand(["--search", "bitcoin"]);
      expect(result.filter.search).toBe("bitcoin");
    });
  });

  describe("relay parsing", () => {
    it("should parse relay with wss:// protocol", () => {
      const result = parseReqCommand(["wss://relay.example.com"]);
      expect(result.relays).toEqual(["wss://relay.example.com"]);
    });

    it("should parse relay domain and add wss://", () => {
      const result = parseReqCommand(["relay.example.com"]);
      expect(result.relays).toEqual(["wss://relay.example.com"]);
    });

    it("should parse multiple relays", () => {
      const result = parseReqCommand([
        "wss://relay1.com",
        "relay2.com",
        "wss://relay3.com",
      ]);
      expect(result.relays).toEqual([
        "wss://relay1.com",
        "wss://relay2.com",
        "wss://relay3.com",
      ]);
    });
  });

  describe("close-on-eose flag", () => {
    it("should parse --close-on-eose", () => {
      const result = parseReqCommand(["--close-on-eose"]);
      expect(result.closeOnEose).toBe(true);
    });

    it("should default to false when not provided", () => {
      const result = parseReqCommand(["-k", "1"]);
      expect(result.closeOnEose).toBe(false);
    });
  });

  describe("complex scenarios", () => {
    it("should handle multiple flags together", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand([
        "-k",
        "1,3",
        "-a",
        hex,
        "-t",
        "nostr,bitcoin",
        "-l",
        "100",
        "--since",
        "1h",
        "relay.example.com",
      ]);

      expect(result.filter.kinds).toEqual([1, 3]);
      expect(result.filter.authors).toEqual([hex]);
      expect(result.filter["#t"]).toEqual(["nostr", "bitcoin"]);
      expect(result.filter.limit).toBe(100);
      expect(result.filter.since).toBeDefined();
      expect(result.relays).toEqual(["wss://relay.example.com"]);
    });

    it("should handle deduplication across multiple flags and commas", () => {
      const result = parseReqCommand([
        "-k",
        "1,3",
        "-k",
        "3,7",
        "-k",
        "1",
        "-t",
        "nostr",
        "-t",
        "bitcoin,nostr",
      ]);

      expect(result.filter.kinds).toEqual([1, 3, 7]);
      expect(result.filter["#t"]).toEqual(["nostr", "bitcoin"]);
    });

    it("should handle empty comma-separated values", () => {
      const result = parseReqCommand(["-k", "1,,3,,"]);
      expect(result.filter.kinds).toEqual([1, 3]);
    });

    it("should handle whitespace in comma-separated values", () => {
      const result = parseReqCommand(["-t", " nostr , bitcoin , lightning "]);
      expect(result.filter["#t"]).toEqual(["nostr", "bitcoin", "lightning"]);
    });
  });

  describe("generic tag flag (--tag, -T)", () => {
    it("should parse single generic tag", () => {
      const result = parseReqCommand(["--tag", "a", "30023:abc:article"]);
      expect(result.filter["#a"]).toEqual(["30023:abc:article"]);
    });

    it("should parse short form -T", () => {
      const result = parseReqCommand(["-T", "a", "30023:abc:article"]);
      expect(result.filter["#a"]).toEqual(["30023:abc:article"]);
    });

    it("should parse comma-separated values", () => {
      const result = parseReqCommand([
        "--tag",
        "a",
        "30023:abc:article1,30023:abc:article2,30023:abc:article3",
      ]);
      expect(result.filter["#a"]).toEqual([
        "30023:abc:article1",
        "30023:abc:article2",
        "30023:abc:article3",
      ]);
    });

    it("should parse comma-separated values with spaces", () => {
      const result = parseReqCommand(["--tag", "a", "value1, value2, value3"]);
      expect(result.filter["#a"]).toEqual(["value1", "value2", "value3"]);
    });

    it("should deduplicate values within single tag", () => {
      const result = parseReqCommand([
        "--tag",
        "a",
        "value1,value2,value1,value2",
      ]);
      expect(result.filter["#a"]).toEqual(["value1", "value2"]);
    });

    it("should accumulate values across multiple --tag flags for same letter", () => {
      const result = parseReqCommand([
        "--tag",
        "a",
        "value1",
        "--tag",
        "a",
        "value2",
        "--tag",
        "a",
        "value3",
      ]);
      expect(result.filter["#a"]).toEqual(["value1", "value2", "value3"]);
    });

    it("should deduplicate across multiple --tag flags", () => {
      const result = parseReqCommand([
        "--tag",
        "a",
        "value1,value2",
        "--tag",
        "a",
        "value2,value3",
      ]);
      expect(result.filter["#a"]).toEqual(["value1", "value2", "value3"]);
    });

    it("should handle multiple different generic tags", () => {
      const result = parseReqCommand([
        "--tag",
        "a",
        "address1",
        "--tag",
        "r",
        "https://example.com",
        "--tag",
        "g",
        "geohash123",
      ]);
      expect(result.filter["#a"]).toEqual(["address1"]);
      expect(result.filter["#r"]).toEqual(["https://example.com"]);
      expect(result.filter["#g"]).toEqual(["geohash123"]);
    });

    it("should work alongside specific tag flags", () => {
      const result = parseReqCommand([
        "-t",
        "nostr",
        "--tag",
        "a",
        "30023:abc:article",
        "-d",
        "article1",
      ]);
      expect(result.filter["#t"]).toEqual(["nostr"]);
      expect(result.filter["#a"]).toEqual(["30023:abc:article"]);
      expect(result.filter["#d"]).toEqual(["article1"]);
    });

    it("should not conflict with -a author flag", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand([
        "-a",
        hex,
        "--tag",
        "a",
        "30023:abc:article",
      ]);
      expect(result.filter.authors).toEqual([hex]);
      expect(result.filter["#a"]).toEqual(["30023:abc:article"]);
    });

    it("should ignore --tag without letter argument", () => {
      const result = parseReqCommand(["--tag"]);
      expect(result.filter["#a"]).toBeUndefined();
    });

    it("should ignore --tag without value argument", () => {
      const result = parseReqCommand(["--tag", "a"]);
      expect(result.filter["#a"]).toBeUndefined();
    });

    it("should ignore --tag with multi-character letter", () => {
      const result = parseReqCommand(["--tag", "abc", "value"]);
      expect(result.filter["#abc"]).toBeUndefined();
    });

    it("should handle empty values in comma-separated list", () => {
      const result = parseReqCommand(["--tag", "a", "value1,,value2,,"]);
      expect(result.filter["#a"]).toEqual(["value1", "value2"]);
    });

    it("should handle whitespace in comma-separated values", () => {
      const result = parseReqCommand([
        "--tag",
        "a",
        " value1 , value2 , value3 ",
      ]);
      expect(result.filter["#a"]).toEqual(["value1", "value2", "value3"]);
    });

    it("should support any single-letter tag", () => {
      const result = parseReqCommand([
        "--tag",
        "x",
        "xval",
        "--tag",
        "y",
        "yval",
        "--tag",
        "z",
        "zval",
      ]);
      expect(result.filter["#x"]).toEqual(["xval"]);
      expect(result.filter["#y"]).toEqual(["yval"]);
      expect(result.filter["#z"]).toEqual(["zval"]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty args", () => {
      const result = parseReqCommand([]);
      expect(result.filter).toEqual({});
      expect(result.relays).toBeUndefined();
      expect(result.closeOnEose).toBe(false);
    });

    it("should handle flag without value", () => {
      const result = parseReqCommand(["-k"]);
      expect(result.filter.kinds).toBeUndefined();
    });

    it("should handle unknown flags gracefully", () => {
      const result = parseReqCommand(["-x", "value", "-k", "1"]);
      expect(result.filter.kinds).toEqual([1]);
    });
  });
});
