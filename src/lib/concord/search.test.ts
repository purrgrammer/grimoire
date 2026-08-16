import { describe, expect, it } from "vitest";

import {
  contentMatches,
  EMPTY_SEARCH_FILTERS,
  searchIsActive,
  searchNeedle,
} from "@/lib/concord/search";

describe("when a search is a search", () => {
  it("does not run on nothing typed", () => {
    expect(searchIsActive(EMPTY_SEARCH_FILTERS)).toBe(false);
  });

  it("does not run on one character", () => {
    expect(searchIsActive({ query: "a", channelIds: [] })).toBe(false);
  });

  it("runs from two characters", () => {
    expect(searchIsActive({ query: "ab", channelIds: [] })).toBe(true);
  });

  it("ignores surrounding whitespace when deciding", () => {
    expect(searchIsActive({ query: "  a  ", channelIds: [] })).toBe(false);
    expect(searchIsActive({ query: "  ab  ", channelIds: [] })).toBe(true);
  });

  it("is not activated by a channel narrowing alone", () => {
    // A scope is not a query: narrowing to a channel with nothing typed must
    // not dump that channel's whole history into the results pane.
    expect(searchIsActive({ query: "", channelIds: ["ab".repeat(32)] })).toBe(
      false,
    );
  });
});

describe("the needle", () => {
  it("is trimmed and lowercased", () => {
    expect(searchNeedle({ query: "  HeLLo  ", channelIds: [] })).toBe("hello");
  });

  it("is empty whenever the search would not run", () => {
    expect(searchNeedle({ query: "x", channelIds: [] })).toBe("");
  });
});

describe("the content predicate", () => {
  it("matches a substring case-insensitively", () => {
    expect(contentMatches("Good Morning", "morn")).toBe(true);
  });

  it("never matches on an empty needle", () => {
    // Or every message in the community would be a hit.
    expect(contentMatches("anything", "")).toBe(false);
  });
});
