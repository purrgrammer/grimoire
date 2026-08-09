// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  getDefaultHandler,
  setDefaultHandler,
  clearDefaultHandler,
  getIntentDefaults,
  isExplicitTargetingAuthorized,
  authorizeExplicitTargeting,
} from "./napplet-intent";

beforeEach(() => {
  localStorage.clear();
});

/**
 * NAP-INTENT: "The shell MUST keep a user-overridable default per archetype"
 * and "MUST NOT let a napplet silently set or change a default".
 */
describe("default handlers", () => {
  it("has no default until the user picks one", () => {
    expect(getDefaultHandler("note")).toBeUndefined();
  });

  it("round-trips a default per archetype", () => {
    setDefaultHandler("note", "noteview");
    setDefaultHandler("profile", "profileview");
    expect(getDefaultHandler("note")).toBe("noteview");
    expect(getDefaultHandler("profile")).toBe("profileview");
  });

  it("overwrites rather than accumulating", () => {
    setDefaultHandler("note", "first");
    setDefaultHandler("note", "second");
    expect(getDefaultHandler("note")).toBe("second");
    expect(Object.keys(getIntentDefaults())).toEqual(["note"]);
  });

  it("clears one archetype without touching another", () => {
    setDefaultHandler("note", "noteview");
    setDefaultHandler("profile", "profileview");
    clearDefaultHandler("note");
    expect(getDefaultHandler("note")).toBeUndefined();
    expect(getDefaultHandler("profile")).toBe("profileview");
  });

  it("treats a corrupt store as empty", () => {
    localStorage.setItem("napplet:intent-defaults", "{not json");
    expect(getDefaultHandler("note")).toBeUndefined();
  });
});

/**
 * "A napplet asking for archetype 'note' MUST NOT be able to coerce the shell
 * into routing to an arbitrary napplet… The handler: '<dTag>' form SHOULD
 * require that the user has authorized cross-napplet targeting for the caller."
 */
describe("explicit cross-napplet targeting", () => {
  it("is refused by default", () => {
    expect(isExplicitTargetingAuthorized("caller", "target")).toBe(false);
  });

  it("is allowed once authorized", () => {
    authorizeExplicitTargeting("caller", "target");
    expect(isExplicitTargetingAuthorized("caller", "target")).toBe(true);
  });

  it("is directional — authorizing A→B does not allow B→A", () => {
    authorizeExplicitTargeting("caller", "target");
    expect(isExplicitTargetingAuthorized("target", "caller")).toBe(false);
  });

  it("does not generalize to other targets", () => {
    authorizeExplicitTargeting("caller", "target");
    expect(isExplicitTargetingAuthorized("caller", "other")).toBe(false);
  });
});

/**
 * "MUST source available()/handlers() from the installed-napplet catalog" — plus
 * grimoire itself, for the roles it fills natively, so a fresh install with no
 * napplets can still answer `intent.available("profile")` truthfully.
 */
describe("intent catalog", () => {
  it("advertises grimoire's built-in roles when nothing is installed", async () => {
    const { loadIntentCatalog } = await import("./napplet-intent");
    const { BUILTIN_ARCHETYPE_SLUGS, builtinHandlerDTag } =
      await import("./napplet-builtins");

    const entries = await loadIntentCatalog();
    expect(entries.map((entry) => entry.dTag)).toEqual(
      BUILTIN_ARCHETYPE_SLUGS.map(builtinHandlerDTag),
    );

    // Each advertises exactly its own slug, with `open` derived from the
    // `napplet:<archetype>/open` convention.
    for (const entry of entries) {
      const [slug] = Object.keys(entry.archetypes);
      expect(entry.dTag).toBe(builtinHandlerDTag(slug));
      expect(entry.archetypes[slug].actions).toEqual(["open"]);
    }
  });
});
