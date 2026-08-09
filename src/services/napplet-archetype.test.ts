import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NostrEvent } from "@/types/nostr";

const rows: {
  coordinate: string;
  title: string;
  manifest?: NostrEvent;
}[] = [];

vi.mock("./napplet-library", async () => {
  const actual =
    await vi.importActual<typeof import("./napplet-library")>(
      "./napplet-library",
    );
  return { ...actual, listNapplets: async () => rows };
});

const {
  looksLikeArchetype,
  findArchetypeHandlers,
  resolveArchetype,
  listArchetypeRoles,
} = await import("./napplet-archetype");
const { setDefaultHandler } = await import("./napplet-intent-defaults");

const PUBKEY =
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

function manifest(archetypes: [string, string][]): NostrEvent {
  return {
    id: "a".repeat(64),
    pubkey: PUBKEY,
    created_at: 0,
    kind: 35129,
    tags: archetypes.map(([slug, convention]) => [
      "archetype",
      slug,
      convention,
    ]),
    content: "",
    sig: "",
  } as NostrEvent;
}

function install(dTag: string, archetypes: [string, string][]): void {
  rows.push({
    coordinate: `35129:${PUBKEY}:${dTag}`,
    title: dTag,
    manifest: manifest(archetypes),
  });
}

describe("looksLikeArchetype", () => {
  it("accepts slugs", () => {
    expect(looksLikeArchetype("profile")).toBe(true);
    expect(looksLikeArchetype("live-stream")).toBe(true);
    expect(looksLikeArchetype("note")).toBe(true);
  });

  it("rejects pointer forms, including broken bech32", () => {
    expect(looksLikeArchetype("naddr1notreallybech32")).toBe(false);
    expect(looksLikeArchetype("note1abc")).toBe(false);
    expect(looksLikeArchetype("")).toBe(false);
    expect(looksLikeArchetype("Profile")).toBe(false);
    expect(looksLikeArchetype("35129:abc:x")).toBe(false);
    expect(looksLikeArchetype("a".repeat(65))).toBe(false);
  });
});

describe("archetype resolution", () => {
  beforeEach(() => {
    rows.length = 0;
    localStorage.clear();
  });

  it("refuses an archetype nothing handles at all", async () => {
    await expect(resolveArchetype("wallet")).rejects.toThrow(
      /nothing handles the "wallet" archetype/i,
    );
  });

  it("falls back to grimoire's built-in when no napplet handles the role", async () => {
    await expect(resolveArchetype("profile")).resolves.toMatchObject({
      kind: "builtin",
      dTag: "grimoire:builtin:profile",
    });
  });

  it("prefers an installed napplet over the built-in", async () => {
    install("profileview", [["profile", "napplet:profile/open"]]);
    await expect(resolveArchetype("profile")).resolves.toMatchObject({
      kind: "napplet",
      dTag: "profileview",
      pointer: { kind: 35129, pubkey: PUBKEY, identifier: "profileview" },
    });
  });

  it("refuses to guess between competing napplets", async () => {
    install("one", [["profile", "c"]]);
    install("two", [["profile", "c"]]);
    await expect(resolveArchetype("profile")).rejects.toThrow(
      /several installed napplets handle "profile": one, two/i,
    );
  });

  it("uses the user's default to break a tie", async () => {
    install("one", [["profile", "c"]]);
    install("two", [["profile", "c"]]);
    setDefaultHandler("profile", "two");
    await expect(resolveArchetype("profile")).resolves.toMatchObject({
      dTag: "two",
    });
  });

  it("lets the user default a contested role to the built-in", async () => {
    install("one", [["profile", "c"]]);
    install("two", [["profile", "c"]]);
    setDefaultHandler("profile", "grimoire:builtin:profile");
    await expect(resolveArchetype("profile")).resolves.toMatchObject({
      kind: "builtin",
    });
  });

  it("ignores a default pointing at something not installed", async () => {
    install("one", [["profile", "c"]]);
    install("two", [["profile", "c"]]);
    setDefaultHandler("profile", "uninstalled");
    await expect(resolveArchetype("profile")).rejects.toThrow(/several/i);
  });

  it("skips rows with no cached manifest", async () => {
    rows.push({ coordinate: `35129:${PUBKEY}:nomanifest`, title: "x" });
    expect(
      (await findArchetypeHandlers("profile")).filter(
        (c) => c.kind === "napplet",
      ),
    ).toEqual([]);
  });

  it("matches only the requested archetype", async () => {
    install("multi", [
      ["profile", "c"],
      ["note", "c"],
    ]);
    const napplets = async (archetype: string) =>
      (await findArchetypeHandlers(archetype)).filter(
        (c) => c.kind === "napplet",
      );
    expect(await napplets("note")).toHaveLength(1);
    expect(await napplets("relay")).toHaveLength(0);
    expect(await napplets("wallet")).toHaveLength(0);
  });

  it("lists roles, flagging the ones it cannot resolve", async () => {
    install("one", [["profile", "c"]]);
    install("two", [["profile", "c"]]);
    install("solo", [["note", "c"]]);

    const roles = await listArchetypeRoles();
    // Sorted by slug, and every built-in role is listed even with no napplet.
    expect(roles.map((r) => r.archetype)).toEqual([
      "event",
      "note",
      "profile",
      "relay",
    ]);

    const byName = Object.fromEntries(roles.map((r) => [r.archetype, r]));
    // One napplet beats the built-in without a choice being needed.
    expect(byName.note.resolved).toMatchObject({ dTag: "solo" });
    // Two do not, and the built-in must not join that tie.
    expect(byName.profile.resolved).toBeUndefined();
    // A role only grimoire fills resolves to grimoire.
    expect(byName.relay.resolved).toMatchObject({ kind: "builtin" });

    setDefaultHandler("profile", "two");
    const settled = await listArchetypeRoles();
    expect(settled.find((r) => r.archetype === "profile")).toMatchObject({
      defaultDTag: "two",
      resolved: expect.objectContaining({ dTag: "two" }),
    });
  });
});
