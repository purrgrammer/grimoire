import { describe, expect, it } from "vitest";

import { bytesToHex } from "./derive";
import {
  buildEditionRumor,
  citationFromTags,
  citationToTag,
  isTagDecimal,
  parseEdition,
  toFoldEdition,
} from "./edition";
import {
  KIND_CONTROL,
  KIND_SEAL_ENCRYPTED,
  KIND_SEAL_PLAINTEXT,
} from "./kinds";
import type { OpenedEvent } from "./stream";
import { editionHash } from "./version";

const ACTOR = "aa".repeat(32);
const EID = new Uint8Array(32).fill(7);
const HASH = new Uint8Array(32).fill(9);

/** An opened control event carrying `tags`, as the stream layer would hand it over. */
function opened(
  tags: string[][],
  over: Partial<OpenedEvent> = {},
): OpenedEvent {
  return {
    rumorId: "bb".repeat(32),
    author: ACTOR,
    kind: KIND_CONTROL,
    content: '{"name":"x"}',
    tags,
    ms: 1_719_800_000_000,
    createdAt: 1_719_800_000,
    sealKind: KIND_SEAL_PLAINTEXT,
    ...over,
  };
}

const machinery = (over: Record<string, string> = {}) => [
  ["vsk", over.vsk ?? "0"],
  ["eid", over.eid ?? bytesToHex(EID)],
  ["ev", over.ev ?? "4"],
];

describe("tag numbers ride as spec-shaped decimals (CORD-01 §5)", () => {
  it("accepts a plain decimal with no leading zeros", () => {
    expect(isTagDecimal("0")).toBe(true);
    expect(isTagDecimal("4")).toBe(true);
    expect(isTagDecimal("1234567890123456789")).toBe(true);
  });

  it("rejects every shape BigInt() would silently accept", () => {
    // A peer that rejects these would drop an edition we honored, and neither
    // side would ever see the divergence — a declined parse is not logged.
    for (const bad of ["04", "+4", "0x4", "1e2", " 4 ", "", "-1", "4.0"]) {
      expect(isTagDecimal(bad)).toBe(false);
    }
    expect(isTagDecimal(undefined)).toBe(false);
  });
});

describe("edition parsing (CORD-04 §1)", () => {
  it("round-trips what buildEditionRumor produced", () => {
    const rumor = buildEditionRumor({
      vsk: "1",
      entityId: EID,
      version: 4n,
      prevHash: HASH,
      content: "{}",
      actorPubkey: ACTOR,
      createdAtSecs: 1_719_800_000,
    });
    const parsed = parseEdition(
      opened(rumor.tags, {
        content: rumor.content,
        createdAt: rumor.created_at,
      }),
    );
    expect(parsed.vsk).toBe("1");
    expect(parsed.version).toBe(4n);
    expect(bytesToHex(parsed.entityId)).toBe(bytesToHex(EID));
    expect(bytesToHex(parsed.prevHash!)).toBe(bytesToHex(HASH));
  });

  it("computes selfHash over the content bytes AS CARRIED", () => {
    // Never a re-serialization: a compaction re-wraps the same bytes, and the
    // hash has to survive that untouched.
    const content = '{"b":1,"a":2}';
    const parsed = parseEdition(opened(machinery(), { content }));
    expect(bytesToHex(parsed.selfHash)).toBe(
      bytesToHex(
        editionHash(EID, 4n, undefined, new TextEncoder().encode(content)),
      ),
    );
  });

  it("omits prevHash on a first edition", () => {
    expect(
      parseEdition(opened(machinery({ ev: "1" }))).prevHash,
    ).toBeUndefined();
  });

  it("refuses a non-control kind", () => {
    expect(() => parseEdition(opened(machinery(), { kind: 9 }))).toThrow();
  });

  it("refuses an encrypted seal", () => {
    // A control edition under an encrypted seal could never survive a
    // compaction re-wrap, so honoring it would mint state that vanishes for
    // the next fresh joiner (CORD-02 §5).
    expect(() =>
      parseEdition(opened(machinery(), { sealKind: KIND_SEAL_ENCRYPTED })),
    ).toThrow(/seal-kind/);
  });

  it("accepts a STORED rumor, which has no seal form left to check", () => {
    // The store applied the rule at ingest; a row read back carries no envelope.
    expect(parseEdition(opened(machinery(), { sealKind: undefined })).vsk).toBe(
      "0",
    );
  });

  it("refuses duplicate machinery tags", () => {
    // Two `ev` tags make the canonical bytes ambiguous, so the edition hash
    // would depend on which one a client happened to read.
    for (const dup of [
      ["vsk", "1"],
      ["eid", bytesToHex(EID)],
      ["ev", "5"],
      ["ep", bytesToHex(HASH)],
    ]) {
      expect(() =>
        parseEdition(opened([...machinery(), ["ep", bytesToHex(HASH)], dup])),
      ).toThrow(/duplicate/);
    }
  });

  it("refuses missing or malformed machinery", () => {
    expect(() =>
      parseEdition(
        opened([
          ["eid", bytesToHex(EID)],
          ["ev", "1"],
        ]),
      ),
    ).toThrow(/vsk/);
    expect(() =>
      parseEdition(
        opened([
          ["vsk", "0"],
          ["ev", "1"],
        ]),
      ),
    ).toThrow(/eid/);
    expect(() =>
      parseEdition(
        opened([
          ["vsk", "0"],
          ["eid", bytesToHex(EID)],
        ]),
      ),
    ).toThrow(/ev/);
    expect(() => parseEdition(opened(machinery({ ev: "04" })))).toThrow(/ev/);
    expect(() => parseEdition(opened(machinery({ eid: "nope" })))).toThrow(
      /eid/,
    );
  });
});

describe("authority citations (the vac tag, CORD-04 §5)", () => {
  it("round-trips", () => {
    const c = { entityId: EID, version: 3n, editionHash: HASH };
    const back = citationFromTags([citationToTag(c)]);
    expect(back?.version).toBe(3n);
    expect(bytesToHex(back!.entityId)).toBe(bytesToHex(EID));
    expect(bytesToHex(back!.editionHash)).toBe(bytesToHex(HASH));
  });

  it("is absent when the owner acts", () => {
    expect(citationFromTags([["vsk", "0"]])).toBeUndefined();
    expect(parseEdition(opened(machinery())).authority).toBeUndefined();
  });

  it("refuses a malformed citation rather than half-reading it", () => {
    // A citation that never resolves parks its own action; one that parses
    // wrongly could resolve against the wrong edition.
    expect(
      citationFromTags([["vac", "nope", "3", bytesToHex(HASH)]]),
    ).toBeUndefined();
    expect(
      citationFromTags([["vac", bytesToHex(EID), "03", bytesToHex(HASH)]]),
    ).toBeUndefined();
    expect(
      citationFromTags([["vac", bytesToHex(EID), "3", "short"]]),
    ).toBeUndefined();
    expect(citationFromTags([["vac", bytesToHex(EID), "3"]])).toBeUndefined();
  });
});

describe("the fold view", () => {
  it("carries version, chain and the rumor-id tiebreak", () => {
    const parsed = parseEdition(
      opened([...machinery(), ["ep", bytesToHex(HASH)]]),
    );
    const view = toFoldEdition(parsed);
    expect(view.version).toBe(4n);
    expect(bytesToHex(view.prevHash!)).toBe(bytesToHex(HASH));
    expect(bytesToHex(view.tiebreakId)).toBe("bb".repeat(32));
    expect(bytesToHex(view.selfHash)).toBe(bytesToHex(parsed.selfHash));
  });
});
