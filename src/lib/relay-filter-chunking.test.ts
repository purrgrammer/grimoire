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

  it("splits 2 authors on different relays so each only gets its author", () => {
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

  it("gives both authors to a relay when they share it", () => {
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

  it("gives fallback relays the full unmodified filter", () => {
    const filter = { kinds: [1], authors: [alice, bob], "#p": [carol] };
    const reasoning: RelaySelectionReasoning[] = [
      { relay: relay1, writers: [alice], readers: [], isFallback: false },
      { relay: relay3, writers: [], readers: [], isFallback: true },
    ];

    const result = chunkFiltersByRelay(filter, reasoning);

    // Fallback gets exact original filter
    expect(result[relay3]).toEqual([filter]);
    // Non-fallback gets chunked authors, but bob is unassigned so goes to all
    expect(result[relay1]![0].authors).toContain(alice);
    expect(result[relay1]![0].authors).toContain(bob);
  });

  it("includes unassigned authors (no kind:10002) in ALL relay filters", () => {
    const reasoning: RelaySelectionReasoning[] = [
      { relay: relay1, writers: [alice], readers: [], isFallback: false },
      { relay: relay2, writers: [bob], readers: [], isFallback: false },
    ];

    const result = chunkFiltersByRelay(
      { kinds: [1], authors: [alice, bob, dave] },
      reasoning,
    );

    // dave is unassigned, should appear in both relays
    expect(result[relay1]![0].authors).toContain(alice);
    expect(result[relay1]![0].authors).toContain(dave);
    expect(result[relay1]![0].authors).not.toContain(bob);

    expect(result[relay2]![0].authors).toContain(bob);
    expect(result[relay2]![0].authors).toContain(dave);
    expect(result[relay2]![0].authors).not.toContain(alice);
  });

  it("passes #p through unchanged to all relays", () => {
    const reasoning: RelaySelectionReasoning[] = [
      { relay: relay1, writers: [alice], readers: [carol], isFallback: false },
      { relay: relay2, writers: [bob], readers: [], isFallback: false },
    ];

    const result = chunkFiltersByRelay(
      { kinds: [1], authors: [alice, bob], "#p": [carol, dave] },
      reasoning,
    );

    // Both relays should get the full #p array unchanged
    expect(result[relay1]![0]["#p"]).toEqual([carol, dave]);
    expect(result[relay2]![0]["#p"]).toEqual([carol, dave]);
  });

  it("returns empty object for empty reasoning", () => {
    const result = chunkFiltersByRelay({ kinds: [1], authors: [alice] }, []);
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
        "#p": [carol],
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
        "#p": [carol],
        search: "hello",
      },
    ]);
  });

  it("returns empty object for filter with no authors", () => {
    const reasoning: RelaySelectionReasoning[] = [
      { relay: relay1, writers: [alice], readers: [carol], isFallback: false },
    ];

    // Filter only has #p, no authors — nothing to chunk
    const result = chunkFiltersByRelay(
      { kinds: [1], "#p": [carol] },
      reasoning,
    );
    expect(result).toEqual({});
  });

  it("returns empty object for filter with no authors and no #p", () => {
    const reasoning: RelaySelectionReasoning[] = [
      { relay: relay1, writers: [alice], readers: [], isFallback: false },
    ];

    const result = chunkFiltersByRelay({ kinds: [1] }, reasoning);
    expect(result).toEqual({});
  });

  it("handles filter array input — each filter chunked independently and merged per relay", () => {
    const reasoning: RelaySelectionReasoning[] = [
      { relay: relay1, writers: [alice], readers: [carol], isFallback: false },
      { relay: relay2, writers: [bob], readers: [], isFallback: false },
    ];

    const result = chunkFiltersByRelay(
      [
        { kinds: [1], authors: [alice, bob] },
        { kinds: [7], authors: [alice] },
      ],
      reasoning,
    );

    // relay1 gets alice from both filters
    expect(result[relay1]).toHaveLength(2);
    expect(result[relay1]![0]).toEqual({ kinds: [1], authors: [alice] });
    expect(result[relay1]![1]).toEqual({ kinds: [7], authors: [alice] });

    // relay2 gets bob from first filter only
    expect(result[relay2]).toHaveLength(1);
    expect(result[relay2]![0]).toEqual({ kinds: [1], authors: [bob] });
  });

  it("skips a relay when it has no relevant authors", () => {
    const reasoning: RelaySelectionReasoning[] = [
      { relay: relay1, writers: [alice], readers: [], isFallback: false },
      { relay: relay2, writers: [dave], readers: [], isFallback: false },
    ];

    // dave is assigned to relay2 but not in the filter — relay2 gets skipped
    const result = chunkFiltersByRelay(
      { kinds: [1], authors: [alice] },
      reasoning,
    );

    expect(result[relay1]).toBeDefined();
    expect(result[relay2]).toBeUndefined();
  });

  it("deduplicates authors that appear in both reasoning and unassigned", () => {
    const reasoning: RelaySelectionReasoning[] = [
      { relay: relay1, writers: [alice], readers: [], isFallback: false },
    ];

    const result = chunkFiltersByRelay(
      { kinds: [1], authors: [alice] },
      reasoning,
    );

    // alice should appear exactly once
    expect(result[relay1]![0].authors).toEqual([alice]);
  });
});
