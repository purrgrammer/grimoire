import { describe, expect, it } from "vitest";

import {
  NSITE_KINDS,
  NSITE_KIND_SNAPSHOT,
  NSITE_KIND_ROOT,
  NSITE_KIND_NAMED,
  isNsiteManifestKind,
} from "./nsite-kinds";
import { NAPPLET_KINDS } from "./napplet-parser";

describe("nsite kinds", () => {
  /**
   * Inlined so the eager command registry does not drag the verification
   * runtime into startup. The numbers are a wire format, so a typo here is a
   * command that silently never matches anything.
   */
  it("are the NIP-5A manifest kinds", () => {
    expect([...NSITE_KINDS]).toEqual([5128, 15128, 35128]);
    expect(NSITE_KIND_SNAPSHOT).toBe(5128);
    expect(NSITE_KIND_ROOT).toBe(15128);
    expect(NSITE_KIND_NAMED).toBe(35128);
  });

  /** A napplet is an nsite with capability tags, but the kinds never overlap. */
  it("never collide with the napplet kinds", () => {
    for (const kind of NSITE_KINDS) {
      expect(
        (NAPPLET_KINDS as readonly number[]).includes(kind),
        `${kind} is claimed by both`,
      ).toBe(false);
    }
  });

  it.each([5128, 15128, 35128])("recognises %i", (kind) => {
    expect(isNsiteManifestKind(kind)).toBe(true);
  });

  it.each([1, 5129, 15129, 35129, 30023])("rejects %i", (kind) => {
    expect(isNsiteManifestKind(kind)).toBe(false);
  });
});
