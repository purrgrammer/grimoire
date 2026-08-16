import { describe, expect, it } from "vitest";

import { mentionsPubkey } from "./mentions";

const ME = "11".repeat(32);
const THEM = "22".repeat(32);

describe("mentionsPubkey", () => {
  it("finds a p tag naming the reader", () => {
    expect(mentionsPubkey([["p", ME]], ME)).toBe(true);
  });

  it("ignores a p tag naming someone else", () => {
    expect(mentionsPubkey([["p", THEM]], ME)).toBe(false);
  });

  it("ignores an e tag carrying the reader's key", () => {
    expect(mentionsPubkey([["e", ME]], ME)).toBe(false);
  });

  it("matches regardless of the tag's case", () => {
    expect(mentionsPubkey([["p", ME.toUpperCase()]], ME)).toBe(true);
  });

  it("finds the reader among several p tags", () => {
    expect(
      mentionsPubkey(
        [
          ["p", THEM],
          ["e", "aa".repeat(32)],
          ["p", ME],
        ],
        ME,
      ),
    ).toBe(true);
  });

  it("is false with no tags, and false without a reader", () => {
    expect(mentionsPubkey([], ME)).toBe(false);
    expect(mentionsPubkey([["p", ME]], "")).toBe(false);
  });

  it("survives a malformed tag with no value", () => {
    expect(mentionsPubkey([["p"]], ME)).toBe(false);
  });
});
