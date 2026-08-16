/**
 * The arithmetic that keeps a paged timeline from teleporting.
 *
 * Every case here is one the naive `next.length - prev.length` gets wrong, which
 * is the whole reason the delta is measured against a row's identity.
 */

import { describe, expect, it } from "vitest";

import { computeFirstItemIndexDelta, type AnchorItem } from "./prepend-anchor";

const msg = (id: string): AnchorItem => ({ type: "message", data: { id } });
const marker = (label: string, timestamp = 0): AnchorItem => ({
  type: "day-marker",
  data: label,
  timestamp,
});
const divider: AnchorItem = { type: "unread-divider" };
const grouped = (...ids: string[]): AnchorItem => ({
  type: "grouped-system",
  data: { messageIds: ids },
});

describe("computeFirstItemIndexDelta", () => {
  it("counts the rows that landed above the old top row", () => {
    const prev = [marker("Tue"), msg("c"), msg("d")];
    const next = [
      marker("Mon"),
      msg("a"),
      msg("b"),
      marker("Tue"),
      msg("c"),
      msg("d"),
    ];
    // Three rows above `c` where there was one: the page brought two messages
    // AND a day marker, which a length difference would also have counted —
    // until the same page also appends, which the next case covers.
    expect(computeFirstItemIndexDelta(prev, next)).toBe(3);
  });

  it("ignores rows appended below", () => {
    const prev = [marker("Tue"), msg("c")];
    const next = [marker("Tue"), msg("c"), msg("d"), msg("e")];
    expect(computeFirstItemIndexDelta(prev, next)).toBe(0);
  });

  it("does not count an append as a prepend when both happen at once", () => {
    const prev = [marker("Tue"), msg("c")];
    const next = [marker("Mon"), msg("a"), marker("Tue"), msg("c"), msg("e")];
    // Length grew by three; only two rows are above the anchor. Following the
    // length would push the list two rows out of alignment, permanently.
    expect(computeFirstItemIndexDelta(prev, next)).toBe(2);
  });

  it("counts a day marker that a prepend made redundant", () => {
    // The old top marker started the day; older messages of the SAME day now
    // start it instead, so the marker moved rather than multiplied.
    const prev = [marker("Tue"), msg("c")];
    const next = [marker("Tue"), msg("a"), msg("b"), msg("c")];
    expect(computeFirstItemIndexDelta(prev, next)).toBe(2);
  });

  it("counts the unread divider as a row, because Virtuoso does", () => {
    const prev = [msg("c"), msg("d")];
    const next = [divider, msg("c"), msg("d")];
    expect(computeFirstItemIndexDelta(prev, next)).toBe(1);
  });

  it("is zero for an identical re-emission", () => {
    const prev = [marker("Tue"), msg("c"), msg("d")];
    expect(computeFirstItemIndexDelta(prev, [...prev])).toBe(0);
  });

  it("anchors on a grouped system row when that is what is on top", () => {
    const prev = [grouped("s1", "s2"), msg("c")];
    const next = [msg("a"), grouped("s1", "s2"), msg("c")];
    expect(computeFirstItemIndexDelta(prev, next)).toBe(1);
  });

  it("finds the anchor again when its group absorbed more rows", () => {
    const prev = [grouped("s2"), msg("c")];
    const next = [msg("a"), grouped("s1", "s2"), msg("c")];
    expect(computeFirstItemIndexDelta(prev, next)).toBe(1);
  });

  it("asks for a reset when the timeline was replaced", () => {
    // A conversation switch, or a fold that dropped the row we anchored on.
    // Guessing a delta here mis-keys every row on screen; a reset costs one
    // un-anchored repaint.
    expect(computeFirstItemIndexDelta([msg("c")], [msg("x"), msg("y")])).toBe(
      null,
    );
  });

  it("asks for a reset across an empty timeline in either direction", () => {
    expect(computeFirstItemIndexDelta([], [msg("a")])).toBe(null);
    expect(computeFirstItemIndexDelta([msg("a")], [])).toBe(null);
  });

  it("asks for a reset when nothing on top carried an id", () => {
    expect(computeFirstItemIndexDelta([marker("Tue")], [msg("a")])).toBe(null);
  });

  it("reports a row removed above the anchor as a negative delta", () => {
    // The day marker stopped starting a day. The offset has to move back UP, so
    // the caller must not clamp this at zero.
    const prev = [marker("Tue"), msg("a"), msg("b")];
    const next = [msg("a"), msg("b")];
    expect(computeFirstItemIndexDelta(prev, next)).toBe(-1);
  });

  it("asks for a reset when the anchor row itself was deleted", () => {
    expect(computeFirstItemIndexDelta([msg("a"), msg("b")], [msg("b")])).toBe(
      null,
    );
  });
});
