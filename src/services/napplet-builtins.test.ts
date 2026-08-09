import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import {
  BUILTIN_ARCHETYPES,
  BUILTIN_ARCHETYPE_SLUGS,
  builtinHandlerDTag,
  parseBuiltinHandlerDTag,
  findBuiltinArchetype,
  isBuiltinArchetype,
  buildBuiltinWindow,
} from "./napplet-builtins";

const PUBKEY =
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const EVENT_ID =
  "1111111111111111111111111111111111111111111111111111111111111111";

describe("built-in handler ids", () => {
  it("round-trips", () => {
    for (const slug of BUILTIN_ARCHETYPE_SLUGS) {
      expect(parseBuiltinHandlerDTag(builtinHandlerDTag(slug))).toBe(slug);
    }
  });

  it("does not claim a napplet dTag", () => {
    expect(parseBuiltinHandlerDTag("profile")).toBeNull();
    expect(parseBuiltinHandlerDTag("profileview")).toBeNull();
    expect(parseBuiltinHandlerDTag("")).toBeNull();
  });

  it("only recognises slugs with a table row", () => {
    expect(isBuiltinArchetype("profile")).toBe(true);
    expect(isBuiltinArchetype("wallet")).toBe(false);
    expect(findBuiltinArchetype("wallet")).toBeUndefined();
    // Every declared slug has a row — the Record type enforces it, this proves it.
    for (const slug of BUILTIN_ARCHETYPE_SLUGS) {
      expect(findBuiltinArchetype(slug)?.archetype).toBe(slug);
    }
    expect(BUILTIN_ARCHETYPES).toHaveLength(BUILTIN_ARCHETYPE_SLUGS.length);
  });
});

describe("buildBuiltinWindow", () => {
  it("opens a profile from any of the payload key spellings", async () => {
    const npub = nip19.npubEncode(PUBKEY);
    for (const payload of [{ pubkey: npub }, { npub }, { profile: npub }]) {
      const window = await buildBuiltinWindow("profile", "open", payload);
      expect(window.appId).toBe("profile");
      expect(window.commandString).toBe(`profile ${npub}`);
    }
  });

  it("opens your own profile with no payload", async () => {
    const window = await buildBuiltinWindow("profile", "open");
    // `$me` rather than a bare `profile`, which the built-in parser rejects.
    expect(window.commandString).toBe("profile $me");
    expect(window.appId).toBe("profile");
  });

  it("opens an event through the ordinary open command", async () => {
    const nevent = nip19.neventEncode({ id: EVENT_ID, kind: 1 });
    const window = await buildBuiltinWindow("note", "open", { nevent });
    expect(window.appId).toBe("open");
    expect(window.props).toMatchObject({ pointer: { id: EVENT_ID } });
  });

  it("opens a relay", async () => {
    const window = await buildBuiltinWindow("relay", "open", {
      url: "wss://relay.example.com",
    });
    expect(window.appId).toBe("relay");
    expect(window.commandString).toBe("relay wss://relay.example.com");
  });

  it("refuses an archetype with no built-in", async () => {
    await expect(buildBuiltinWindow("wallet", "open")).rejects.toThrow(
      /no built-in handler/i,
    );
  });

  it("refuses an action a built-in does not serve", async () => {
    await expect(buildBuiltinWindow("profile", "edit")).rejects.toThrow(
      /cannot "edit"/,
    );
  });

  it("asks for a target rather than opening something wrong", async () => {
    await expect(buildBuiltinWindow("relay", "open", {})).rejects.toThrow(
      /needs something to open — try `app relay <wss/,
    );
    // A non-string payload value is no target at all.
    await expect(
      buildBuiltinWindow("note", "open", { id: 42 }),
    ).rejects.toThrow(/needs something to open/);
  });

  it("takes a target from the command line when there is no payload", async () => {
    const note = nip19.noteEncode(EVENT_ID);
    const window = await buildBuiltinWindow("note", "open", undefined, note);
    expect(window.appId).toBe("open");
    expect(window.props).toMatchObject({ pointer: { id: EVENT_ID } });
  });

  it("prefers the payload over a command-line target", async () => {
    const npub = nip19.npubEncode(PUBKEY);
    const window = await buildBuiltinWindow(
      "profile",
      "open",
      { npub },
      "someone-else@example.com",
    );
    expect(window.commandString).toBe(`profile ${npub}`);
  });

  it("leaves identifier handling to the built-in parser", async () => {
    // Not a passthrough: `relay` normalizes, and duplicating that judgement here
    // is exactly the drift the command-string indirection exists to avoid.
    const window = await buildBuiltinWindow("relay", "open", {
      url: "not-a-relay-url",
    });
    expect(window.props).toMatchObject({ url: "wss://not-a-relay-url/" });
  });
});
