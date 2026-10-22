// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getDefaultHandler,
  setDefaultHandler,
  clearDefaultHandler,
  getIntentDefaults,
  isExplicitTargetingAuthorized,
  authorizeExplicitTargeting,
  loadIntentCatalog,
  createNappletIntentResolver,
  subscribeNappletIntentChoice,
} from "./napplet-intent";
import * as library from "./napplet-library";
import {
  BUILTIN_ARCHETYPE_SLUGS,
  builtinHandlerDTag,
} from "./napplet-builtins";

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
const PUBKEY = "a".repeat(64);
const HASH = "b".repeat(64);

/**
 * A legacy-format manifest event, as the library records it: one aggregate `x`
 * tag, `path` tags, and `archetype` tags carrying exactly a slug and convention.
 */
function manifest(
  dTag: string,
  archetypeTags: string[][],
  pubkey = PUBKEY,
): Record<string, unknown> {
  return {
    id: "c".repeat(64),
    kind: 35129,
    pubkey,
    created_at: 1,
    content: "A test napplet",
    sig: "d".repeat(128),
    tags: [
      ["d", dTag],
      ["path", "/index.html", HASH],
      ["x", HASH, "aggregate"],
      ...archetypeTags,
    ],
  };
}

describe("intent catalog", () => {
  it("skips a napplet with malformed archetype tags instead of failing the batch", async () => {
    // Kehto's manifestToIntentCatalogEntry *throws* on a convention that is not
    // `napplet:<slug>/<action>` or a slug outside [a-z0-9][a-z0-9-]*. Those tags
    // are third-party input, and the resolver reloads the catalog for every
    // available/handlers/dispatch — so one bad tag in one installed napplet used
    // to disable NAP-INTENT for all of them.
    const rows = [
      {
        coordinate: `35129:${PUBKEY}:broken`,
        identifier: "broken",
        title: "Broken",
        manifest: manifest("broken", [["archetype", "profile"]]),
      },
      {
        coordinate: `35129:${PUBKEY}:underscored`,
        identifier: "underscored",
        title: "Underscored",
        manifest: manifest("underscored", [
          ["archetype", "my_role", "napplet:my_role/open"],
        ]),
      },
      {
        coordinate: `35129:${PUBKEY}:good`,
        identifier: "good",
        title: "Good",
        manifest: manifest("good", [
          ["archetype", "gallery", "napplet:gallery/open"],
        ]),
      },
    ];
    const spy = vi
      .spyOn(library, "listNapplets")
      .mockResolvedValue(rows as never);

    const entries = await loadIntentCatalog();
    spy.mockRestore();

    const ids = entries.map((e) => e.id);
    expect(ids.some((id) => id.endsWith(":broken"))).toBe(false);
    expect(ids.some((id) => id.endsWith(":underscored"))).toBe(false);
    // The good one, and the built-ins, still made it: the batch survived.
    expect(ids.some((id) => id.endsWith(":good"))).toBe(true);
    expect(ids).toContain(builtinHandlerDTag("profile"));
  });

  it("identifies an installed napplet by publisher-scoped catalog ID", async () => {
    // Two authors can both ship a napplet called `viewer`. Kehto keys the
    // catalog by an opaque ID that includes the publisher, so they stay apart.
    const other = "e".repeat(64);
    const rows = [
      {
        coordinate: `35129:${PUBKEY}:viewer`,
        identifier: "viewer",
        title: "Viewer A",
        manifest: manifest("viewer", [
          ["archetype", "gallery", "napplet:gallery/open"],
        ]),
      },
      {
        coordinate: `35129:${other}:viewer`,
        identifier: "viewer",
        title: "Viewer B",
        manifest: manifest(
          "viewer",
          [["archetype", "gallery", "napplet:gallery/open"]],
          other,
        ),
      },
    ];
    const spy = vi
      .spyOn(library, "listNapplets")
      .mockResolvedValue(rows as never);

    const entries = await loadIntentCatalog();
    spy.mockRestore();

    const ids = entries
      .map((e) => e.id)
      .filter((id) => id.endsWith(":viewer"))
      .sort();
    expect(ids).toEqual([
      `nip5d:35129:${PUBKEY}:viewer`,
      `nip5d:35129:${other}:viewer`,
    ]);
  });

  it("advertises grimoire's built-in roles when nothing is installed", async () => {
    const entries = await loadIntentCatalog();
    expect(entries.map((entry) => entry.id)).toEqual(
      BUILTIN_ARCHETYPE_SLUGS.map(builtinHandlerDTag),
    );

    // Each advertises exactly its own slug, with the `open` action derived from
    // the `napplet:<archetype>/open` convention.
    for (const entry of entries) {
      const [slug] = Object.keys(entry.archetypes);
      expect(entry.id).toBe(builtinHandlerDTag(slug));
      expect(entry.archetypes[slug].contracts.map((c) => c.convention)).toEqual(
        [`napplet:${slug}/open`],
      );
    }
  });
});

