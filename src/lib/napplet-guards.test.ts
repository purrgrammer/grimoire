import { describe, it, expect } from "vitest";
import { assertManifestEvent } from "@/lib/napplet-parser";
import type { NostrEvent } from "@/types/nostr";

const PUBKEY = "a".repeat(64);
const OTHER_PUBKEY = "b".repeat(64);
const ID = "1".repeat(64);
const OTHER_ID = "2".repeat(64);

function manifest(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: ID,
    pubkey: PUBKEY,
    created_at: 1700000000,
    kind: 35129,
    tags: [["d", "calc"]],
    content: "",
    sig: "",
    ...overrides,
  } as NostrEvent;
}

/**
 * These guards are what stop a hostile relay in the fan-out from answering with
 * its own validly signed napplet. `resolveNapplet` cannot catch that — it only
 * proves the event it was handed is genuine, not that it is the one requested.
 */
describe("assertManifestEvent", () => {
  it("rejects a non-manifest kind", () => {
    expect(() =>
      assertManifestEvent(manifest({ kind: 1 }), { id: ID }),
    ).toThrow(/not a napplet manifest/i);
  });

  describe("event pointers", () => {
    it("accepts the requested event", () => {
      expect(assertManifestEvent(manifest(), { id: ID }).id).toBe(ID);
    });

    it("rejects a substituted event id", () => {
      expect(() =>
        assertManifestEvent(manifest({ id: OTHER_ID }), { id: ID }),
      ).toThrow(/different napplet/i);
    });

    it("rejects a mismatched author hint", () => {
      expect(() =>
        assertManifestEvent(manifest(), { id: ID, author: OTHER_PUBKEY }),
      ).toThrow(/different napplet/i);
    });

    it("rejects a mismatched kind hint", () => {
      expect(() =>
        assertManifestEvent(manifest(), {
          id: ID,
          kind: 15129,
        } as never),
      ).toThrow(/different napplet/i);
    });
  });

  describe("address pointers", () => {
    const pointer = { kind: 35129, pubkey: PUBKEY, identifier: "calc" };

    it("accepts the requested coordinate", () => {
      expect(assertManifestEvent(manifest(), pointer).id).toBe(ID);
    });

    it("rejects a different author", () => {
      expect(() =>
        assertManifestEvent(manifest({ pubkey: OTHER_PUBKEY }), pointer),
      ).toThrow(/different napplet/i);
    });

    it("rejects a different d tag", () => {
      expect(() =>
        assertManifestEvent(manifest({ tags: [["d", "other"]] }), pointer),
      ).toThrow(/different napplet/i);
    });

    it("rejects a root manifest standing in for an empty-identifier named one", () => {
      expect(() =>
        assertManifestEvent(manifest({ kind: 15129, tags: [] }), {
          kind: 35129,
          pubkey: PUBKEY,
          identifier: "",
        }),
      ).toThrow(/different napplet/i);
    });

    it("accepts a root manifest for a root pointer", () => {
      expect(
        assertManifestEvent(manifest({ kind: 15129, tags: [] }), {
          kind: 15129,
          pubkey: PUBKEY,
          identifier: "",
        }).kind,
      ).toBe(15129);
    });
  });
});
