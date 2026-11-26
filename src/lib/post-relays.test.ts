import { describe, expect, it } from "vitest";
import {
  deriveRelayRows,
  effectiveSelection,
  hasActiveOverrides,
} from "./post-relays";

const FALLBACK = ["wss://fallback.example.com/"];

describe("deriveRelayRows", () => {
  it("uses the account's write relays, normalized and deduplicated", () => {
    const rows = deriveRelayRows({
      ownWrite: ["wss://A.example.com", "wss://a.example.com/"],
      fallback: FALLBACK,
      manual: [],
    });
    expect(rows.map((r) => r.url)).toEqual(["wss://a.example.com/"]);
    expect(rows[0].origins).toEqual([{ type: "own-write" }]);
  });

  it("falls back only when the account has no write relays", () => {
    const rows = deriveRelayRows({
      ownWrite: [],
      fallback: FALLBACK,
      manual: [],
    });
    expect(rows.map((r) => r.url)).toEqual(FALLBACK);
    expect(rows[0].origins).toEqual([{ type: "fallback" }]);
  });

  it("merges a manual relay that is also a write relay into one row", () => {
    const rows = deriveRelayRows({
      ownWrite: ["wss://a.example.com/"],
      fallback: FALLBACK,
      manual: ["a.example.com", "wss://b.example.com"],
    });
    expect(rows.map((r) => r.url)).toEqual([
      "wss://a.example.com/",
      "wss://b.example.com/",
    ]);
    expect(rows[0].origins).toEqual([
      { type: "own-write" },
      { type: "manual" },
    ]);
  });

  it("skips URLs that cannot be relays", () => {
    const rows = deriveRelayRows({
      ownWrite: ["not a url", "wss://ok.example.com"],
      fallback: FALLBACK,
      manual: ["::::"],
    });
    expect(rows.map((r) => r.url)).toEqual(["wss://ok.example.com/"]);
  });
});

describe("effectiveSelection", () => {
  const rows = deriveRelayRows({
    ownWrite: ["wss://a.example.com/", "wss://b.example.com/"],
    fallback: FALLBACK,
    manual: [],
  });

  it("selects every default row without overrides", () => {
    expect(effectiveSelection(rows, {})).toEqual([
      "wss://a.example.com/",
      "wss://b.example.com/",
    ]);
  });

  it("lets an override win over the default, and ignores rowless overrides", () => {
    expect(
      effectiveSelection(rows, {
        "wss://b.example.com/": false,
        "wss://gone.example.com/": true,
      }),
    ).toEqual(["wss://a.example.com/"]);
  });

  it("keeps an untick when the row list later grows", () => {
    const overrides = { "wss://b.example.com/": false };
    const grown = deriveRelayRows({
      ownWrite: [
        "wss://a.example.com/",
        "wss://b.example.com/",
        "wss://c.example.com/",
      ],
      fallback: FALLBACK,
      manual: [],
    });
    expect(effectiveSelection(grown, overrides)).toEqual([
      "wss://a.example.com/",
      "wss://c.example.com/",
    ]);
  });

  it("reports overrides only when they change a visible row", () => {
    expect(hasActiveOverrides(rows, { "wss://a.example.com/": true })).toBe(
      false,
    );
    expect(hasActiveOverrides(rows, { "wss://a.example.com/": false })).toBe(
      true,
    );
    expect(hasActiveOverrides(rows, { "wss://x.example.com/": false })).toBe(
      false,
    );
  });
});