describe("intent resolver", () => {
  const OTHER = "e".repeat(64);

  function installTwoGalleries() {
    const rows = [
      {
        coordinate: `35129:${PUBKEY}:gallery`,
        identifier: "gallery",
        title: "Gallery A",
        manifest: manifest("gallery", [
          ["archetype", "gallery", "napplet:gallery/open"],
        ]),
      },
      {
        coordinate: `35129:${OTHER}:gallery-two`,
        identifier: "gallery-two",
        title: "Gallery B",
        manifest: manifest(
          "gallery-two",
          [["archetype", "gallery", "napplet:gallery/open"]],
          OTHER,
        ),
      },
    ];
    return vi.spyOn(library, "listNapplets").mockResolvedValue(rows as never);
  }

  function setup() {
    const accepted: Array<Record<string, unknown>> = [];
    const resolver = createNappletIntentResolver({
      targets: {
        accept(params) {
          accepted.push(params as unknown as Record<string, unknown>);
          return { completion: Promise.resolve() };
        },
      },
    });
    return { accepted, resolver };
  }

  const request = {
    archetype: "gallery",
    action: "open",
    convention: "napplet:gallery/open",
  };

  it("hands the target the catalog ID of the handler the user's default names", async () => {
    // Defaults are stored by d-tag; Kehto deals only in catalog IDs.
    setDefaultHandler("gallery", "gallery-two");
    const spy = installTwoGalleries();
    const { accepted, resolver } = setup();

    const result = await resolver.invoke(request, {
      sender: `nip5d:35129:${PUBKEY}:gallery`,
      sourceWindowId: "w1",
    });
    spy.mockRestore();

    expect(result).toMatchObject({ ok: true });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].handler).toBe(`nip5d:35129:${OTHER}:gallery-two`);
    expect(accepted[0].sourceWindowId).toBe("w1");
  });

  it("does not honour a default that names no installed napplet", async () => {
    setDefaultHandler("gallery", "uninstalled");
    // One installed handler, so Kehto auto-selects it rather than asking.
    const spy = vi.spyOn(library, "listNapplets").mockResolvedValue([
      {
        coordinate: `35129:${PUBKEY}:gallery`,
        identifier: "gallery",
        title: "Gallery A",
        manifest: manifest("gallery", [
          ["archetype", "gallery", "napplet:gallery/open"],
        ]),
      },
    ] as never);
    const { accepted, resolver } = setup();

    await resolver.invoke(request, {
      sender: `nip5d:35129:${PUBKEY}:gallery`,
    });
    spy.mockRestore();

    expect(accepted[0]?.handler).toBe(`nip5d:35129:${PUBKEY}:gallery`);
  });

  it("refuses to address a handler by name without the user's authorization", async () => {
    const spy = installTwoGalleries();
    const { accepted, resolver } = setup();
    const named = {
      ...request,
      handler: `nip5d:35129:${OTHER}:gallery-two`,
    };
    const sender = `nip5d:35129:${PUBKEY}:gallery`;

    // Unauthorized: falls back to ordinary resolution, which with no default and
    // two candidates asks the user. Cancel the chooser, as a dismissed dialog
    // would, so nothing is delivered.
    const unsubscribe = subscribeNappletIntentChoice((choices) => {
      choices.forEach((choice) => choice.resolve(null));
    });
    const denied = await resolver.invoke(named, { sender });
    unsubscribe();
    expect(accepted).toHaveLength(0);
    expect(denied).not.toMatchObject({ ok: true });

    // Authorized by d-tag, as the user's grant is recorded.
    authorizeExplicitTargeting("gallery", "gallery-two");
    const allowed = await resolver.invoke(named, { sender });
    spy.mockRestore();

    expect(allowed).toMatchObject({ ok: true });
    expect(accepted[0].handler).toBe(`nip5d:35129:${OTHER}:gallery-two`);
  });
});
