/**
 * CORD-06 read side. Ported from armada `bc19d1f` (`src/concord/lib/rekey.test.ts`),
 * narrowed to what grimoire keeps — every builder here is a test fixture,
 * because the module ships none.
 */

import { describe, expect, it } from "vitest";

import {
  bytesToHex,
  controlSignerGroupKey,
  epochKeyCommitment,
  random32,
} from "@/lib/concord/derive";
import { KIND_REKEY, KIND_SEAL_ENCRYPTED } from "@/lib/concord/kinds";
import {
  checkContinuity,
  decodeWrappedBaseKey,
  decodeWrappedKey,
  findBlob,
  groupRotations,
  lowerKeyWins,
  myLocator,
  parseRekey,
  rekeyScopeId,
  ROOT_SCOPE_HEX,
  rotationExcludesMe,
  rotationPublishedAtMs,
  type ParsedRekey,
} from "@/lib/concord/rekey";
import type { OpenedEvent } from "@/lib/concord/stream";

const ZERO32 = new Uint8Array(32);

// ── Fixtures (armada's builders, test-only here) ─────────────────────────────

function encodeWrappedKey(
  scopeId: Uint8Array,
  newEpoch: bigint,
  newKey: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(72);
  out.set(scopeId, 0);
  new DataView(out.buffer).setBigUint64(32, newEpoch, false);
  out.set(newKey, 40);
  return out;
}

function encodeWrappedBaseKey(
  newEpoch: bigint,
  newRoot: Uint8Array,
  newControlPk: Uint8Array,
  newControlRoot?: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(newControlRoot ? 136 : 104);
  out.set(encodeWrappedKey(ZERO32, newEpoch, newRoot), 0);
  out.set(newControlPk, 72);
  if (newControlRoot) out.set(newControlRoot, 104);
  return out;
}

let nextId = 0;
function rekeyEvent(over: {
  rotator: string;
  scopeIdHex: string;
  newEpoch: bigint;
  prevEpoch: bigint;
  prevCommit: string;
  blobs?: Array<{ locator: string; wrapped: string }>;
  chunk?: [number, number];
  ms?: number;
  vac?: string[];
}): OpenedEvent {
  const chunk = over.chunk ?? [1, 1];
  return {
    rumorId: (nextId++).toString(16).padStart(64, "0"),
    author: over.rotator,
    kind: KIND_REKEY,
    content: JSON.stringify(over.blobs ?? []),
    tags: [
      ["scope", over.scopeIdHex],
      ["newepoch", over.newEpoch.toString()],
      ["prevepoch", over.prevEpoch.toString()],
      ["prevcommit", over.prevCommit],
      ["chunk", chunk[0].toString(), chunk[1].toString()],
      ...(over.vac ? [over.vac] : []),
    ],
    ms: over.ms ?? 1000,
    createdAt: Math.floor((over.ms ?? 1000) / 1000),
    sealKind: KIND_SEAL_ENCRYPTED,
  };
}

const rotator = "aa".repeat(32);
const me = "bb".repeat(32);
const communityId = random32();

describe("rekeyScopeId", () => {
  it("is the channel id, or all-zeroes for the root", () => {
    const channelId = random32();
    expect(bytesToHex(rekeyScopeId({ kind: "channel", channelId }))).toBe(
      bytesToHex(channelId),
    );
    expect(bytesToHex(rekeyScopeId({ kind: "root" }))).toBe(ROOT_SCOPE_HEX);
  });
});

