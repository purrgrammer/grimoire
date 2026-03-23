import { describe, it, expect } from "vitest";
import { chunkFiltersByRelay } from "./relay-filter-chunking";
import type { RelaySelectionReasoning } from "@/types/relay-selection";

describe("chunkFiltersByRelay", () => {
  const relay1 = "wss://relay1.example.com/";
  const relay2 = "wss://relay2.example.com/";
  const relay3 = "wss://relay3.example.com/";

  const alice = "aaaa".repeat(16);
  const bob = "bbbb".repeat(16);
  const carol = "cccc".repeat(16);
  const dave = "dddd".repeat(16);

  describe("authors only (outbox chunking)", () => {
    it("splits 2 authors on different relays", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay2, writers: [bob], readers: [], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice, bob] },
        reasoning,
      );

      expect(result[relay1]).toEqual([{ kinds: [1], authors: [alice] }]);
      expect(result[relay2]).toEqual([{ kinds: [1], authors: [bob] }]);
    });

    it("gives both authors to a shared relay", () => {
      const reasoning: RelaySelectionReasoning[] = [
        {
          relay: relay1,
          writers: [alice, bob],
          readers: [],
          isFallback: false,
        },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice, bob] },
        reasoning,
      );

      expect(result[relay1]).toEqual([{ kinds: [1], authors: [alice, bob] }]);
    });

    it("includes unassigned authors in ALL relay filters", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay2, writers: [bob], readers: [], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice, bob, dave] },
        reasoning,
      );

      expect(result[relay1]![0].authors).toContain(alice);
      expect(result[relay1]![0].authors).toContain(dave);
      expect(result[relay1]![0].authors).not.toContain(bob);

      expect(result[relay2]![0].authors).toContain(bob);
      expect(result[relay2]![0].authors).toContain(dave);
      expect(result[relay2]![0].authors).not.toContain(alice);
    });
  });

  describe("#p only (inbox chunking)", () => {
    it("splits 2 p-tags on different relays", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [], readers: [carol], isFallback: false },
        { relay: relay2, writers: [], readers: [dave], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], "#p": [carol, dave] },
        reasoning,
      );

      expect(result[relay1]).toEqual([{ kinds: [1], "#p": [carol] }]);
      expect(result[relay2]).toEqual([{ kinds: [1], "#p": [dave] }]);
    });

    it("includes unassigned p-tags in ALL relay filters", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [], readers: [carol], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], "#p": [carol, dave] },
        reasoning,
      );

      // dave is unassigned, goes to all relays
      expect(result[relay1]![0]["#p"]).toContain(carol);
      expect(result[relay1]![0]["#p"]).toContain(dave);
    });
  });

  describe("both authors and #p (combined)", () => {
    it("outbox relay gets chunked authors + full #p", () => {
      // relay1 is alice's outbox, relay2 is carol's inbox
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay2, writers: [], readers: [carol], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice, bob], "#p": [carol] },
        reasoning,
      );

      // relay1: selected for alice (outbox) → chunked authors, full #p
      expect(result[relay1]![0].authors).toContain(alice);
      expect(result[relay1]![0].authors).toContain(bob); // unassigned
      expect(result[relay1]![0]["#p"]).toEqual([carol]);

      // relay2: selected for carol (inbox) → full authors, chunked #p
      expect(result[relay2]![0].authors).toEqual([alice, bob]);
      expect(result[relay2]![0]["#p"]).toEqual([carol]);
    });

    it("relay selected for both gets chunked authors + chunked #p", () => {
      const reasoning: RelaySelectionReasoning[] = [
        {
          relay: relay1,
          writers: [alice],
          readers: [carol],
          isFallback: false,
        },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice, bob], "#p": [carol, dave] },
        reasoning,
      );

      // relay1 is selected for both alice (writer) and carol (reader)
      // Gets chunked authors (alice + unassigned bob) and chunked #p (carol + unassigned dave)
      expect(result[relay1]![0].authors).toContain(alice);
      expect(result[relay1]![0].authors).toContain(bob); // unassigned
      expect(result[relay1]![0]["#p"]).toContain(carol);
      expect(result[relay1]![0]["#p"]).toContain(dave); // unassigned
    });

    it("inbox-only relay gets full authors when not selected for any writer", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay2, writers: [], readers: [carol], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice], "#p": [carol] },
        reasoning,
      );

      // relay2 selected for carol's inbox, not for any writer
      // Gets full authors + chunked #p
      expect(result[relay2]![0].authors).toEqual([alice]);
      expect(result[relay2]![0]["#p"]).toEqual([carol]);
    });
  });

  describe("fallback relays", () => {
    it("gives fallback relays the full unmodified filter", () => {
      const filter = { kinds: [1], authors: [alice], "#p": [carol] };
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay3, writers: [], readers: [], isFallback: true },
      ];

      const result = chunkFiltersByRelay(filter, reasoning);

      expect(result[relay3]).toEqual([filter]);
    });
  });

  describe("edge cases", () => {
    it("returns empty object for empty reasoning", () => {
      const result = chunkFiltersByRelay({ kinds: [1], authors: [alice] }, []);
      expect(result).toEqual({});
    });

    it("returns empty object for filter with no authors and no #p", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
      ];

      const result = chunkFiltersByRelay({ kinds: [1] }, reasoning);
      expect(result).toEqual({});
    });

    it("preserves non-pubkey filter fields", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        {
          kinds: [1, 30023],
          authors: [alice],
          since: 1000,
          until: 2000,
          limit: 50,
          "#t": ["nostr"],
          search: "hello",
        },
        reasoning,
      );

      expect(result[relay1]).toEqual([
        {
          kinds: [1, 30023],
          authors: [alice],
          since: 1000,
          until: 2000,
          limit: 50,
          "#t": ["nostr"],
          search: "hello",
        },
      ]);
    });

    it("skips relay with no relevant pubkeys", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay2, writers: [dave], readers: [dave], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice], "#p": [carol] },
        reasoning,
      );

      expect(result[relay1]).toBeDefined();
      expect(result[relay2]).toBeUndefined();
    });

    it("handles filter array input — each chunked independently per relay", () => {
      const reasoning: RelaySelectionReasoning[] = [
        {
          relay: relay1,
          writers: [alice],
          readers: [carol],
          isFallback: false,
        },
        { relay: relay2, writers: [bob], readers: [], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        [
          { kinds: [1], authors: [alice, bob] },
          { kinds: [7], "#p": [carol] },
        ],
        reasoning,
      );

      // relay1: alice from first filter + carol from second filter
      expect(result[relay1]).toHaveLength(2);
      expect(result[relay1]![0]).toEqual({ kinds: [1], authors: [alice] });
      expect(result[relay1]![1]).toEqual({ kinds: [7], "#p": [carol] });

      // relay2: bob from first filter, no readers for carol
      expect(result[relay2]).toHaveLength(1);
      expect(result[relay2]![0]).toEqual({ kinds: [1], authors: [bob] });
    });

    it("deduplicates pubkeys", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice] },
        reasoning,
      );

      expect(result[relay1]![0].authors).toEqual([alice]);
    });

    it("treats empty authors array same as absent", () => {
      const reasoning: RelaySelectionReasoning[] = [
        {
          relay: relay1,
          writers: [alice],
          readers: [carol],
          isFallback: false,
        },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [], "#p": [carol] },
        reasoning,
      );

      // authors: [] is falsy-length, so only #p is chunked
      expect(result[relay1]).toHaveLength(1);
      expect(result[relay1]![0].authors).toBeUndefined();
      expect(result[relay1]![0]["#p"]).toEqual([carol]);
    });
  });

  describe("real-world scenarios", () => {
    it("disjoint relays: authors outbox and #p inbox share no relays", () => {
      // Very common: Alice writes to relay1, Carol reads on relay2, zero overlap
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay2, writers: [], readers: [carol], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice], "#p": [carol] },
        reasoning,
      );

      // relay1 (alice's outbox): chunked authors [alice], full #p [carol]
      expect(result[relay1]![0].authors).toEqual([alice]);
      expect(result[relay1]![0]["#p"]).toEqual([carol]);

      // relay2 (carol's inbox): full authors [alice], chunked #p [carol]
      expect(result[relay2]![0].authors).toEqual([alice]);
      expect(result[relay2]![0]["#p"]).toEqual([carol]);

      // Both relays get the complete filter — but for different routing reasons
      expect(result[relay1]![0].kinds).toEqual([1]);
      expect(result[relay2]![0].kinds).toEqual([1]);
    });

    it("all authors unassigned — everyone uses fallback relays", () => {
      // Nobody has kind:10002, relay selection returned only fallbacks
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [], readers: [], isFallback: true },
        { relay: relay2, writers: [], readers: [], isFallback: true },
      ];

      const filter = { kinds: [1], authors: [alice, bob] };
      const result = chunkFiltersByRelay(filter, reasoning);

      // Both fallbacks get the full unmodified filter
      expect(result[relay1]).toEqual([filter]);
      expect(result[relay2]).toEqual([filter]);
    });

    it("only fallback reasoning — no NIP-65 data at all", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [], readers: [], isFallback: true },
        { relay: relay2, writers: [], readers: [], isFallback: true },
        { relay: relay3, writers: [], readers: [], isFallback: true },
      ];

      const filter = { kinds: [1], authors: [alice], "#p": [carol] };
      const result = chunkFiltersByRelay(filter, reasoning);

      // Every fallback gets the full filter
      expect(Object.keys(result)).toHaveLength(3);
      for (const relayFilters of Object.values(result)) {
        expect(relayFilters).toEqual([filter]);
      }
    });

    it("same pubkey in both authors and #p — self-mentions", () => {
      // "Show me my posts that mention me" — alice is both author and p-tag
      const reasoning: RelaySelectionReasoning[] = [
        {
          relay: relay1,
          writers: [alice],
          readers: [alice],
          isFallback: false,
        },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice], "#p": [alice] },
        reasoning,
      );

      // relay1 selected for both writer and reader
      expect(result[relay1]![0].authors).toEqual([alice]);
      expect(result[relay1]![0]["#p"]).toEqual([alice]);
    });

    it("author publishes to multiple relays", () => {
      // Alice writes to both relay1 and relay2
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay2, writers: [alice], readers: [], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice] },
        reasoning,
      );

      // Both relays get alice
      expect(result[relay1]![0].authors).toEqual([alice]);
      expect(result[relay2]![0].authors).toEqual([alice]);
    });

    it("all #p unassigned, relays selected only via authors", () => {
      // Carol and dave have no relay lists, but alice and bob do
      // #p pubkeys should appear in full on all author-selected relays
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay2, writers: [bob], readers: [], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice, bob], "#p": [carol, dave] },
        reasoning,
      );

      // Both relays selected for writers, not for readers
      // → chunked authors, full #p on each
      expect(result[relay1]![0].authors).toEqual([alice]);
      expect(result[relay1]![0]["#p"]).toEqual([carol, dave]);

      expect(result[relay2]![0].authors).toEqual([bob]);
      expect(result[relay2]![0]["#p"]).toEqual([carol, dave]);
    });

    it("single author + many p-tags — common notes-from-X query", () => {
      // "notes from alice mentioning bob, carol, or dave"
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [bob], isFallback: false },
        { relay: relay2, writers: [], readers: [carol], isFallback: false },
        { relay: relay3, writers: [], readers: [dave], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice], "#p": [bob, carol, dave] },
        reasoning,
      );

      // relay1: selected for alice (writer) + bob (reader)
      // → chunked authors [alice], chunked #p [bob]
      expect(result[relay1]![0].authors).toEqual([alice]);
      expect(result[relay1]![0]["#p"]).toEqual([bob]);

      // relay2: selected for carol (reader only)
      // → full authors [alice], chunked #p [carol]
      expect(result[relay2]![0].authors).toEqual([alice]);
      expect(result[relay2]![0]["#p"]).toEqual([carol]);

      // relay3: selected for dave (reader only)
      // → full authors [alice], chunked #p [dave]
      expect(result[relay3]![0].authors).toEqual([alice]);
      expect(result[relay3]![0]["#p"]).toEqual([dave]);
    });

    it("many authors + single #p — common $me mentions query", () => {
      // "events from anyone in my contacts that mention me"
      const reasoning: RelaySelectionReasoning[] = [
        {
          relay: relay1,
          writers: [alice, bob],
          readers: [carol],
          isFallback: false,
        },
        { relay: relay2, writers: [dave], readers: [], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice, bob, dave], "#p": [carol] },
        reasoning,
      );

      // relay1: selected for writers [alice, bob] AND reader [carol]
      // → chunked authors [alice, bob], chunked #p [carol]
      expect(result[relay1]![0].authors).toEqual([alice, bob]);
      expect(result[relay1]![0]["#p"]).toEqual([carol]);

      // relay2: selected for writer [dave] only
      // → chunked authors [dave], full #p [carol]
      expect(result[relay2]![0].authors).toEqual([dave]);
      expect(result[relay2]![0]["#p"]).toEqual([carol]);
    });

    it("large realistic scenario: 5 authors across 3 relays with overlap", () => {
      const eve = "eeee".repeat(16);
      const reasoning: RelaySelectionReasoning[] = [
        {
          relay: relay1,
          writers: [alice, bob, carol],
          readers: [],
          isFallback: false,
        },
        {
          relay: relay2,
          writers: [bob, dave],
          readers: [],
          isFallback: false,
        },
        {
          relay: relay3,
          writers: [eve],
          readers: [],
          isFallback: false,
        },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice, bob, carol, dave, eve] },
        reasoning,
      );

      // relay1 gets its 3 writers
      expect(result[relay1]![0].authors).toEqual(
        expect.arrayContaining([alice, bob, carol]),
      );
      expect(result[relay1]![0].authors).toHaveLength(3);

      // relay2 gets its 2 writers
      expect(result[relay2]![0].authors).toEqual(
        expect.arrayContaining([bob, dave]),
      );
      expect(result[relay2]![0].authors).toHaveLength(2);

      // relay3 gets its 1 writer
      expect(result[relay3]![0].authors).toEqual([eve]);

      // bob appears on both relay1 and relay2 (writes to both)
      expect(result[relay1]![0].authors).toContain(bob);
      expect(result[relay2]![0].authors).toContain(bob);
    });

    it("mix of fallback and NIP-65 relays", () => {
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay2, writers: [], readers: [], isFallback: true },
      ];

      const filter = { kinds: [1], authors: [alice, bob] };
      const result = chunkFiltersByRelay(filter, reasoning);

      // relay1: NIP-65 selected, gets chunked (alice + unassigned bob)
      expect(result[relay1]![0].authors).toContain(alice);
      expect(result[relay1]![0].authors).toContain(bob);

      // relay2: fallback, gets full original filter
      expect(result[relay2]).toEqual([filter]);
    });

    it("reasoning has extra pubkeys not in filter — ignored", () => {
      // relay1's writers include eve who isn't in the filter at all
      const eve = "eeee".repeat(16);
      const reasoning: RelaySelectionReasoning[] = [
        {
          relay: relay1,
          writers: [alice, eve],
          readers: [],
          isFallback: false,
        },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice] },
        reasoning,
      );

      // Only alice (from the filter) appears, eve is ignored
      expect(result[relay1]![0].authors).toEqual([alice]);
    });

    it("multiple unassigned authors spread across few relays", () => {
      // Only alice has a relay list; bob, carol, dave don't
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice, bob, carol, dave] },
        reasoning,
      );

      // relay1 gets alice (assigned) + all unassigned
      const authors = result[relay1]![0].authors!;
      expect(authors).toContain(alice);
      expect(authors).toContain(bob);
      expect(authors).toContain(carol);
      expect(authors).toContain(dave);
      expect(authors).toHaveLength(4);
    });

    it("complex: disjoint authors/p-tags with some unassigned on both sides", () => {
      // alice→relay1 (outbox), carol→relay2 (inbox)
      // bob (author) and dave (#p) have no relay lists
      const reasoning: RelaySelectionReasoning[] = [
        { relay: relay1, writers: [alice], readers: [], isFallback: false },
        { relay: relay2, writers: [], readers: [carol], isFallback: false },
      ];

      const result = chunkFiltersByRelay(
        { kinds: [1], authors: [alice, bob], "#p": [carol, dave] },
        reasoning,
      );

      // relay1: selected for alice (writer)
      // → chunked authors [alice, bob(unassigned)], full #p [carol, dave]
      expect(result[relay1]![0].authors).toContain(alice);
      expect(result[relay1]![0].authors).toContain(bob);
      expect(result[relay1]![0]["#p"]).toEqual([carol, dave]);

      // relay2: selected for carol (reader)
      // → full authors [alice, bob], chunked #p [carol, dave(unassigned)]
      expect(result[relay2]![0].authors).toEqual([alice, bob]);
      expect(result[relay2]![0]["#p"]).toContain(carol);
      expect(result[relay2]![0]["#p"]).toContain(dave);
    });
  });
});
