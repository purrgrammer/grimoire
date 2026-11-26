import { describe, expect, it } from "vitest";
import {
  deriveRelayRows,
  effectiveSelection,
  hasActiveOverrides,
  inboxPubkeys,
  INBOX_RELAYS_PER_RECIPIENT,
  MAX_AUTO_INBOX_RELAYS,
  summarizeRecipientDelivery,
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

describe("tagged people's inboxes", () => {
  const ALICE = "a".repeat(64);
  const BOB = "b".repeat(64);
  const base = {
    ownWrite: ["wss://mine.example.com/"],
    fallback: FALLBACK,
    manual: ["wss://added.example.com/"],
  };

  it("adds inbox rows in their own section, checked", () => {
    const rows = deriveRelayRows({
      ...base,
      recipients: [{ pubkey: ALICE, relays: ["wss://alice.example.com"] }],
    });
    expect(rows.map((r) => [r.url, r.section, r.defaultSelected])).toEqual([
      ["wss://mine.example.com/", "author", true],
      ["wss://added.example.com/", "author", true],
      ["wss://alice.example.com/", "recipients", true],
    ]);
    expect(inboxPubkeys(rows[2])).toEqual([ALICE]);
  });

  it("keeps a relay that is also the author's in the author section, with both reasons", () => {
    const rows = deriveRelayRows({
      ...base,
      recipients: [{ pubkey: ALICE, relays: ["wss://MINE.example.com"] }],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].section).toBe("author");
    expect(rows[0].origins).toEqual([
      { type: "own-write" },
      { type: "inbox", pubkey: ALICE },
    ]);
  });

  it("merges a relay two people read from into one row", () => {
    const rows = deriveRelayRows({
      ...base,
      recipients: [
        { pubkey: ALICE, relays: ["wss://shared.example.com"] },
        {
          pubkey: BOB,
          relays: ["wss://shared.example.com/", "wss://bob.example.com"],
        },
      ],
    });
    const shared = rows.find((r) => r.url === "wss://shared.example.com/");
    expect(shared && inboxPubkeys(shared)).toEqual([ALICE, BOB]);
    expect(rows.filter((r) => r.section === "recipients")).toHaveLength(2);
  });

  it("keeps a shared relay when one of its people is no longer tagged", () => {
    const rows = deriveRelayRows({
      ...base,
      recipients: [{ pubkey: BOB, relays: ["wss://shared.example.com"] }],
    });
    expect(rows.map((r) => r.url)).toContain("wss://shared.example.com/");
  });

  it("checks at most 4 relays per person and lists the rest unchecked", () => {
    const relays = [1, 2, 3, 4, 5, 6].map((n) => `wss://a${n}.example.com/`);
    const rows = deriveRelayRows({
      ...base,
      recipients: [{ pubkey: ALICE, relays }],
    }).filter((r) => r.section === "recipients");
    expect(rows.filter((r) => r.defaultSelected)).toHaveLength(
      INBOX_RELAYS_PER_RECIPIENT,
    );
    expect(rows[5].notAutoSelected).toBe("limit");
  });

  it("checks at most 12 inbox relays in total", () => {
    const recipients = [0, 1, 2, 3].map((p) => ({
      pubkey: String(p).repeat(64),
      relays: [0, 1, 2, 3].map((n) => `wss://p${p}-r${n}.example.com/`),
    }));
    const rows = deriveRelayRows({ ...base, recipients }).filter(
      (r) => r.section === "recipients",
    );
    expect(rows).toHaveLength(16);
    expect(rows.filter((r) => r.defaultSelected)).toHaveLength(
      MAX_AUTO_INBOX_RELAYS,
    );
  });

  it("lists an unencrypted ws:// inbox without checking it", () => {
    const rows = deriveRelayRows({
      ...base,
      recipients: [{ pubkey: ALICE, relays: ["ws://plain.example.com"] }],
    });
    const plain = rows.find((r) => r.url === "ws://plain.example.com/");
    expect(plain?.defaultSelected).toBe(false);
    expect(plain?.notAutoSelected).toBe("insecure");
  });

  it("respects an untick on an inbox row whatever arrives later", () => {
    const overrides = { "wss://alice.example.com/": false };
    const first = deriveRelayRows({
      ...base,
      recipients: [{ pubkey: ALICE, relays: ["wss://alice.example.com"] }],
    });
    const later = deriveRelayRows({
      ...base,
      recipients: [
        {
          pubkey: ALICE,
          relays: ["wss://alice.example.com", "wss://alice2.example.com"],
        },
      ],
    });
    expect(effectiveSelection(first, overrides)).not.toContain(
      "wss://alice.example.com/",
    );
    expect(effectiveSelection(later, overrides)).toEqual([
      "wss://mine.example.com/",
      "wss://added.example.com/",
      "wss://alice2.example.com/",
    ]);
  });
});

describe("summarizeRecipientDelivery", () => {
  const ALICE = "a".repeat(64);
  const BOB = "b".repeat(64);
  const CAROL = "c".repeat(64);
  const rows = deriveRelayRows({
    ownWrite: ["wss://mine.example.com/"],
    fallback: FALLBACK,
    manual: [],
    recipients: [
      { pubkey: ALICE, relays: ["wss://a.example.com/"] },
      { pubkey: BOB, relays: ["wss://b.example.com/"] },
    ],
  });

  it("separates accepted, rejected and not sent, from relay answers only", () => {
    expect(
      summarizeRecipientDelivery(
        [ALICE, BOB, CAROL],
        rows,
        [
          "wss://mine.example.com/",
          "wss://a.example.com/",
          "wss://b.example.com/",
        ],
        ["wss://mine.example.com/", "wss://a.example.com/"],
      ),
    ).toEqual({ accepted: [ALICE], rejected: [BOB], noInboxSelected: [CAROL] });
  });

  it("counts an unticked inbox as not sent", () => {
    expect(
      summarizeRecipientDelivery(
        [ALICE],
        rows,
        ["wss://mine.example.com/"],
        ["wss://mine.example.com/"],
      ).noInboxSelected,
    ).toEqual([ALICE]);
  });
});