describe("decodeWrappedKey (channel, 72 bytes)", () => {
  const channelId = random32();
  const newKey = random32();

  it("round-trips a blob minted for this channel at this epoch", () => {
    const plain = encodeWrappedKey(channelId, 3n, newKey);
    expect(bytesToHex(decodeWrappedKey(plain, channelId, 3n))).toBe(
      bytesToHex(newKey),
    );
  });

  it("refuses a blob minted for ANOTHER channel — scope binds inside the ciphertext", () => {
    const plain = encodeWrappedKey(random32(), 3n, newKey);
    expect(() => decodeWrappedKey(plain, channelId, 3n)).toThrow(/scope/);
  });

  it("refuses a blob minted at another epoch", () => {
    const plain = encodeWrappedKey(channelId, 4n, newKey);
    expect(() => decodeWrappedKey(plain, channelId, 3n)).toThrow(/epoch/);
  });

  it("refuses any other width", () => {
    expect(() => decodeWrappedKey(new Uint8Array(71), channelId, 3n)).toThrow();
    expect(() =>
      decodeWrappedKey(new Uint8Array(104), channelId, 3n),
    ).toThrow();
  });
});

describe("decodeWrappedBaseKey", () => {
  const newRoot = random32();
  const controlRoot = random32();

  it("reads a legacy 72-byte blob with no control pair", () => {
    // A pre-split epoch: its Control Plane folds at the member-derivable
    // legacy address, so neither field is present and that is not an error.
    const plain = encodeWrappedKey(ZERO32, 2n, newRoot);
    const out = decodeWrappedBaseKey(plain, communityId, 2n);
    expect(bytesToHex(out.newRoot)).toBe(bytesToHex(newRoot));
    expect(out.controlPk).toBeUndefined();
    expect(out.controlRoot).toBeUndefined();
  });

  it("reads a 104-byte member blob: the root plus the next control address", () => {
    const controlPk = controlSignerGroupKey(controlRoot, communityId, 2n).pk;
    const plain = encodeWrappedBaseKey(
      2n,
      newRoot,
      Uint8Array.from(Buffer.from(controlPk, "hex")),
    );
    const out = decodeWrappedBaseKey(plain, communityId, 2n);
    expect(out.controlPk).toBe(controlPk);
    expect(out.controlRoot).toBeUndefined();
  });

  it("reads a 136-byte staff blob and verifies the pair derives", () => {
    const controlPk = controlSignerGroupKey(controlRoot, communityId, 2n).pk;
    const plain = encodeWrappedBaseKey(
      2n,
      newRoot,
      Uint8Array.from(Buffer.from(controlPk, "hex")),
      controlRoot,
    );
    const out = decodeWrappedBaseKey(plain, communityId, 2n);
    expect(out.controlPk).toBe(controlPk);
    expect(bytesToHex(out.controlRoot!)).toBe(bytesToHex(controlRoot));
  });

  it("refuses a staff blob whose control_root does not derive to its control_pk", () => {
    // CORD-02 §5: refuse the pair WHOLE rather than adopt a plane split from
    // its own readers.
    const plain = encodeWrappedBaseKey(2n, newRoot, random32(), controlRoot);
    expect(() => decodeWrappedBaseKey(plain, communityId, 2n)).toThrow(
      /control_root/,
    );
  });

  it("refuses a channel-scoped blob spliced onto the base", () => {
    const plain = encodeWrappedKey(random32(), 2n, newRoot);
    expect(() => decodeWrappedBaseKey(plain, communityId, 2n)).toThrow(/scope/);
  });

  it("refuses any width outside 72/104/136", () => {
    expect(() =>
      decodeWrappedBaseKey(new Uint8Array(120), communityId, 2n),
    ).toThrow();
  });
});

