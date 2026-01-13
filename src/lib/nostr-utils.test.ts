import { describe, it, expect } from "vitest";
import { resolveFilterAliases } from "./nostr-utils";
import type { NostrFilter } from "@/types/nostr";

describe("resolveFilterAliases", () => {
  describe("$me alias resolution", () => {
    it("should replace $me with account pubkey in authors", () => {
      const filter: NostrFilter = { authors: ["$me"] };
      const accountPubkey = "a".repeat(64);
      const result = resolveFilterAliases(filter, accountPubkey, []);

      expect(result.authors).toEqual([accountPubkey]);
      expect(result.authors).not.toContain("$me");
    });

    it("should replace $me with account pubkey in #p tags", () => {
      const filter: NostrFilter = { "#p": ["$me"] };
      const accountPubkey = "a".repeat(64);
      const result = resolveFilterAliases(filter, accountPubkey, []);

      expect(result["#p"]).toEqual([accountPubkey]);
      expect(result["#p"]).not.toContain("$me");
    });

    it("should handle $me when no account is set", () => {
      const filter: NostrFilter = { authors: ["$me"] };
      const result = resolveFilterAliases(filter, undefined, []);

      expect(result.authors).toEqual([]);
    });

    it("should preserve other pubkeys when resolving $me", () => {
      const hex = "b".repeat(64);
      const filter: NostrFilter = { authors: ["$me", hex] };
      const accountPubkey = "a".repeat(64);
      const result = resolveFilterAliases(filter, accountPubkey, []);

      expect(result.authors).toContain(accountPubkey);
      expect(result.authors).toContain(hex);
      expect(result.authors).not.toContain("$me");
    });
  });

  describe("$contacts alias resolution", () => {
    it("should replace $contacts with contact pubkeys in authors", () => {
      const filter: NostrFilter = { authors: ["$contacts"] };
      const contacts = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
      const result = resolveFilterAliases(filter, undefined, contacts);

      expect(result.authors).toEqual(contacts);
      expect(result.authors).not.toContain("$contacts");
    });

    it("should replace $contacts with contact pubkeys in #p tags", () => {
      const filter: NostrFilter = { "#p": ["$contacts"] };
      const contacts = ["a".repeat(64), "b".repeat(64)];
      const result = resolveFilterAliases(filter, undefined, contacts);

      expect(result["#p"]).toEqual(contacts);
      expect(result["#p"]).not.toContain("$contacts");
    });

    it("should handle $contacts with empty contact list", () => {
      const filter: NostrFilter = { authors: ["$contacts"] };
      const result = resolveFilterAliases(filter, undefined, []);

      expect(result.authors).toEqual([]);
    });

    it("should preserve other pubkeys when resolving $contacts", () => {
      const hex = "d".repeat(64);
      const filter: NostrFilter = { authors: ["$contacts", hex] };
      const contacts = ["a".repeat(64), "b".repeat(64)];
      const result = resolveFilterAliases(filter, undefined, contacts);

      expect(result.authors).toContain(hex);
      expect(result.authors).toContain(contacts[0]);
      expect(result.authors).toContain(contacts[1]);
      expect(result.authors).not.toContain("$contacts");
    });
  });

  describe("combined $me and $contacts", () => {
    it("should resolve both $me and $contacts in authors", () => {
      const filter: NostrFilter = { authors: ["$me", "$contacts"] };
      const accountPubkey = "a".repeat(64);
      const contacts = ["b".repeat(64), "c".repeat(64)];
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      expect(result.authors).toContain(accountPubkey);
      expect(result.authors).toContain(contacts[0]);
      expect(result.authors).toContain(contacts[1]);
      expect(result.authors).not.toContain("$me");
      expect(result.authors).not.toContain("$contacts");
    });

    it("should resolve aliases in both authors and #p tags", () => {
      const filter: NostrFilter = {
        authors: ["$me"],
        "#p": ["$contacts"],
      };
      const accountPubkey = "a".repeat(64);
      const contacts = ["b".repeat(64), "c".repeat(64)];
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      expect(result.authors).toEqual([accountPubkey]);
      expect(result["#p"]).toEqual(contacts);
    });

    it("should handle mix of aliases and regular pubkeys", () => {
      const hex1 = "d".repeat(64);
      const hex2 = "e".repeat(64);
      const filter: NostrFilter = {
        authors: ["$me", hex1, "$contacts"],
        "#p": [hex2, "$me"],
      };
      const accountPubkey = "a".repeat(64);
      const contacts = ["b".repeat(64), "c".repeat(64)];
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      expect(result.authors).toContain(accountPubkey);
      expect(result.authors).toContain(hex1);
      expect(result.authors).toContain(contacts[0]);
      expect(result.authors).toContain(contacts[1]);
      expect(result["#p"]).toContain(hex2);
      expect(result["#p"]).toContain(accountPubkey);
    });
  });

  describe("deduplication", () => {
    it("should deduplicate when $me is in contacts", () => {
      const accountPubkey = "a".repeat(64);
      const contacts = [accountPubkey, "b".repeat(64), "c".repeat(64)];
      const filter: NostrFilter = { authors: ["$me", "$contacts"] };
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      // Account pubkey should appear once (deduplicated)
      const accountCount = result.authors?.filter(
        (a) => a === accountPubkey,
      ).length;
      expect(accountCount).toBe(1);
      expect(result.authors?.length).toBe(3); // account + 2 other contacts
    });

    it("should deduplicate regular pubkeys that appear multiple times", () => {
      const hex = "d".repeat(64);
      const filter: NostrFilter = { authors: [hex, hex, hex] };
      const result = resolveFilterAliases(filter, undefined, []);

      expect(result.authors).toEqual([hex]);
    });

    it("should deduplicate across resolved contacts and explicit pubkeys", () => {
      const hex1 = "a".repeat(64);
      const hex2 = "b".repeat(64);
      const contacts = [hex1, hex2, "c".repeat(64)];
      const filter: NostrFilter = { authors: ["$contacts", hex1, hex2] };
      const result = resolveFilterAliases(filter, undefined, contacts);

      // Each pubkey should appear once
      expect(result.authors?.filter((a) => a === hex1).length).toBe(1);
      expect(result.authors?.filter((a) => a === hex2).length).toBe(1);
      expect(result.authors?.length).toBe(3); // 3 unique contacts
    });
  });

  describe("filter preservation", () => {
    it("should preserve other filter properties", () => {
      const filter: NostrFilter = {
        authors: ["$me"],
        kinds: [1, 3, 7],
        limit: 50,
        since: 1234567890,
        "#t": ["nostr", "bitcoin"],
      };
      const accountPubkey = "a".repeat(64);
      const result = resolveFilterAliases(filter, accountPubkey, []);

      expect(result.kinds).toEqual([1, 3, 7]);
      expect(result.limit).toBe(50);
      expect(result.since).toBe(1234567890);
      expect(result["#t"]).toEqual(["nostr", "bitcoin"]);
    });

    it("should not modify original filter", () => {
      const filter: NostrFilter = { authors: ["$me"] };
      const accountPubkey = "a".repeat(64);
      resolveFilterAliases(filter, accountPubkey, []);

      // Original filter should still have $me
      expect(filter.authors).toContain("$me");
    });

    it("should handle filters without aliases", () => {
      const hex = "a".repeat(64);
      const filter: NostrFilter = {
        authors: [hex],
        kinds: [1],
      };
      const result = resolveFilterAliases(filter, "b".repeat(64), []);

      expect(result.authors).toEqual([hex]);
      expect(result.kinds).toEqual([1]);
    });

    it("should handle empty filter", () => {
      const filter: NostrFilter = {};
      const result = resolveFilterAliases(filter, "a".repeat(64), []);

      expect(result).toEqual({});
    });
  });

  describe("edge cases", () => {
    it("should handle undefined authors array", () => {
      const filter: NostrFilter = { kinds: [1] };
      const result = resolveFilterAliases(filter, "a".repeat(64), []);

      expect(result.authors).toBeUndefined();
    });

    it("should handle undefined #p array", () => {
      const filter: NostrFilter = { authors: ["$me"] };
      const accountPubkey = "a".repeat(64);
      const result = resolveFilterAliases(filter, accountPubkey, []);

      expect(result["#p"]).toBeUndefined();
    });

    it("should handle large contact lists", () => {
      const contacts = Array.from({ length: 5000 }, (_, i) =>
        i.toString(16).padStart(64, "0"),
      );
      const filter: NostrFilter = { authors: ["$contacts"] };
      const result = resolveFilterAliases(filter, undefined, contacts);

      expect(result.authors?.length).toBe(5000);
    });

    it("should handle mixed case aliases (case-insensitive)", () => {
      // Aliases are case-insensitive for user convenience
      const accountPubkey = "a".repeat(64);
      const contacts = ["b".repeat(64), "c".repeat(64)];
      const filter: NostrFilter = { authors: ["$Me", "$CONTACTS"] };
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      // These should be resolved despite case differences
      expect(result.authors).toContain(accountPubkey);
      expect(result.authors).toContain(contacts[0]);
      expect(result.authors).toContain(contacts[1]);
      expect(result.authors).not.toContain("$Me");
      expect(result.authors).not.toContain("$CONTACTS");
    });
  });

  describe("case-insensitive alias resolution", () => {
    it("should resolve $ME (uppercase) in authors", () => {
      const filter: NostrFilter = { authors: ["$ME"] };
      const accountPubkey = "a".repeat(64);
      const result = resolveFilterAliases(filter, accountPubkey, []);

      expect(result.authors).toEqual([accountPubkey]);
      expect(result.authors).not.toContain("$ME");
    });

    it("should resolve $Me (mixed case) in #p tags", () => {
      const filter: NostrFilter = { "#p": ["$Me"] };
      const accountPubkey = "a".repeat(64);
      const result = resolveFilterAliases(filter, accountPubkey, []);

      expect(result["#p"]).toEqual([accountPubkey]);
      expect(result["#p"]).not.toContain("$Me");
    });

    it("should resolve $CONTACTS (uppercase) in authors", () => {
      const filter: NostrFilter = { authors: ["$CONTACTS"] };
      const contacts = ["a".repeat(64), "b".repeat(64)];
      const result = resolveFilterAliases(filter, undefined, contacts);

      expect(result.authors).toEqual(contacts);
      expect(result.authors).not.toContain("$CONTACTS");
    });

    it("should resolve $Contacts (mixed case) in #P tags", () => {
      const filter: NostrFilter = { "#P": ["$Contacts"] };
      const contacts = ["a".repeat(64), "b".repeat(64)];
      const result = resolveFilterAliases(filter, undefined, contacts);

      expect(result["#P"]).toEqual(contacts);
      expect(result["#P"]).not.toContain("$Contacts");
    });

    it("should handle multiple case variations in same filter", () => {
      const filter: NostrFilter = {
        authors: ["$me", "$ME", "$Me"],
        "#p": ["$contacts", "$CONTACTS", "$Contacts"],
      };
      const accountPubkey = "a".repeat(64);
      const contacts = ["b".repeat(64), "c".repeat(64)];
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      // Should deduplicate all variants of $me to single pubkey
      expect(result.authors).toEqual([accountPubkey]);
      // Should deduplicate all variants of $contacts
      expect(result["#p"]).toEqual(contacts);
    });

    it("should handle sloppy typing with whitespace-like patterns", () => {
      const filter: NostrFilter = {
        authors: ["$ME", "$me", "$Me"],
        "#P": ["$CONTACTS", "$contacts", "$Contacts"],
      };
      const accountPubkey = "a".repeat(64);
      const contacts = ["b".repeat(64), "c".repeat(64)];
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      expect(result.authors?.length).toBe(1);
      expect(result.authors).toContain(accountPubkey);
      expect(result["#P"]).toEqual(contacts);
    });
  });

  describe("uppercase #P tag resolution", () => {
    it("should replace $me with account pubkey in #P tags", () => {
      const filter: NostrFilter = { "#P": ["$me"] };
      const accountPubkey = "a".repeat(64);
      const result = resolveFilterAliases(filter, accountPubkey, []);

      expect(result["#P"]).toEqual([accountPubkey]);
      expect(result["#P"]).not.toContain("$me");
    });

    it("should replace $contacts with contact pubkeys in #P tags", () => {
      const filter: NostrFilter = { "#P": ["$contacts"] };
      const contacts = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
      const result = resolveFilterAliases(filter, undefined, contacts);

      expect(result["#P"]).toEqual(contacts);
      expect(result["#P"]).not.toContain("$contacts");
    });

    it("should handle $me when no account is set in #P", () => {
      const filter: NostrFilter = { "#P": ["$me"] };
      const result = resolveFilterAliases(filter, undefined, []);

      expect(result["#P"]).toEqual([]);
    });

    it("should preserve other pubkeys when resolving $me in #P", () => {
      const hex = "b".repeat(64);
      const filter: NostrFilter = { "#P": ["$me", hex] };
      const accountPubkey = "a".repeat(64);
      const result = resolveFilterAliases(filter, accountPubkey, []);

      expect(result["#P"]).toContain(accountPubkey);
      expect(result["#P"]).toContain(hex);
      expect(result["#P"]).not.toContain("$me");
    });

    it("should handle mix of $me, $contacts, and regular pubkeys in #P", () => {
      const hex1 = "d".repeat(64);
      const filter: NostrFilter = { "#P": ["$me", hex1, "$contacts"] };
      const accountPubkey = "a".repeat(64);
      const contacts = ["b".repeat(64), "c".repeat(64)];
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      expect(result["#P"]).toContain(accountPubkey);
      expect(result["#P"]).toContain(hex1);
      expect(result["#P"]).toContain(contacts[0]);
      expect(result["#P"]).toContain(contacts[1]);
    });

    it("should deduplicate when $me is in contacts for #P", () => {
      const accountPubkey = "a".repeat(64);
      const contacts = [accountPubkey, "b".repeat(64), "c".repeat(64)];
      const filter: NostrFilter = { "#P": ["$me", "$contacts"] };
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      // Account pubkey should appear once (deduplicated)
      const accountCount = result["#P"]?.filter(
        (a) => a === accountPubkey,
      ).length;
      expect(accountCount).toBe(1);
      expect(result["#P"]?.length).toBe(3); // account + 2 other contacts
    });
  });

  describe("mixed #p and #P tag resolution", () => {
    it("should resolve aliases in both #p and #P independently", () => {
      const filter: NostrFilter = {
        "#p": ["$me"],
        "#P": ["$contacts"],
      };
      const accountPubkey = "a".repeat(64);
      const contacts = ["b".repeat(64), "c".repeat(64)];
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      expect(result["#p"]).toEqual([accountPubkey]);
      expect(result["#P"]).toEqual(contacts);
    });

    it("should handle same aliases in both tags without interference", () => {
      const filter: NostrFilter = {
        "#p": ["$me", "$contacts"],
        "#P": ["$me", "$contacts"],
      };
      const accountPubkey = "a".repeat(64);
      const contacts = ["b".repeat(64), "c".repeat(64)];
      const result = resolveFilterAliases(filter, accountPubkey, contacts);

      // Both should have same resolved values
      expect(result["#p"]).toContain(accountPubkey);
      expect(result["#p"]).toContain(contacts[0]);
      expect(result["#p"]).toContain(contacts[1]);
      expect(result["#P"]).toContain(accountPubkey);
      expect(result["#P"]).toContain(contacts[0]);
      expect(result["#P"]).toContain(contacts[1]);
    });
  });

  describe("$hashtags alias resolution", () => {
    it("should replace $hashtags with hashtag list in #t", () => {
      const filter: NostrFilter = { "#t": ["$hashtags"] };
      const hashtags = ["nostr", "bitcoin", "lightning"];
      const result = resolveFilterAliases(filter, undefined, [], { hashtags });

      expect(result["#t"]).toEqual(hashtags);
      expect(result["#t"]).not.toContain("$hashtags");
    });

    it("should remove #t from filter when $hashtags resolves to empty", () => {
      const filter: NostrFilter = { "#t": ["$hashtags"] };
      const result = resolveFilterAliases(filter, undefined, [], {
        hashtags: [],
      });

      // Empty #t should be removed from filter entirely
      expect(result["#t"]).toBeUndefined();
    });

    it("should preserve other hashtags when $hashtags resolves to empty", () => {
      const filter: NostrFilter = { "#t": ["$hashtags", "nostr", "bitcoin"] };
      const result = resolveFilterAliases(filter, undefined, [], {
        hashtags: [],
      });

      // Other hashtags should be preserved
      expect(result["#t"]).toEqual(["nostr", "bitcoin"]);
    });

    it("should preserve other hashtags when resolving $hashtags", () => {
      const filter: NostrFilter = { "#t": ["$hashtags", "zaps", "dev"] };
      const hashtags = ["nostr", "bitcoin"];
      const result = resolveFilterAliases(filter, undefined, [], { hashtags });

      expect(result["#t"]).toContain("nostr");
      expect(result["#t"]).toContain("bitcoin");
      expect(result["#t"]).toContain("zaps");
      expect(result["#t"]).toContain("dev");
      expect(result["#t"]).not.toContain("$hashtags");
    });

    it("should deduplicate hashtags", () => {
      const filter: NostrFilter = { "#t": ["$hashtags", "nostr"] };
      const hashtags = ["nostr", "bitcoin", "nostr"]; // nostr appears in both
      const result = resolveFilterAliases(filter, undefined, [], { hashtags });

      const nostrCount = result["#t"]?.filter((t) => t === "nostr").length;
      expect(nostrCount).toBe(1);
    });

    it("should handle case-insensitive $HASHTAGS alias", () => {
      const filter: NostrFilter = { "#t": ["$HASHTAGS"] };
      const hashtags = ["nostr", "bitcoin"];
      const result = resolveFilterAliases(filter, undefined, [], { hashtags });

      expect(result["#t"]).toEqual(hashtags);
      expect(result["#t"]).not.toContain("$HASHTAGS");
    });

    it("should handle mixed case $Hashtags alias", () => {
      const filter: NostrFilter = { "#t": ["$Hashtags"] };
      const hashtags = ["nostr", "bitcoin"];
      const result = resolveFilterAliases(filter, undefined, [], { hashtags });

      expect(result["#t"]).toEqual(hashtags);
      expect(result["#t"]).not.toContain("$Hashtags");
    });
  });

  describe("combined $me, $contacts, and $hashtags", () => {
    it("should resolve all aliases in same filter", () => {
      const filter: NostrFilter = {
        authors: ["$me", "$contacts"],
        "#t": ["$hashtags"],
      };
      const accountPubkey = "a".repeat(64);
      const contacts = ["b".repeat(64), "c".repeat(64)];
      const hashtags = ["nostr", "bitcoin"];
      const result = resolveFilterAliases(filter, accountPubkey, contacts, {
        hashtags,
      });

      expect(result.authors).toContain(accountPubkey);
      expect(result.authors).toContain(contacts[0]);
      expect(result.authors).toContain(contacts[1]);
      expect(result["#t"]).toEqual(hashtags);
    });

    it("should work with new options-based signature", () => {
      const filter: NostrFilter = {
        authors: ["$me"],
        "#t": ["$hashtags"],
      };
      const result = resolveFilterAliases(filter, {
        accountPubkey: "a".repeat(64),
        contacts: ["b".repeat(64)],
        hashtags: ["nostr", "bitcoin"],
      });

      expect(result.authors).toEqual(["a".repeat(64)]);
      expect(result["#t"]).toEqual(["nostr", "bitcoin"]);
    });

    it("should handle missing hashtags option gracefully", () => {
      const filter: NostrFilter = {
        authors: ["$me"],
        "#t": ["$hashtags"],
      };
      const accountPubkey = "a".repeat(64);
      const result = resolveFilterAliases(filter, accountPubkey, []);

      expect(result.authors).toEqual([accountPubkey]);
      // Empty #t should be removed from filter entirely
      expect(result["#t"]).toBeUndefined();
    });
  });

  describe("options-based signature", () => {
    it("should work with options object as second parameter", () => {
      const filter: NostrFilter = {
        authors: ["$me"],
        "#p": ["$contacts"],
        "#t": ["$hashtags"],
      };
      const result = resolveFilterAliases(filter, {
        accountPubkey: "a".repeat(64),
        contacts: ["b".repeat(64), "c".repeat(64)],
        hashtags: ["nostr", "bitcoin"],
      });

      expect(result.authors).toEqual(["a".repeat(64)]);
      expect(result["#p"]).toEqual(["b".repeat(64), "c".repeat(64)]);
      expect(result["#t"]).toEqual(["nostr", "bitcoin"]);
    });

    it("should handle undefined values in options", () => {
      const filter: NostrFilter = { authors: ["$me"] };
      const result = resolveFilterAliases(filter, {});

      expect(result.authors).toEqual([]);
    });
  });
});
