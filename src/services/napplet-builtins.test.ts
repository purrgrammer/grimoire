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

/**
 * A payload from a napplet is attacker-controlled, and every built-in role ends
 * in a network request to a host derived from it — NIP-05 resolution for
 * `profile`, NIP-11 for `relay`. Accepting a NIP-05 address or a pathful relay
 * URL from the wire hands a napplet an outbound channel with control of hostname
 * *and* query, which is a way around `connect-src 'none'` that needs no grant.
 */
describe("payload targets from a napplet", () => {
  const npub = nip19.npubEncode(PUBKEY);
  const fromNapplet = (archetype: string, payload: unknown) =>
    buildBuiltinWindow(archetype, "open", payload, undefined, true);

  it("accepts a pointer", async () => {
    await expect(fromNapplet("profile", { npub })).resolves.toMatchObject({
      appId: "profile",
    });
    await expect(
      fromNapplet("profile", { pubkey: PUBKEY }),
    ).resolves.toBeTruthy();
    await expect(
      fromNapplet("note", { nevent: nip19.neventEncode({ id: EVENT_ID }) }),
    ).resolves.toBeTruthy();
  });

  it("refuses a NIP-05 address, which would be an outbound GET to any host", async () => {
    await expect(
      fromNapplet("profile", { nip05: "exfil@attacker.example" }),
    ).rejects.toThrow(/may not point the built-in "profile"/);
  });

  it("refuses a relay URL carrying a path or query", async () => {
    await expect(
      fromNapplet("relay", { url: "wss://attacker.example/leak?d=secret" }),
    ).rejects.toThrow(/may not point the built-in "relay"/);
    await expect(
      fromNapplet("relay", { url: "https://attacker.example" }),
    ).rejects.toThrow(/may not point the built-in "relay"/);
  });

  it("still accepts a bare relay URL", async () => {
    await expect(
      fromNapplet("relay", { url: "wss://relay.example.com" }),
    ).resolves.toMatchObject({ appId: "relay" });
  });

  it("holds the command line to a looser standard, deliberately", async () => {
    // Typing a target yourself is a different act from a napplet naming one, so
    // the narrow check applies to the wire only.
    const url = "wss://relay.example.com/inbox";
    await expect(fromNapplet("relay", { url })).rejects.toThrow(
      /may not point/,
    );
    await expect(
      buildBuiltinWindow("relay", "open", undefined, url),
    ).resolves.toMatchObject({ commandString: `relay ${url}` });
  });
});

/**
 * The shape every `napplet:<archetype>/open` convention actually sends. Read
 * off GM Protocol's bundle, which is where this was found: it nests the thing
 * to open under `target`, and gave up silently when nothing came back.
 */
describe("a convention payload, which nests its target", () => {
  it("opens an event with only an id", async () => {
    const window = await buildBuiltinWindow("note", "open", {
      target: { type: "event", id: EVENT_ID },
      behavior: { focus: true },
      source: { napplet: "good-morning" },
    });
    const nevent = nip19.neventEncode({ id: EVENT_ID });
    expect(window.commandString).toBe(`open ${nevent}`);
  });

  it("keeps the kind and the author, which is what makes dispatch work", () => {
    return buildBuiltinWindow("event", "open", {
      target: { type: "event", id: EVENT_ID, kind: 1, pubkey: PUBKEY },
    }).then((window) => {
      const pointer = window.commandString.slice("open ".length);
      const decoded = nip19.decode(pointer);
      expect(decoded.type).toBe("nevent");
      expect(decoded.data).toMatchObject({
        id: EVENT_ID,
        kind: 1,
        author: PUBKEY,
      });
    });
  });

  it("opens an addressable event", async () => {
    const window = await buildBuiltinWindow("note", "open", {
      target: {
        type: "address",
        kind: 30023,
        pubkey: PUBKEY,
        identifier: "a-post",
      },
    });
    const naddr = nip19.naddrEncode({
      kind: 30023,
      pubkey: PUBKEY,
      identifier: "a-post",
    });
    expect(window.commandString).toBe(`open ${naddr}`);
  });

  it("drops the relay hints a napplet supplies", async () => {
    const window = await buildBuiltinWindow("note", "open", {
      target: { type: "event", id: EVENT_ID, kind: 1 },
      relays: ["wss://attacker.example/"],
    });
    const decoded = nip19.decode(window.commandString.slice("open ".length));
    expect(decoded.type).toBe("nevent");
    expect((decoded.data as { relays?: string[] }).relays ?? []).toEqual([]);
  });

  it("still reads the flat keys, and prefers them", async () => {
    const nevent = nip19.neventEncode({ id: EVENT_ID, kind: 1 });
    const window = await buildBuiltinWindow("note", "open", {
      nevent,
      target: { type: "event", id: PUBKEY },
    });
    expect(window.commandString).toBe(`open ${nevent}`);
  });

  it("asks for a target when the nested one is not usable", async () => {
    await expect(
      buildBuiltinWindow("note", "open", {
        target: { type: "event", id: "not-an-id" },
      }),
    ).rejects.toThrow(/needs something to open/);
  });
});