describe("parseRekey", () => {
  const base = {
    rotator,
    scopeIdHex: ROOT_SCOPE_HEX,
    newEpoch: 2n,
    prevEpoch: 1n,
    prevCommit: "cc".repeat(32),
  };

  it("reads the rotation fields off the tags", () => {
    const parsed = parseRekey(rekeyEvent({ ...base, chunk: [2, 3] }));
    expect(parsed.rotator).toBe(rotator);
    expect(parsed.newEpoch).toBe(2n);
    expect(parsed.chunkIndex).toBe(2);
    expect(parsed.chunkCount).toBe(3);
  });

  it("refuses a plaintext-sealed rekey (CORD-02 §5)", () => {
    const event = rekeyEvent(base);
    expect(() => parseRekey({ ...event, sealKind: 20014 })).toThrow(
      /encrypted/,
    );
  });

  it("refuses non-decimal chunk coordinates a stricter peer would refuse", () => {
    const event = rekeyEvent(base);
    const tags = event.tags.map((t) =>
      t[0] === "chunk" ? ["chunk", "1e2", "3"] : t,
    );
    expect(() => parseRekey({ ...event, tags })).toThrow(/chunk/);
  });

  it("refuses a chunk index past its own count", () => {
    expect(() => parseRekey(rekeyEvent({ ...base, chunk: [4, 3] }))).toThrow(
      /chunk/,
    );
  });

  it("drops malformed blobs rather than the whole rotation", () => {
    const event = rekeyEvent(base);
    const parsed = parseRekey({
      ...event,
      content: JSON.stringify([
        { locator: "aa", wrapped: "bb" },
        { locator: 7 },
        null,
      ]),
    });
    expect(parsed.blobs).toEqual([{ locator: "aa", wrapped: "bb" }]);
  });
});

describe("groupRotations", () => {
  const commit = "cc".repeat(32);
  const parse = (e: OpenedEvent): ParsedRekey => parseRekey(e);

  it("is complete only once every chunk is held — a missing chunk is never a removal", () => {
    const one = parse(
      rekeyEvent({
        rotator,
        scopeIdHex: ROOT_SCOPE_HEX,
        newEpoch: 2n,
        prevEpoch: 1n,
        prevCommit: commit,
        chunk: [1, 2],
      }),
    );
    expect(groupRotations([one])[0].complete).toBe(false);

    const two = parse(
      rekeyEvent({
        rotator,
        scopeIdHex: ROOT_SCOPE_HEX,
        newEpoch: 2n,
        prevEpoch: 1n,
        prevCommit: commit,
        chunk: [2, 2],
      }),
    );
    expect(groupRotations([one, two])[0].complete).toBe(true);
  });

  it("never merges two rotators racing the same epoch into one set", () => {
    // The correlation key is (rotator, scope, newepoch, prevcommit). Merging
    // them would let one rotator's chunk count complete the other's set.
    const other = "dd".repeat(32);
    const sets = groupRotations([
      parse(
        rekeyEvent({
          rotator,
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: 2n,
          prevEpoch: 1n,
          prevCommit: commit,
          chunk: [1, 2],
        }),
      ),
      parse(
        rekeyEvent({
          rotator: other,
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: 2n,
          prevEpoch: 1n,
          prevCommit: commit,
          chunk: [2, 2],
        }),
      ),
    ]);
    expect(sets).toHaveLength(2);
    expect(sets.every((s) => !s.complete)).toBe(true);
  });

  it("ignores a chunk claiming a different total for the same rotation", () => {
    const sets = groupRotations([
      parse(
        rekeyEvent({
          rotator,
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: 2n,
          prevEpoch: 1n,
          prevCommit: commit,
          chunk: [1, 3],
        }),
      ),
      parse(
        rekeyEvent({
          rotator,
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: 2n,
          prevEpoch: 1n,
          prevCommit: commit,
          chunk: [2, 2],
        }),
      ),
    ]);
    expect(sets).toHaveLength(1);
    expect(sets[0].chunkCount).toBe(3);
    expect(sets[0].chunks.size).toBe(1);
  });
});

