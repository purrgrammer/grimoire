import { describe, it, expect } from "vitest";
import { parseCountCommand } from "./count-parser";

describe("parseCountCommand", () => {
  describe("basic parsing", () => {
    it("should parse single kind", () => {
      const result = parseCountCommand(["-k", "1"]);
      expect(result.filter.kinds).toEqual([1]);
    });

    it("should parse multiple kinds", () => {
      const result = parseCountCommand(["-k", "1,3,7"]);
      expect(result.filter.kinds).toEqual([1, 3, 7]);
    });

    it("should parse author hex", () => {
      const pubkey =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const result = parseCountCommand(["-a", pubkey]);
      expect(result.filter.authors).toEqual([pubkey]);
    });

    it("should parse limit", () => {
      const result = parseCountCommand(["-k", "1", "-l", "100"]);
      expect(result.filter.limit).toBe(100);
    });
  });

  describe("time filters", () => {
    it("should parse --since with relative time", () => {
      const result = parseCountCommand(["--since", "7d"]);
      expect(result.filter.since).toBeDefined();
      expect(typeof result.filter.since).toBe("number");
    });

    it("should parse --until with relative time", () => {
      const result = parseCountCommand(["--until", "1h"]);
      expect(result.filter.until).toBeDefined();
      expect(typeof result.filter.until).toBe("number");
    });

    it("should parse unix timestamp", () => {
      const result = parseCountCommand(["--since", "1234567890"]);
      expect(result.filter.since).toBe(1234567890);
    });
  });

  describe("tag filters", () => {
    it("should parse #p tags", () => {
      const pubkey =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const result = parseCountCommand(["-p", pubkey]);
      expect(result.filter["#p"]).toEqual([pubkey]);
    });

    it("should parse #P tags (uppercase)", () => {
      const pubkey =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const result = parseCountCommand(["-P", pubkey]);
      expect(result.filter["#P"]).toEqual([pubkey]);
    });

    it("should parse #t tags (hashtags)", () => {
      const result = parseCountCommand(["-t", "nostr,bitcoin"]);
      expect(result.filter["#t"]).toEqual(["nostr", "bitcoin"]);
    });

    it("should parse #d tags", () => {
      const result = parseCountCommand(["-d", "article1,article2"]);
      expect(result.filter["#d"]).toEqual(["article1", "article2"]);
    });

    it("should parse generic tags", () => {
      const result = parseCountCommand(["--tag", "a", "val1,val2"]);
      expect(result.filter["#a"]).toEqual(["val1", "val2"]);
    });
  });

  describe("relay parsing", () => {
    it("should parse relay URLs with wss://", () => {
      const result = parseCountCommand(["-k", "1", "wss://relay.damus.io"]);
      expect(result.relays).toEqual(["wss://relay.damus.io/"]);
    });

    it("should parse relay shorthand (domain only)", () => {
      const result = parseCountCommand(["-k", "1", "relay.damus.io"]);
      expect(result.relays).toEqual(["wss://relay.damus.io/"]);
    });

    it("should parse multiple relays", () => {
      const result = parseCountCommand([
        "-k",
        "1",
        "relay.damus.io",
        "nos.lol",
      ]);
      expect(result.relays).toEqual([
        "wss://relay.damus.io/",
        "wss://nos.lol/",
      ]);
    });
  });

  describe("alias support", () => {
    it("should detect $me in authors", () => {
      const result = parseCountCommand(["-a", "$me"]);
      expect(result.filter.authors).toEqual(["$me"]);
      expect(result.needsAccount).toBe(true);
    });

    it("should detect $contacts in authors", () => {
      const result = parseCountCommand(["-a", "$contacts"]);
      expect(result.filter.authors).toEqual(["$contacts"]);
      expect(result.needsAccount).toBe(true);
    });

    it("should detect $me in #p tags", () => {
      const result = parseCountCommand(["-p", "$me"]);
      expect(result.filter["#p"]).toEqual(["$me"]);
      expect(result.needsAccount).toBe(true);
    });

    it("should detect $contacts in #P tags", () => {
      const result = parseCountCommand(["-P", "$contacts"]);
      expect(result.filter["#P"]).toEqual(["$contacts"]);
      expect(result.needsAccount).toBe(true);
    });
  });

  describe("NIP-05 support", () => {
    it("should detect NIP-05 identifiers in authors", () => {
      const result = parseCountCommand(["-a", "user@domain.com"]);
      expect(result.nip05Authors).toEqual(["user@domain.com"]);
      expect(result.filter.authors).toBeUndefined(); // Not added until async resolution
    });

    it("should detect bare domain as NIP-05", () => {
      const result = parseCountCommand(["-a", "fiatjaf.com"]);
      expect(result.nip05Authors).toEqual(["fiatjaf.com"]);
    });

    it("should detect NIP-05 in #p tags", () => {
      const result = parseCountCommand(["-p", "user@domain.com"]);
      expect(result.nip05PTags).toEqual(["user@domain.com"]);
    });

    it("should detect NIP-05 in #P tags", () => {
      const result = parseCountCommand(["-P", "user@domain.com"]);
      expect(result.nip05PTagsUppercase).toEqual(["user@domain.com"]);
    });
  });

  describe("complex queries", () => {
    it("should parse follower count query", () => {
      const pubkey =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const result = parseCountCommand(["-k", "3", "-p", pubkey]);
      expect(result.filter).toMatchObject({
        kinds: [3],
        "#p": [pubkey],
      });
    });

    it("should parse my notes count query", () => {
      const result = parseCountCommand(["-k", "1", "-a", "$me"]);
      expect(result.filter).toMatchObject({
        kinds: [1],
        authors: ["$me"],
      });
      expect(result.needsAccount).toBe(true);
    });

    it("should parse recent zaps query", () => {
      const result = parseCountCommand([
        "-k",
        "9735",
        "-p",
        "$me",
        "--since",
        "7d",
      ]);
      expect(result.filter.kinds).toEqual([9735]);
      expect(result.filter["#p"]).toEqual(["$me"]);
      expect(result.filter.since).toBeDefined();
      expect(result.needsAccount).toBe(true);
    });

    it("should parse tagged events count", () => {
      const result = parseCountCommand(["-t", "nostr,bitcoin", "-k", "1"]);
      expect(result.filter).toMatchObject({
        kinds: [1],
        "#t": ["nostr", "bitcoin"],
      });
    });

    it("should parse search count query", () => {
      const result = parseCountCommand(["--search", "bitcoin", "-k", "1"]);
      expect(result.filter).toMatchObject({
        kinds: [1],
        search: "bitcoin",
      });
    });
  });

  describe("edge cases", () => {
    it("should handle empty args", () => {
      const result = parseCountCommand([]);
      expect(result.filter).toEqual({});
    });

    it("should handle invalid kind", () => {
      const result = parseCountCommand(["-k", "invalid"]);
      expect(result.filter.kinds).toBeUndefined();
    });

    it("should deduplicate kinds", () => {
      const result = parseCountCommand(["-k", "1,3,1,3"]);
      expect(result.filter.kinds).toEqual([1, 3]);
    });

    it("should deduplicate authors", () => {
      const pubkey =
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
      const result = parseCountCommand(["-a", `${pubkey},${pubkey}`]);
      expect(result.filter.authors).toEqual([pubkey]);
    });

    it("should handle mixed case $me", () => {
      const result = parseCountCommand(["-a", "$ME"]);
      expect(result.filter.authors).toEqual(["$me"]); // Normalized to lowercase
    });
  });

  describe("REQ-specific options should be ignored", () => {
    it("should not include view mode", () => {
      const result = parseCountCommand(["-k", "1", "--view", "compact"]);
      expect(result).not.toHaveProperty("view");
    });

    it("should not include closeOnEose", () => {
      const result = parseCountCommand(["-k", "1", "--close-on-eose"]);
      expect(result).not.toHaveProperty("closeOnEose");
    });
  });
});
