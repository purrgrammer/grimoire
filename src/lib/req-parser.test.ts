import { describe, it, expect } from "vitest";
import { parseReqCommand } from "./req-parser";
import { nip19 } from "nostr-tools";

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

    it("should parse npub", () => {
      // Real npub for pubkey: 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d
      const npub =
        "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
      const result = parseReqCommand(["-a", npub]);
      expect(result.filter.authors).toEqual([
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      ]);
    });

    it("should parse nprofile", () => {
      // Real nprofile for same pubkey with relay hints
      const nprofile =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const result = parseReqCommand(["-a", nprofile]);
      expect(result.filter.authors).toEqual([
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      ]);
    });

    it("should extract and normalize relay hints from nprofile in -a flag", () => {
      // nprofile with relay hints
      const nprofile =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const result = parseReqCommand(["-a", nprofile]);
      // Relay hints should be normalized (lowercase, trailing slash)
      expect(result.relays).toContain("wss://r.x.com/");
      expect(result.relays).toContain("wss://djbas.sadkb.com/");
    });

    it("should combine explicit relays with nprofile relay hints and normalize all", () => {
      const nprofile =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const result = parseReqCommand(["-a", nprofile, "wss://relay.damus.io"]);
      // All relays should be normalized
      expect(result.relays).toEqual([
        "wss://r.x.com/",
        "wss://djbas.sadkb.com/",
        "wss://relay.damus.io/",
      ]);
    });

    it("should extract relays from comma-separated nprofiles", () => {
      const nprofile1 =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const nprofile2 =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const result = parseReqCommand(["-a", `${nprofile1},${nprofile2}`]);
      // Should get normalized relays from both (even though they're duplicates in this test)
      expect(result.relays).toContain("wss://r.x.com/");
      expect(result.relays).toContain("wss://djbas.sadkb.com/");
    });

    it("should parse comma-separated hex pubkeys", () => {
      const hex1 = "a".repeat(64);
      const hex2 = "b".repeat(64);
      const result = parseReqCommand(["-a", `${hex1},${hex2}`]);
      expect(result.filter.authors).toEqual([hex1, hex2]);
    });

    it("should parse comma-separated mix of npub and nprofile", () => {
      const npub =
        "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
      const nprofile =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const result = parseReqCommand(["-a", `${npub},${nprofile}`]);
      // Both should decode to the same pubkey, so should be deduplicated
      expect(result.filter.authors).toEqual([
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      ]);
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

    it("should handle mixed hex, npub, nprofile, and NIP-05", () => {
      const hex = "a".repeat(64);
      const npub =
        "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
      const result = parseReqCommand(["-a", `${hex},${npub},user@domain.com`]);
      expect(result.filter.authors).toEqual([
        hex,
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      ]);
      expect(result.nip05Authors).toEqual(["user@domain.com"]);
    });

    it("should deduplicate NIP-05 identifiers", () => {
      const result = parseReqCommand(["-a", "user@domain.com,user@domain.com"]);
      expect(result.nip05Authors).toEqual(["user@domain.com"]);
    });

    it("should accumulate @domain syntax for async resolution", () => {
      const result = parseReqCommand(["-a", "@habla.news"]);
      expect(result.domainAuthors).toEqual(["habla.news"]);
      expect(result.filter.authors).toBeUndefined();
    });

    it("should accumulate multiple @domains for async resolution", () => {
      const result = parseReqCommand(["-a", "@habla.news,@nostr.com"]);
      expect(result.domainAuthors).toEqual(["habla.news", "nostr.com"]);
      expect(result.filter.authors).toBeUndefined();
    });

    it("should handle mixed hex, NIP-05, and @domain", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand([
        "-a",
        `${hex},user@domain.com,@habla.news`,
      ]);
      expect(result.filter.authors).toEqual([hex]);
      expect(result.nip05Authors).toEqual(["user@domain.com"]);
      expect(result.domainAuthors).toEqual(["habla.news"]);
    });

    it("should deduplicate @domain identifiers", () => {
      const result = parseReqCommand(["-a", "@habla.news,@habla.news"]);
      expect(result.domainAuthors).toEqual(["habla.news"]);
    });

    it("should preserve @domain case (normalization happens in resolution)", () => {
      const result = parseReqCommand(["-a", "@Habla.News"]);
      expect(result.domainAuthors).toEqual(["Habla.News"]);
    });

    it("should reject invalid @domain formats", () => {
      const result = parseReqCommand(["-a", "@invalid"]);
      expect(result.domainAuthors).toBeUndefined();
      expect(result.filter.authors).toBeUndefined();
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

  describe("event ID flag (-e) with nevent/naddr support", () => {
    describe("nevent support (tag filtering)", () => {
      it("should parse nevent and populate filter['#e'] (tag filtering)", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent = nip19.neventEncode({
          id: eventId,
        });
        const result = parseReqCommand(["-e", nevent]);

        expect(result.filter["#e"]).toBeDefined();
        expect(result.filter["#e"]).toHaveLength(1);
        expect(result.filter["#e"]).toEqual([eventId]);
        expect(result.filter.ids).toBeUndefined();
      });

      it("should extract relay hints from nevent", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent = nip19.neventEncode({
          id: eventId,
          relays: ["wss://relay.damus.io"],
        });
        const result = parseReqCommand(["-e", nevent]);

        expect(result.relays).toBeDefined();
        expect(result.relays).toContain("wss://relay.damus.io/");
      });

      it("should normalize relay URLs from nevent", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent = nip19.neventEncode({
          id: eventId,
          relays: ["wss://relay.damus.io"],
        });
        const result = parseReqCommand(["-e", nevent]);

        result.relays?.forEach((url) => {
          expect(url).toMatch(/^wss?:\/\//);
          expect(url).toMatch(/\/$/); // trailing slash
        });
      });

      it("should handle nevent without relay hints", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent = nip19.neventEncode({
          id: eventId,
        });
        const result = parseReqCommand(["-e", nevent]);

        expect(result.filter["#e"]).toHaveLength(1);
        expect(result.relays).toBeUndefined();
      });
    });

    describe("naddr support", () => {
      it("should parse naddr and populate filter['#a']", () => {
        const pubkey =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: pubkey,
          identifier: "test-article",
        });
        const result = parseReqCommand(["-e", naddr]);

        expect(result.filter["#a"]).toBeDefined();
        expect(result.filter["#a"]).toHaveLength(1);
        expect(result.filter["#a"]?.[0]).toBe(`30023:${pubkey}:test-article`);
      });

      it("should extract relay hints from naddr", () => {
        const pubkey =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: pubkey,
          identifier: "test-article",
          relays: ["wss://relay.damus.io", "wss://nos.lol"],
        });
        const result = parseReqCommand(["-e", naddr]);

        expect(result.relays).toBeDefined();
        expect(result.relays!.length).toBe(2);
        expect(result.relays).toContain("wss://relay.damus.io/");
        expect(result.relays).toContain("wss://nos.lol/");
      });

      it("should format coordinate correctly (kind:pubkey:identifier)", () => {
        const pubkey =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: pubkey,
          identifier: "test-article",
        });
        const result = parseReqCommand(["-e", naddr]);

        const coordinate = result.filter["#a"]?.[0];
        expect(coordinate).toBe(`30023:${pubkey}:test-article`);
        // Validate format: kind:pubkey:identifier
        const parts = coordinate?.split(":");
        expect(parts).toHaveLength(3);
        expect(parseInt(parts![0])).toBe(30023);
        expect(parts![1]).toBe(pubkey);
        expect(parts![2]).toBe("test-article");
      });

      it("should handle naddr without relay hints", () => {
        const pubkey =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: pubkey,
          identifier: "test-article",
        });
        const result = parseReqCommand(["-e", naddr]);

        expect(result.filter["#a"]).toHaveLength(1);
        expect(result.relays).toBeUndefined();
      });
    });

    describe("note/hex support (existing behavior)", () => {
      it("should parse note and populate filter['#e']", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const note = nip19.noteEncode(eventId);
        const result = parseReqCommand(["-e", note]);

        expect(result.filter["#e"]).toBeDefined();
        expect(result.filter["#e"]).toHaveLength(1);
        expect(result.filter["#e"]).toContain(eventId);
        expect(result.filter.ids).toBeUndefined();
        expect(result.filter["#a"]).toBeUndefined();
      });

      it("should parse hex and populate filter['#e']", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-e", hex]);

        expect(result.filter["#e"]).toContain(hex);
        expect(result.filter.ids).toBeUndefined();
      });
    });

    describe("raw coordinate support (kind:pubkey:d)", () => {
      it("should parse raw coordinate and populate filter['#a']", () => {
        const pubkey = "a".repeat(64);
        const coordinate = `30023:${pubkey}:my-article`;
        const result = parseReqCommand(["-e", coordinate]);

        expect(result.filter["#a"]).toBeDefined();
        expect(result.filter["#a"]).toHaveLength(1);
        expect(result.filter["#a"]).toEqual([coordinate]);
        expect(result.filter["#e"]).toBeUndefined();
      });

      it("should normalize pubkey to lowercase", () => {
        const pubkey = "A".repeat(64);
        const coordinate = `30023:${pubkey}:my-article`;
        const result = parseReqCommand(["-e", coordinate]);

        expect(result.filter["#a"]).toEqual([
          `30023:${"a".repeat(64)}:my-article`,
        ]);
      });

      it("should handle empty d-tag identifier", () => {
        const pubkey = "a".repeat(64);
        const coordinate = `30023:${pubkey}:`;
        const result = parseReqCommand(["-e", coordinate]);

        expect(result.filter["#a"]).toEqual([coordinate]);
      });

      it("should handle d-tag with special characters", () => {
        const pubkey = "a".repeat(64);
        const coordinate = `30023:${pubkey}:my-article/with:special-chars`;
        const result = parseReqCommand(["-e", coordinate]);

        expect(result.filter["#a"]).toEqual([coordinate]);
      });

      it("should handle different kind numbers", () => {
        const pubkey = "a".repeat(64);
        const result = parseReqCommand([
          "-e",
          `0:${pubkey}:,30000:${pubkey}:list,30023:${pubkey}:article`,
        ]);

        expect(result.filter["#a"]).toHaveLength(3);
        expect(result.filter["#a"]).toContain(`0:${pubkey}:`);
        expect(result.filter["#a"]).toContain(`30000:${pubkey}:list`);
        expect(result.filter["#a"]).toContain(`30023:${pubkey}:article`);
      });

      it("should combine with naddr coordinates", () => {
        const pubkey = "a".repeat(64);
        const rawCoord = `30023:${pubkey}:raw-article`;
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: pubkey,
          identifier: "encoded-article",
        });

        const result = parseReqCommand(["-e", `${rawCoord},${naddr}`]);

        expect(result.filter["#a"]).toHaveLength(2);
        expect(result.filter["#a"]).toContain(rawCoord);
        expect(result.filter["#a"]).toContain(
          `30023:${pubkey}:encoded-article`,
        );
      });

      it("should ignore invalid coordinate formats", () => {
        // Missing parts
        const result1 = parseReqCommand(["-e", "30023:abc"]);
        expect(result1.filter["#a"]).toBeUndefined();

        // Invalid pubkey (not 64 hex chars)
        const result2 = parseReqCommand(["-e", "30023:abc123:article"]);
        expect(result2.filter["#a"]).toBeUndefined();

        // Invalid kind (not a number)
        const result3 = parseReqCommand([
          "-e",
          `abc:${"a".repeat(64)}:article`,
        ]);
        expect(result3.filter["#a"]).toBeUndefined();
      });
    });

    describe("mixed format support", () => {
      it("should handle comma-separated mix of all formats (all to tags)", () => {
        const hex = "a".repeat(64);
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const pubkey = "b".repeat(64);

        const note = nip19.noteEncode(eventId);
        const nevent = nip19.neventEncode({ id: eventId });
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: pubkey,
          identifier: "test-article",
        });

        const result = parseReqCommand([
          "-e",
          `${hex},${note},${nevent},${naddr}`,
        ]);

        // hex, note, and nevent all go to filter["#e"] (deduplicated: eventId appears twice)
        expect(result.filter["#e"]).toHaveLength(2);
        expect(result.filter["#e"]).toContain(hex);
        expect(result.filter["#e"]).toContain(eventId);

        // No direct ID lookup for -e flag
        expect(result.filter.ids).toBeUndefined();

        // naddr should go to filter["#a"]
        expect(result.filter["#a"]).toHaveLength(1);
        expect(result.filter["#a"]?.[0]).toBe(`30023:${pubkey}:test-article`);
      });

      it("should deduplicate within each filter field", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent1 = nip19.neventEncode({ id: eventId });
        const nevent2 = nip19.neventEncode({
          id: eventId,
          relays: ["wss://relay.damus.io"],
        });

        const result = parseReqCommand(["-e", `${nevent1},${nevent2}`]);

        // Both nevent decode to same event ID, should deduplicate in #e
        expect(result.filter["#e"]).toHaveLength(1);
        expect(result.filter.ids).toBeUndefined();
      });

      it("should collect relay hints from mixed formats", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const pubkey = "b".repeat(64);

        const nevent = nip19.neventEncode({
          id: eventId,
          relays: ["wss://relay.damus.io"],
        });
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: pubkey,
          identifier: "test-article",
          relays: ["wss://nos.lol"],
        });

        const result = parseReqCommand(["-e", `${nevent},${naddr}`]);

        expect(result.relays).toBeDefined();
        expect(result.relays!.length).toBe(2);
        expect(result.relays).toContain("wss://relay.damus.io/");
        expect(result.relays).toContain("wss://nos.lol/");
      });

      it("should handle multiple nevents with different relay hints", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent1 = nip19.neventEncode({
          id: eventId,
          relays: ["wss://relay.damus.io"],
        });
        const hex = "b".repeat(64);

        const result = parseReqCommand(["-e", `${nevent1},${hex}`]);

        // Both nevent and hex go to filter["#e"]
        expect(result.filter["#e"]).toHaveLength(2);
        expect(result.filter["#e"]).toContain(eventId);
        expect(result.filter["#e"]).toContain(hex);
        // No direct ID lookup for -e flag
        expect(result.filter.ids).toBeUndefined();
        // relays extracted from nevent
        expect(result.relays).toBeDefined();
        expect(result.relays).toContain("wss://relay.damus.io/");
      });
    });

    describe("error handling", () => {
      it("should ignore invalid bech32", () => {
        const result = parseReqCommand(["-e", "nevent1invalid"]);

        expect(result.filter.ids).toBeUndefined();
        expect(result.filter["#e"]).toBeUndefined();
        expect(result.filter["#a"]).toBeUndefined();
      });

      it("should ignore invalid naddr", () => {
        const result = parseReqCommand(["-e", "naddr1invalid"]);

        expect(result.filter["#a"]).toBeUndefined();
      });

      it("should skip empty values in comma-separated list", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-e", `${hex},,`]);

        expect(result.filter["#e"]).toEqual([hex]);
      });

      it("should continue parsing after encountering invalid values", () => {
        const hex1 = "a".repeat(64);
        const hex2 = "b".repeat(64);
        const result = parseReqCommand([
          "-e",
          `${hex1},invalid_bech32,${hex2}`,
        ]);

        expect(result.filter["#e"]).toEqual([hex1, hex2]);
      });
    });

    describe("integration with other flags", () => {
      it("should work with kind filter", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent = nip19.neventEncode({ id: eventId });
        const result = parseReqCommand(["-k", "1", "-e", nevent]);

        expect(result.filter.kinds).toEqual([1]);
        expect(result.filter["#e"]).toHaveLength(1);
        expect(result.filter.ids).toBeUndefined();
      });

      it("should work with explicit relays", () => {
        const pubkey = "b".repeat(64);
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: pubkey,
          identifier: "test-article",
        });
        const result = parseReqCommand([
          "-e",
          naddr,
          "wss://relay.example.com",
        ]);

        expect(result.filter["#a"]).toHaveLength(1);
        expect(result.relays).toContain("wss://relay.example.com/");
      });

      it("should work with author and time filters", () => {
        const hex = "c".repeat(64);
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent = nip19.neventEncode({ id: eventId });
        const result = parseReqCommand([
          "-k",
          "1",
          "-a",
          hex,
          "-e",
          nevent,
          "--since",
          "24h",
          "-l",
          "50",
        ]);

        expect(result.filter.kinds).toEqual([1]);
        expect(result.filter.authors).toEqual([hex]);
        expect(result.filter["#e"]).toHaveLength(1);
        expect(result.filter.ids).toBeUndefined();
        expect(result.filter.since).toBeDefined();
        expect(result.filter.limit).toBe(50);
      });
    });
  });

  describe("direct ID lookup flag (-i, --id)", () => {
    describe("basic parsing", () => {
      it("should parse hex event ID to filter.ids", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-i", hex]);
        expect(result.filter.ids).toEqual([hex]);
      });

      it("should parse note to filter.ids", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const note = nip19.noteEncode(eventId);
        const result = parseReqCommand(["-i", note]);
        expect(result.filter.ids).toEqual([eventId]);
      });

      it("should parse nevent to filter.ids", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent = nip19.neventEncode({ id: eventId });
        const result = parseReqCommand(["-i", nevent]);
        expect(result.filter.ids).toEqual([eventId]);
      });

      it("should handle --id long form", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["--id", hex]);
        expect(result.filter.ids).toEqual([hex]);
      });
    });

    describe("comma-separated values", () => {
      it("should parse comma-separated hex IDs", () => {
        const hex1 = "a".repeat(64);
        const hex2 = "b".repeat(64);
        const result = parseReqCommand(["-i", `${hex1},${hex2}`]);
        expect(result.filter.ids).toEqual([hex1, hex2]);
      });

      it("should parse comma-separated mixed formats", () => {
        const hex = "a".repeat(64);
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const note = nip19.noteEncode(eventId);
        const nevent = nip19.neventEncode({ id: eventId });

        const result = parseReqCommand(["-i", `${hex},${note},${nevent}`]);

        // hex is unique, note and nevent decode to same eventId (deduplicated)
        expect(result.filter.ids).toHaveLength(2);
        expect(result.filter.ids).toContain(hex);
        expect(result.filter.ids).toContain(eventId);
      });

      it("should deduplicate IDs", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-i", `${hex},${hex}`]);
        expect(result.filter.ids).toEqual([hex]);
      });
    });

    describe("relay hints", () => {
      it("should extract relay hints from nevent", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent = nip19.neventEncode({
          id: eventId,
          relays: ["wss://relay.damus.io"],
        });
        const result = parseReqCommand(["-i", nevent]);

        expect(result.filter.ids).toEqual([eventId]);
        expect(result.relays).toBeDefined();
        expect(result.relays).toContain("wss://relay.damus.io/");
      });

      it("should normalize relay URLs from nevent", () => {
        const eventId =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const nevent = nip19.neventEncode({
          id: eventId,
          relays: ["wss://relay.damus.io"],
        });
        const result = parseReqCommand(["-i", nevent]);

        result.relays?.forEach((url) => {
          expect(url).toMatch(/^wss?:\/\//);
          expect(url).toMatch(/\/$/);
        });
      });

      it("should collect relay hints from multiple nevents", () => {
        const eventId1 =
          "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
        const eventId2 = "b".repeat(64);
        const nevent1 = nip19.neventEncode({
          id: eventId1,
          relays: ["wss://relay.damus.io"],
        });
        const nevent2 = nip19.neventEncode({
          id: eventId2,
          relays: ["wss://nos.lol"],
        });

        const result = parseReqCommand(["-i", `${nevent1},${nevent2}`]);

        expect(result.relays).toBeDefined();
        expect(result.relays).toContain("wss://relay.damus.io/");
        expect(result.relays).toContain("wss://nos.lol/");
      });
    });

    describe("error handling", () => {
      it("should ignore invalid bech32", () => {
        const result = parseReqCommand(["-i", "note1invalid"]);
        expect(result.filter.ids).toBeUndefined();
      });

      it("should ignore invalid nevent", () => {
        const result = parseReqCommand(["-i", "nevent1invalid"]);
        expect(result.filter.ids).toBeUndefined();
      });

      it("should ignore naddr (not valid for direct ID lookup)", () => {
        const pubkey = "b".repeat(64);
        const naddr = nip19.naddrEncode({
          kind: 30023,
          pubkey: pubkey,
          identifier: "test-article",
        });
        const result = parseReqCommand(["-i", naddr]);
        expect(result.filter.ids).toBeUndefined();
      });

      it("should skip empty values", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-i", `${hex},,`]);
        expect(result.filter.ids).toEqual([hex]);
      });

      it("should continue parsing after invalid values", () => {
        const hex1 = "a".repeat(64);
        const hex2 = "b".repeat(64);
        const result = parseReqCommand(["-i", `${hex1},invalid,${hex2}`]);
        expect(result.filter.ids).toEqual([hex1, hex2]);
      });
    });

    describe("integration with other flags", () => {
      it("should work alongside -e flag (both IDs and tags)", () => {
        const directId = "a".repeat(64);
        const tagEventId = "b".repeat(64);

        const result = parseReqCommand(["-i", directId, "-e", tagEventId]);

        expect(result.filter.ids).toEqual([directId]);
        expect(result.filter["#e"]).toEqual([tagEventId]);
      });

      it("should work with kind and limit", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-i", hex, "-k", "1", "-l", "10"]);

        expect(result.filter.ids).toEqual([hex]);
        expect(result.filter.kinds).toEqual([1]);
        expect(result.filter.limit).toBe(10);
      });

      it("should work with relays", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-i", hex, "wss://relay.example.com"]);

        expect(result.filter.ids).toEqual([hex]);
        expect(result.relays).toContain("wss://relay.example.com/");
      });

      it("should accumulate across multiple -i flags", () => {
        const hex1 = "a".repeat(64);
        const hex2 = "b".repeat(64);
        const result = parseReqCommand(["-i", hex1, "-i", hex2]);
        expect(result.filter.ids).toEqual([hex1, hex2]);
      });
    });
  });

  describe("pubkey tag flag (-p)", () => {
    it("should parse hex pubkey for #p tag", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-p", hex]);
      expect(result.filter["#p"]).toEqual([hex]);
    });

    it("should parse npub for #p tag", () => {
      const npub =
        "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
      const result = parseReqCommand(["-p", npub]);
      expect(result.filter["#p"]).toEqual([
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      ]);
    });

    it("should parse nprofile for #p tag", () => {
      const nprofile =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const result = parseReqCommand(["-p", nprofile]);
      expect(result.filter["#p"]).toEqual([
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      ]);
    });

    it("should extract and normalize relay hints from nprofile in -p flag", () => {
      const nprofile =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const result = parseReqCommand(["-p", nprofile]);
      // Relay hints should be normalized (lowercase, trailing slash)
      expect(result.relays).toContain("wss://r.x.com/");
      expect(result.relays).toContain("wss://djbas.sadkb.com/");
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

    it("should handle mixed hex, npub, nprofile, and NIP-05 for #p tags", () => {
      const hex = "a".repeat(64);
      const npub =
        "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
      const result = parseReqCommand(["-p", `${hex},${npub},user@domain.com`]);
      expect(result.filter["#p"]).toEqual([
        hex,
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      ]);
      expect(result.nip05PTags).toEqual(["user@domain.com"]);
    });

    it("should deduplicate #p tags", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-p", `${hex},${hex}`]);
      expect(result.filter["#p"]).toEqual([hex]);
    });

    it("should accumulate @domain syntax for #p tags", () => {
      const result = parseReqCommand(["-p", "@habla.news"]);
      expect(result.domainPTags).toEqual(["habla.news"]);
      expect(result.filter["#p"]).toBeUndefined();
    });

    it("should handle mixed hex, NIP-05, and @domain for #p tags", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand([
        "-p",
        `${hex},user@domain.com,@habla.news`,
      ]);
      expect(result.filter["#p"]).toEqual([hex]);
      expect(result.nip05PTags).toEqual(["user@domain.com"]);
      expect(result.domainPTags).toEqual(["habla.news"]);
    });
  });

  describe("uppercase P tag flag (-P)", () => {
    it("should parse hex pubkey for #P tag", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-P", hex]);
      expect(result.filter["#P"]).toEqual([hex]);
    });

    it("should parse npub for #P tag", () => {
      const npub =
        "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
      const result = parseReqCommand(["-P", npub]);
      expect(result.filter["#P"]).toEqual([
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      ]);
    });

    it("should parse nprofile for #P tag", () => {
      const nprofile =
        "nprofile1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhhytnc9e3k7mgpz4mhxue69uhkg6nzv9ejuumpv34kytnrdaksjlyr9p";
      const result = parseReqCommand(["-P", nprofile]);
      expect(result.filter["#P"]).toEqual([
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      ]);
    });

    it("should parse comma-separated pubkeys for #P", () => {
      const hex1 = "a".repeat(64);
      const hex2 = "b".repeat(64);
      const result = parseReqCommand(["-P", `${hex1},${hex2}`]);
      expect(result.filter["#P"]).toEqual([hex1, hex2]);
    });

    it("should accumulate NIP-05 identifiers for #P tags", () => {
      const result = parseReqCommand([
        "-P",
        "user@domain.com,alice@example.com",
      ]);
      expect(result.nip05PTagsUppercase).toEqual([
        "user@domain.com",
        "alice@example.com",
      ]);
      expect(result.filter["#P"]).toBeUndefined();
    });

    it("should handle mixed hex, npub, and NIP-05 for #P tags", () => {
      const hex = "a".repeat(64);
      const npub =
        "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
      const result = parseReqCommand(["-P", `${hex},${npub},user@domain.com`]);
      expect(result.filter["#P"]).toEqual([
        hex,
        "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      ]);
      expect(result.nip05PTagsUppercase).toEqual(["user@domain.com"]);
    });

    it("should deduplicate #P tags", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-P", `${hex},${hex}`]);
      expect(result.filter["#P"]).toEqual([hex]);
    });

    it("should accumulate @domain syntax for #P tags", () => {
      const result = parseReqCommand(["-P", "@habla.news"]);
      expect(result.domainPTagsUppercase).toEqual(["habla.news"]);
      expect(result.filter["#P"]).toBeUndefined();
    });

    it("should handle mixed hex, NIP-05, and @domain for #P tags", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand([
        "-P",
        `${hex},user@domain.com,@habla.news`,
      ]);
      expect(result.filter["#P"]).toEqual([hex]);
      expect(result.nip05PTagsUppercase).toEqual(["user@domain.com"]);
      expect(result.domainPTagsUppercase).toEqual(["habla.news"]);
    });

    it("should handle $me alias in #P tags", () => {
      const result = parseReqCommand(["-P", "$me"]);
      expect(result.filter["#P"]).toContain("$me");
      expect(result.needsAccount).toBe(true);
    });

    it("should handle $contacts alias in #P tags", () => {
      const result = parseReqCommand(["-P", "$contacts"]);
      expect(result.filter["#P"]).toContain("$contacts");
      expect(result.needsAccount).toBe(true);
    });

    it("should handle mixed aliases and pubkeys in #P", () => {
      const hex = "a".repeat(64);
      const result = parseReqCommand(["-P", `$me,${hex},$contacts`]);
      expect(result.filter["#P"]).toContain("$me");
      expect(result.filter["#P"]).toContain(hex);
      expect(result.filter["#P"]).toContain("$contacts");
      expect(result.needsAccount).toBe(true);
    });

    it("should differentiate between -p and -P flags", () => {
      const hex1 = "a".repeat(64);
      const hex2 = "b".repeat(64);
      const result = parseReqCommand(["-p", hex1, "-P", hex2]);
      expect(result.filter["#p"]).toEqual([hex1]);
      expect(result.filter["#P"]).toEqual([hex2]);
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
    describe("unix timestamps", () => {
      it("should parse unix timestamp for --since", () => {
        const result = parseReqCommand(["--since", "1234567890"]);
        expect(result.filter.since).toBe(1234567890);
      });

      it("should parse unix timestamp for --until", () => {
        const result = parseReqCommand(["--until", "1234567890"]);
        expect(result.filter.until).toBe(1234567890);
      });
    });

    describe("relative time - seconds (s)", () => {
      it("should parse seconds for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "30s"]);
        expect(result.filter.since).toBeDefined();
        expect(result.filter.since).toBeGreaterThan(now - 35);
        expect(result.filter.since).toBeLessThan(now - 25);
      });

      it("should parse 1 second for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "1s"]);
        expect(result.filter.since).toBeDefined();
        expect(result.filter.since).toBeGreaterThan(now - 5);
        expect(result.filter.since).toBeLessThan(now + 1);
      });

      it("should parse seconds for --until", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--until", "30s"]);
        expect(result.filter.until).toBeDefined();
        expect(result.filter.until).toBeGreaterThan(now - 35);
        expect(result.filter.until).toBeLessThan(now - 25);
      });
    });

    describe("relative time - minutes (m)", () => {
      it("should parse minutes for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "30m"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        expect(diff).toBeGreaterThan(1795); // 30m - 5s
        expect(diff).toBeLessThan(1805); // 30m + 5s
      });

      it("should parse 1 minute for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "1m"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        expect(diff).toBeGreaterThan(55); // 1m - 5s
        expect(diff).toBeLessThan(65); // 1m + 5s
      });
    });

    describe("relative time - hours (h)", () => {
      it("should parse hours for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "2h"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        expect(diff).toBeGreaterThan(7195); // 2h - 5s
        expect(diff).toBeLessThan(7205); // 2h + 5s
      });

      it("should parse 24 hours for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "24h"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        expect(diff).toBeGreaterThan(86395); // 24h - 5s
        expect(diff).toBeLessThan(86405); // 24h + 5s
      });
    });

    describe("relative time - days (d)", () => {
      it("should parse days for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "7d"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        expect(diff).toBeGreaterThan(604795); // 7d - 5s
        expect(diff).toBeLessThan(604805); // 7d + 5s
      });

      it("should parse 1 day for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "1d"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        expect(diff).toBeGreaterThan(86395); // 1d - 5s
        expect(diff).toBeLessThan(86405); // 1d + 5s
      });
    });

    describe("relative time - weeks (w)", () => {
      it("should parse weeks for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "2w"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        expect(diff).toBeGreaterThan(1209595); // 2w - 5s
        expect(diff).toBeLessThan(1209605); // 2w + 5s
      });

      it("should parse 1 week for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "1w"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        expect(diff).toBeGreaterThan(604795); // 1w - 5s
        expect(diff).toBeLessThan(604805); // 1w + 5s
      });
    });

    describe("relative time - months (mo)", () => {
      it("should parse months for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "3mo"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        // 3 months = 7776000 seconds (90 days)
        expect(diff).toBeGreaterThan(7775995); // 3mo - 5s
        expect(diff).toBeLessThan(7776005); // 3mo + 5s
      });

      it("should parse 1 month for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "1mo"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        // 1 month = 2592000 seconds (30 days)
        expect(diff).toBeGreaterThan(2591995); // 1mo - 5s
        expect(diff).toBeLessThan(2592005); // 1mo + 5s
      });
    });

    describe("relative time - years (y)", () => {
      it("should parse years for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "4y"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        // 4 years = 126144000 seconds (1460 days)
        expect(diff).toBeGreaterThan(126143995); // 4y - 5s
        expect(diff).toBeLessThan(126144005); // 4y + 5s
      });

      it("should parse 1 year for --since", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "1y"]);
        expect(result.filter.since).toBeDefined();
        const diff = now - result.filter.since!;
        // 1 year = 31536000 seconds (365 days)
        expect(diff).toBeGreaterThan(31535995); // 1y - 5s
        expect(diff).toBeLessThan(31536005); // 1y + 5s
      });
    });

    describe("special keyword - now", () => {
      it("should parse 'now' for --since", () => {
        const before = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--since", "now"]);
        const after = Math.floor(Date.now() / 1000);

        expect(result.filter.since).toBeDefined();
        expect(result.filter.since).toBeGreaterThanOrEqual(before);
        expect(result.filter.since).toBeLessThanOrEqual(after);
      });

      it("should parse 'now' for --until", () => {
        const before = Math.floor(Date.now() / 1000);
        const result = parseReqCommand(["--until", "now"]);
        const after = Math.floor(Date.now() / 1000);

        expect(result.filter.until).toBeDefined();
        expect(result.filter.until).toBeGreaterThanOrEqual(before);
        expect(result.filter.until).toBeLessThanOrEqual(after);
      });

      it("should be case-insensitive for 'now'", () => {
        const result1 = parseReqCommand(["--since", "NOW"]);
        const result2 = parseReqCommand(["--since", "Now"]);
        const result3 = parseReqCommand(["--since", "now"]);

        expect(result1.filter.since).toBeDefined();
        expect(result2.filter.since).toBeDefined();
        expect(result3.filter.since).toBeDefined();
      });

      it("should work with other filters", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand([
          "-k",
          "1",
          "--since",
          "7d",
          "--until",
          "now",
        ]);

        expect(result.filter.kinds).toEqual([1]);
        expect(result.filter.since).toBeLessThan(now);
        expect(result.filter.until).toBeGreaterThanOrEqual(now - 1);
        expect(result.filter.until).toBeLessThanOrEqual(now + 1);
      });
    });

    describe("invalid time formats", () => {
      it("should return undefined for invalid time format", () => {
        const result = parseReqCommand(["--since", "invalid"]);
        expect(result.filter.since).toBeUndefined();
      });

      it("should return undefined for time unit without number", () => {
        const result = parseReqCommand(["--since", "h"]);
        expect(result.filter.since).toBeUndefined();
      });

      it("should return undefined for unsupported unit", () => {
        const result = parseReqCommand(["--since", "5x"]);
        expect(result.filter.since).toBeUndefined();
      });

      it("should return undefined for negative time", () => {
        const result = parseReqCommand(["--since", "-5h"]);
        expect(result.filter.since).toBeUndefined();
      });
    });

    describe("combined time flags", () => {
      it("should parse both --since and --until", () => {
        const result = parseReqCommand([
          "--since",
          "7d",
          "--until",
          "1d",
          "-k",
          "1",
        ]);
        expect(result.filter.since).toBeDefined();
        expect(result.filter.until).toBeDefined();
        expect(result.filter.since).toBeLessThan(result.filter.until!);
        expect(result.filter.kinds).toEqual([1]);
      });

      it("should work with unix timestamps for time range", () => {
        const result = parseReqCommand([
          "--since",
          "1600000000",
          "--until",
          "1700000000",
        ]);
        expect(result.filter.since).toBe(1600000000);
        expect(result.filter.until).toBe(1700000000);
      });

      it("should work with mixed relative and unix timestamps", () => {
        const now = Math.floor(Date.now() / 1000);
        const result = parseReqCommand([
          "--since",
          "7d",
          "--until",
          "1234567890",
        ]);
        expect(result.filter.since).toBeDefined();
        expect(result.filter.since).toBeLessThan(now);
        expect(result.filter.until).toBe(1234567890);
      });
    });
  });

  describe("search flag (--search)", () => {
    it("should parse search query", () => {
      const result = parseReqCommand(["--search", "bitcoin"]);
      expect(result.filter.search).toBe("bitcoin");
    });
  });

  describe("relay parsing", () => {
    it("should parse relay with wss:// protocol and normalize", () => {
      const result = parseReqCommand(["wss://relay.example.com"]);
      expect(result.relays).toEqual(["wss://relay.example.com/"]);
    });

    it("should parse relay domain and add wss:// with trailing slash", () => {
      const result = parseReqCommand(["relay.example.com"]);
      expect(result.relays).toEqual(["wss://relay.example.com/"]);
    });

    it("should parse multiple relays and normalize all", () => {
      const result = parseReqCommand([
        "wss://relay1.com",
        "relay2.com",
        "wss://relay3.com/",
      ]);
      expect(result.relays).toEqual([
        "wss://relay1.com/",
        "wss://relay2.com/",
        "wss://relay3.com/",
      ]);
    });

    it("should normalize relays with and without trailing slash to same value", () => {
      const result = parseReqCommand(["wss://relay.com", "wss://relay.com/"]);
      // Should deduplicate because they normalize to the same URL
      expect(result.relays).toEqual(["wss://relay.com/", "wss://relay.com/"]);
    });

    it("should lowercase relay URLs during normalization", () => {
      const result = parseReqCommand(["wss://Relay.Example.COM"]);
      expect(result.relays).toEqual(["wss://relay.example.com/"]);
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

  describe("follow flag (-f, --follow)", () => {
    it("should parse -f flag", () => {
      const result = parseReqCommand(["-f"]);
      expect(result.follow).toBe(true);
    });

    it("should parse --follow flag", () => {
      const result = parseReqCommand(["--follow"]);
      expect(result.follow).toBe(true);
    });

    it("should default to false when not provided", () => {
      const result = parseReqCommand(["-k", "1"]);
      expect(result.follow).toBe(false);
    });

    it("should work with other flags", () => {
      const result = parseReqCommand(["-k", "1", "-f", "-l", "50"]);
      expect(result.filter.kinds).toEqual([1]);
      expect(result.follow).toBe(true);
      expect(result.filter.limit).toBe(50);
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
      expect(result.relays).toEqual(["wss://relay.example.com/"]);
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

  describe("$me and $contacts aliases", () => {
    describe("$me alias in authors (-a)", () => {
      it("should detect $me in authors", () => {
        const result = parseReqCommand(["-a", "$me"]);
        expect(result.filter.authors).toContain("$me");
        expect(result.needsAccount).toBe(true);
      });

      it("should handle $me with other pubkeys", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-a", `$me,${hex}`]);
        expect(result.filter.authors).toContain("$me");
        expect(result.filter.authors).toContain(hex);
        expect(result.needsAccount).toBe(true);
      });

      it("should deduplicate $me", () => {
        const result = parseReqCommand(["-a", "$me,$me"]);
        expect(result.filter.authors).toEqual(["$me"]);
      });
    });

    describe("$contacts alias in authors (-a)", () => {
      it("should detect $contacts in authors", () => {
        const result = parseReqCommand(["-a", "$contacts"]);
        expect(result.filter.authors).toContain("$contacts");
        expect(result.needsAccount).toBe(true);
      });

      it("should handle $contacts with other pubkeys", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-a", `$contacts,${hex}`]);
        expect(result.filter.authors).toContain("$contacts");
        expect(result.filter.authors).toContain(hex);
        expect(result.needsAccount).toBe(true);
      });

      it("should handle $me and $contacts together", () => {
        const result = parseReqCommand(["-a", "$me,$contacts"]);
        expect(result.filter.authors).toContain("$me");
        expect(result.filter.authors).toContain("$contacts");
        expect(result.needsAccount).toBe(true);
      });
    });

    describe("case-insensitive aliases", () => {
      it("should normalize $ME to $me in authors", () => {
        const result = parseReqCommand(["-a", "$ME"]);
        expect(result.filter.authors).toContain("$me");
        expect(result.needsAccount).toBe(true);
      });

      it("should normalize $CONTACTS to $contacts in authors", () => {
        const result = parseReqCommand(["-a", "$CONTACTS"]);
        expect(result.filter.authors).toContain("$contacts");
        expect(result.needsAccount).toBe(true);
      });

      it("should normalize mixed case $Me to $me in #p tags", () => {
        const result = parseReqCommand(["-p", "$Me"]);
        expect(result.filter["#p"]).toContain("$me");
        expect(result.needsAccount).toBe(true);
      });

      it("should normalize $CONTACTS to $contacts in #P tags", () => {
        const result = parseReqCommand(["-P", "$CONTACTS"]);
        expect(result.filter["#P"]).toContain("$contacts");
        expect(result.needsAccount).toBe(true);
      });

      it("should handle mixed case aliases with other values", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-a", `$ME,${hex},$Contacts`]);
        expect(result.filter.authors).toContain("$me");
        expect(result.filter.authors).toContain("$contacts");
        expect(result.filter.authors).toContain(hex);
        expect(result.needsAccount).toBe(true);
      });
    });

    describe("$me alias in #p tags (-p)", () => {
      it("should detect $me in #p tags", () => {
        const result = parseReqCommand(["-p", "$me"]);
        expect(result.filter["#p"]).toContain("$me");
        expect(result.needsAccount).toBe(true);
      });

      it("should handle $me with other pubkeys in #p", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-p", `$me,${hex}`]);
        expect(result.filter["#p"]).toContain("$me");
        expect(result.filter["#p"]).toContain(hex);
        expect(result.needsAccount).toBe(true);
      });
    });

    describe("$contacts alias in #p tags (-p)", () => {
      it("should detect $contacts in #p tags", () => {
        const result = parseReqCommand(["-p", "$contacts"]);
        expect(result.filter["#p"]).toContain("$contacts");
        expect(result.needsAccount).toBe(true);
      });

      it("should handle $contacts with other pubkeys in #p", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-p", `$contacts,${hex}`]);
        expect(result.filter["#p"]).toContain("$contacts");
        expect(result.filter["#p"]).toContain(hex);
        expect(result.needsAccount).toBe(true);
      });

      it("should handle $me and $contacts together in #p", () => {
        const result = parseReqCommand(["-p", "$me,$contacts"]);
        expect(result.filter["#p"]).toContain("$me");
        expect(result.filter["#p"]).toContain("$contacts");
        expect(result.needsAccount).toBe(true);
      });
    });

    describe("mixed aliases across -a and -p", () => {
      it("should set needsAccount if alias in authors only", () => {
        const result = parseReqCommand(["-a", "$me", "-k", "1"]);
        expect(result.needsAccount).toBe(true);
      });

      it("should set needsAccount if alias in #p only", () => {
        const result = parseReqCommand(["-p", "$contacts", "-k", "1"]);
        expect(result.needsAccount).toBe(true);
      });

      it("should set needsAccount if aliases in both", () => {
        const result = parseReqCommand(["-a", "$me", "-p", "$contacts"]);
        expect(result.needsAccount).toBe(true);
      });

      it("should not set needsAccount without aliases", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand(["-a", hex, "-k", "1"]);
        expect(result.needsAccount).toBe(false);
      });
    });

    describe("complex scenarios with aliases", () => {
      it("should handle aliases with other filter types", () => {
        const result = parseReqCommand([
          "-k",
          "1",
          "-a",
          "$contacts",
          "--since",
          "24h",
          "-l",
          "50",
        ]);
        expect(result.filter.kinds).toEqual([1]);
        expect(result.filter.authors).toContain("$contacts");
        expect(result.filter.since).toBeDefined();
        expect(result.filter.limit).toBe(50);
        expect(result.needsAccount).toBe(true);
      });

      it("should handle mixed pubkeys, NIP-05, and aliases", () => {
        const hex = "a".repeat(64);
        const result = parseReqCommand([
          "-a",
          `${hex},$me,user@domain.com,$contacts`,
        ]);
        expect(result.filter.authors).toContain(hex);
        expect(result.filter.authors).toContain("$me");
        expect(result.filter.authors).toContain("$contacts");
        expect(result.nip05Authors).toEqual(["user@domain.com"]);
        expect(result.needsAccount).toBe(true);
      });
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