describe("checkContinuity", () => {
  const heldKey = random32();
  const commitAt = (epoch: bigint, key: Uint8Array) =>
    bytesToHex(epochKeyCommitment(epoch, key));

  it("accepts a rotation that provably extends the key we hold", () => {
    const set = { prevEpoch: 1n, prevCommit: commitAt(1n, heldKey) };
    expect(checkContinuity(set, 1n, heldKey)).toEqual({ ok: true });
  });

  it("calls a mismatch at our own epoch a FORK, not a gap", () => {
    const set = { prevEpoch: 1n, prevCommit: commitAt(1n, random32()) };
    expect(checkContinuity(set, 1n, heldKey)).toEqual({
      ok: false,
      reason: "fork",
    });
  });

  it("calls a higher prevepoch a GAP — fetch the missing link, never waive", () => {
    const set = { prevEpoch: 3n, prevCommit: commitAt(3n, heldKey) };
    expect(checkContinuity(set, 1n, heldKey)).toEqual({
      ok: false,
      reason: "gap",
    });
  });

  it("calls a lower prevepoch a fork", () => {
    const set = { prevEpoch: 0n, prevCommit: commitAt(0n, heldKey) };
    expect(checkContinuity(set, 1n, heldKey).ok).toBe(false);
  });
});

describe("findBlob / locators", () => {
  it("finds our blob in whichever chunk carries it", () => {
    const commit = "cc".repeat(32);
    const locator = myLocator(rotator, me, ROOT_SCOPE_HEX, 2n);
    const sets = groupRotations([
      parseRekey(
        rekeyEvent({
          rotator,
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: 2n,
          prevEpoch: 1n,
          prevCommit: commit,
          chunk: [1, 2],
          blobs: [{ locator: "ff".repeat(32), wrapped: "x" }],
        }),
      ),
      parseRekey(
        rekeyEvent({
          rotator,
          scopeIdHex: ROOT_SCOPE_HEX,
          newEpoch: 2n,
          prevEpoch: 1n,
          prevCommit: commit,
          chunk: [2, 2],
          blobs: [{ locator, wrapped: "mine" }],
        }),
      ),
    ]);
    expect(findBlob(sets[0], locator)?.wrapped).toBe("mine");
    expect(findBlob(sets[0], "00".repeat(32))).toBeUndefined();
  });

  it("derives a locator from public inputs, distinct per scope and epoch", () => {
    const a = myLocator(rotator, me, ROOT_SCOPE_HEX, 2n);
    expect(a).toBe(myLocator(rotator, me, ROOT_SCOPE_HEX, 2n));
    expect(a).not.toBe(myLocator(rotator, me, ROOT_SCOPE_HEX, 3n));
    expect(a).not.toBe(myLocator(rotator, me, "ab".repeat(32), 2n));
    expect(a).not.toBe(myLocator(rotator, "cc".repeat(32), ROOT_SCOPE_HEX, 2n));
  });
});

describe("rotationExcludesMe", () => {
  it("does not read a rotation that PREDATES the join as a removal", () => {
    // A member joining on a stale public invite lands ON a historical
    // Refounding they were never part of: complete, continuity-valid, and with
    // no blob at their locator. Reading that as a removal ejects every fresh
    // joiner seconds after they arrive.
    expect(rotationExcludesMe(1_000, 5_000)).toBe(false);
    expect(rotationExcludesMe(5_000, 5_000)).toBe(true);
    expect(rotationExcludesMe(9_000, 5_000)).toBe(true);
  });

  it("takes a rotation's publish time as the NEWEST of its chunks", () => {
    const commit = "cc".repeat(32);
    const sets = groupRotations(
      [1, 2].map((i) =>
        parseRekey(
          rekeyEvent({
            rotator,
            scopeIdHex: ROOT_SCOPE_HEX,
            newEpoch: 2n,
            prevEpoch: 1n,
            prevCommit: commit,
            chunk: [i, 2],
            ms: i * 1000,
          }),
        ),
      ),
    );
    expect(rotationPublishedAtMs(sets[0])).toBe(2000);
  });
});

describe("lowerKeyWins", () => {
  it("converges two racing rotations on the lexicographically lower key", () => {
    const low = new Uint8Array(32).fill(1);
    const high = new Uint8Array(32).fill(2);
    expect(bytesToHex(lowerKeyWins(low, high))).toBe(bytesToHex(low));
    expect(bytesToHex(lowerKeyWins(high, low))).toBe(bytesToHex(low));
  });
});
