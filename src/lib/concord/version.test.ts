import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";

import { bytesToHex } from "./derive";
import {
  bootstrapHead,
  editionHash,
  editionPreimage,
  fold,
  type Edition,
} from "./version";

const EID = new Uint8Array(32).fill(7);
const CONTENT = new TextEncoder().encode('{"name":"Vector"}');

/** An edition, defaulting to a well-formed link in a chain. */
function ed(over: Partial<Edition> & { version: bigint }): Edition {
  return {
    selfHash: new Uint8Array(32).fill(0xee),
    createdAt: 1_719_800_000,
    tiebreakId: new Uint8Array(32).fill(0x11),
    ...over,
  };
}

/** A chain of `n` linked editions, versions 1..n, each citing its predecessor. */
function chain(n: number, content = CONTENT): Edition[] {
  const out: Edition[] = [];
  let prev: Uint8Array | undefined;
  for (let v = 1n; v <= BigInt(n); v++) {
    const selfHash = editionHash(EID, v, prev, content);
    out.push(
      ed({
        version: v,
        prevHash: prev,
        selfHash,
        tiebreakId: new Uint8Array(32).fill(Number(v)),
      }),
    );
    prev = selfHash;
  }
  return out;
}

describe("edition hash (CORD-04 §1, frozen)", () => {
  it("matches an independent construction of the preimage", () => {
    // Rebuilt from the spec text rather than from the implementation:
    //   len64(label) ‖ label ‖ entity_id[32] ‖ version_be[8] ‖
    //   has_prev(1) ‖ prev_hash[32 or zero] ‖ len64(content) ‖ content
    const label = new TextEncoder().encode("vector-community/v1/edition");
    const u64 = (n: bigint) => {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigUint64(0, n, false);
      return b;
    };
    const prev = new Uint8Array(32).fill(9);
    const expected = new Uint8Array([
      ...u64(BigInt(label.length)),
      ...label,
      ...EID,
      ...u64(4n),
      1,
      ...prev,
      ...u64(BigInt(CONTENT.length)),
      ...CONTENT,
    ]);
    expect(bytesToHex(editionPreimage(EID, 4n, prev, CONTENT))).toBe(
      bytesToHex(expected),
    );
    expect(bytesToHex(editionHash(EID, 4n, prev, CONTENT))).toBe(
      bytesToHex(sha256(expected)),
    );
  });

  it("encodes an absent prev as a zero flag AND 32 zero bytes", () => {
    // Not an omission: the field is fixed-width either way, so a first edition
    // and one citing the all-zero hash must still differ by the flag byte.
    const first = editionPreimage(EID, 1n, undefined, CONTENT);
    const zeroPrev = editionPreimage(EID, 1n, new Uint8Array(32), CONTENT);
    expect(first.length).toBe(zeroPrev.length);
    expect(bytesToHex(first)).not.toBe(bytesToHex(zeroPrev));
  });

  it("is length-prefixed so distinct inputs cannot collide", () => {
    // The whole point of len64 on label and content: without it, moving a byte
    // from the end of one field to the start of the next would hash the same.
    const a = editionHash(EID, 1n, undefined, new TextEncoder().encode("ab"));
    const b = editionHash(EID, 1n, undefined, new TextEncoder().encode("a"));
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it("binds entity, version, prev and content", () => {
    const base = bytesToHex(editionHash(EID, 4n, undefined, CONTENT));
    expect(
      bytesToHex(
        editionHash(new Uint8Array(32).fill(8), 4n, undefined, CONTENT),
      ),
    ).not.toBe(base);
    expect(bytesToHex(editionHash(EID, 5n, undefined, CONTENT))).not.toBe(base);
    expect(
      bytesToHex(editionHash(EID, 4n, new Uint8Array(32), CONTENT)),
    ).not.toBe(base);
    expect(
      bytesToHex(
        editionHash(EID, 4n, undefined, new TextEncoder().encode("x")),
      ),
    ).not.toBe(base);
  });

  it("matches the pinned vector", () => {
    // Frozen: this is what every other client's `ep` will cite. Anchored by the
    // independent construction above, so it is not merely this file agreeing
    // with itself.
    expect(
      bytesToHex(editionHash(EID, 4n, new Uint8Array(32).fill(9), CONTENT)),
    ).toBe("b2b99d0085fb5ff2cfb08f677d9e5ccd240655f61b40c6053f63227a95fb24f6");
  });
});

describe("fold — the steady-state chain walk", () => {
  it("walks a contiguous chain to its head", () => {
    const c = chain(3);
    expect(fold(c, 0n)).toEqual({ head: 2, gap: false });
  });

  it("reports a gap when the chain does not start at version 1", () => {
    // A fresh client with no floor must see version 1 with no prev, or it
    // cannot know what it is missing.
    const c = chain(3).slice(1);
    expect(fold(c, 0n).gap).toBe(true);
  });

  it("reports a gap when a link is missing in the middle", () => {
    const c = chain(4);
    expect(fold([c[0], c[1], c[3]], 0n).gap).toBe(true);
  });

  it("reports a gap when a version links to the wrong predecessor", () => {
    // The withheld-middle attack: contiguous VERSIONS are not enough, the
    // hashes have to match or a forger can splice.
    const c = chain(3);
    const spliced = [
      c[0],
      c[1],
      { ...c[2], prevHash: new Uint8Array(32).fill(3) },
    ];
    expect(fold(spliced, 0n).gap).toBe(true);
  });

  it("anchors on a floor at the same version by selfHash", () => {
    const c = chain(3);
    expect(fold(c.slice(2), 3n, c[2].selfHash)).toEqual({
      head: 0,
      gap: false,
    });
    // A different edition claiming our floor's version does not anchor.
    expect(fold(c.slice(2), 3n, new Uint8Array(32).fill(1)).gap).toBe(true);
  });

  it("anchors on a floor at floor+1 by prevHash", () => {
    const c = chain(4);
    expect(fold(c.slice(3), 3n, c[2].selfHash)).toEqual({
      head: 0,
      gap: false,
    });
  });

  it("refuses to downgrade: below-floor editions are skipped entirely", () => {
    // A relay replaying a stale Grant or a lifted Ban must not seat it.
    const c = chain(3);
    const result = fold(c, 3n, c[2].selfHash);
    expect(result.head).not.toBeNull();
    expect(c[result.head!].version).toBe(3n);
  });

  it("returns no head when nothing is served", () => {
    expect(fold([], 0n)).toEqual({ head: null, gap: false });
  });

  it("breaks an equal-version fork by the LOWER tiebreak id", () => {
    const low = ed({
      version: 1n,
      selfHash: new Uint8Array(32).fill(0xaa),
      tiebreakId: new Uint8Array(32).fill(0x01),
    });
    const high = ed({
      version: 1n,
      selfHash: new Uint8Array(32).fill(0xbb),
      tiebreakId: new Uint8Array(32).fill(0x02),
    });
    expect(fold([high, low], 0n).head).toBe(1); // the low id, whatever the order
    expect(fold([low, high], 0n).head).toBe(0);
  });
});

describe("bootstrapHead — the post-compaction arm", () => {
  it("takes the highest version, ignoring a dangling prev", () => {
    // A compaction re-wraps each entity's head, whose `prev` cites an edition
    // that no longer exists at the new epoch. There is nothing behind it to
    // verify, so contiguity is not the test.
    const dangling = [
      ed({ version: 7n, prevHash: new Uint8Array(32).fill(0xff) }),
      ed({ version: 3n }),
    ];
    expect(bootstrapHead(dangling, 0n)).toBe(0);
    expect(fold(dangling, 0n).gap).toBe(true); // the contrast
  });

  it("still refuses to downgrade below the floor", () => {
    expect(bootstrapHead([ed({ version: 2n })], 5n)).toBeNull();
  });

  it("breaks an equal-version tie by the lower id", () => {
    const a = ed({ version: 4n, tiebreakId: new Uint8Array(32).fill(0x05) });
    const b = ed({ version: 4n, tiebreakId: new Uint8Array(32).fill(0x04) });
    expect(bootstrapHead([a, b], 0n)).toBe(1);
    expect(bootstrapHead([b, a], 0n)).toBe(0);
  });

  it("returns null on an empty set", () => {
    expect(bootstrapHead([], 0n)).toBeNull();
  });
});
