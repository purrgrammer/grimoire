import { describe, expect, it, beforeEach } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools/pure";

import { _resetVerifyCacheForTests, verifyEventOnce } from "./verify-cache";

/**
 * The memo's security argument, which is the only thing standing between
 * `openWrap` and a forged seal. Each test below is one clause of it.
 */

const sk = generateSecretKey();

function signed(content = "hello"): NostrEvent {
  return finalizeEvent(
    { kind: 20013, content, tags: [], created_at: 1_719_800_000 },
    sk,
  );
}

beforeEach(() => {
  _resetVerifyCacheForTests();
});

describe("verifyEventOnce", () => {
  it("accepts a genuinely signed event, and again from the memo", () => {
    const e = signed();
    expect(verifyEventOnce(e)).toBe(true);
    expect(verifyEventOnce({ ...e })).toBe(true); // a fresh object, memo hit
  });

  it("rejects a bad signature", () => {
    expect(verifyEventOnce({ ...signed(), sig: "00".repeat(64) })).toBe(false);
  });

  it("rejects an event whose id is not its content hash", () => {
    // The gate that binds THIS copy to the memoized claim. Without it, any
    // content could ride a known-good id.
    const e = signed();
    expect(verifyEventOnce({ ...e, content: "tampered" })).toBe(false);
  });

  it("does NOT let tampered content ride a known-good id", () => {
    // The attack the recomputed hash exists to stop, spelled out: verify the
    // honest copy first so its id is memoized, then present different content
    // under that same id.
    const honest = signed("honest");
    expect(verifyEventOnce(honest)).toBe(true);
    const forged = { ...honest, content: "forged" };
    expect(forged.id).toBe(honest.id); // same id claimed
    expect(verifyEventOnce(forged)).toBe(false);
  });

  it("never memoizes a FAILED verify", () => {
    // Otherwise a forged copy arriving first would poison the id for the
    // honest copy behind it.
    const honest = signed("first");
    const forged = { ...honest, sig: "11".repeat(64) };
    expect(verifyEventOnce(forged)).toBe(false);
    expect(verifyEventOnce(honest)).toBe(true);
  });

  it("accepts a duplicate carrying a MANGLED sig, deliberately", () => {
    // Documented behaviour, not an oversight: the content is authentic (its
    // hash matches an id already proven), which is the only claim `openWrap`
    // takes from this. Anything re-publishing verbatim must check `isSigned`.
    const honest = signed();
    expect(verifyEventOnce(honest)).toBe(true);
    expect(verifyEventOnce({ ...honest, sig: "22".repeat(64) })).toBe(true);
  });

  it("returns false rather than throwing on a malformed event", () => {
    // The caller is `openWrap`, whose seal is JSON parsed out of a decrypted
    // payload shaped by whoever holds the group key — so this is attacker
    // input and must never propagate an exception.
    const e = signed();
    for (const bad of [
      { ...e, tags: undefined },
      { ...e, created_at: "nope" },
      { ...e, kind: undefined },
      { ...e, pubkey: "zz".repeat(32) },
      { ...e, sig: "not-hex" },
      {},
    ]) {
      expect(() => verifyEventOnce(bad as unknown as NostrEvent)).not.toThrow();
      expect(verifyEventOnce(bad as unknown as NostrEvent)).toBe(false);
    }
  });

  it("rejects a signature lifted from another key's event", () => {
    // On an id this cache has NOT already proven. (Once an id is memoized the
    // signature is not looked at again — that is the mangled-sig case above,
    // and it is sound because the content hash still has to match.)
    const other = generateSecretKey();
    const theirs = finalizeEvent(
      { kind: 20013, content: "theirs", tags: [], created_at: 1_719_800_000 },
      other,
    );
    expect(getPublicKey(other)).toBe(theirs.pubkey);
    expect(verifyEventOnce({ ...signed("mine"), sig: theirs.sig })).toBe(false);
  });
});
