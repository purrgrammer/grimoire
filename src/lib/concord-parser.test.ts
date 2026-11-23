/**
 * Resolving a community the way a person names one.
 *
 * `resolveStoredCommunity` exists so `chat` can share its single argument with
 * every NIP-19 identifier there is: it must answer "this is a community I hold"
 * or nothing at all, never "probably". `call` is the lenient one — its first
 * argument has no other Concord meaning, so an unresolved query is carried
 * through as a prefix rather than refused.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BehaviorSubject } from "rxjs";

const VIEWER = "aa".repeat(32);
const BUILDERS = "3fa2c1" + "0".repeat(58);
const BAKERY = "77ee55" + "1".repeat(58);

const active$ = new BehaviorSubject<{ pubkey: string } | undefined>({
  pubkey: VIEWER,
});

vi.mock("@/services/accounts", () => ({
  default: {
    get active$() {
      return active$;
    },
  },
}));

const communities = [
  { idHex: BUILDERS, name: "Bitcoin Builders" },
  { idHex: BAKERY, name: "Bakery" },
];

vi.mock("@/services/concord-communities", () => ({
  loadStoredCommunities: vi.fn(async () => communities),
}));

vi.mock("@/services/concord-state", () => ({
  readStoredState: vi.fn(async () => undefined),
}));

const { resolveStoredCommunity, parseCallCommand } =
  await import("./concord-parser");

describe("resolveStoredCommunity", () => {
  beforeEach(() => active$.next({ pubkey: VIEWER }));

  it("matches a name, whatever its case", async () => {
    await expect(resolveStoredCommunity("bitcoin builders")).resolves.toEqual({
      communityId: BUILDERS,
      dynamicTitle: "Bitcoin Builders",
    });
  });

  it("matches a name prefix", async () => {
    const hit = await resolveStoredCommunity("bak");
    expect(hit?.communityId).toBe(BAKERY);
  });

  it("matches an id prefix", async () => {
    const hit = await resolveStoredCommunity("3fa2c1");
    expect(hit?.communityId).toBe(BUILDERS);
  });

  it("answers nothing for a community this account does not hold", async () => {
    // The whole point: `chat` reads this as "not a community, try the
    // identifiers" — an npub, an nevent and a relay'group all arrive here too.
    await expect(resolveStoredCommunity("nostrica")).resolves.toBeUndefined();
  });

  it("answers nothing with no account, having no list to match against", async () => {
    active$.next(undefined);
    await expect(
      resolveStoredCommunity("Bitcoin Builders"),
    ).resolves.toBeUndefined();
  });

  it("answers nothing for an empty query", async () => {
    await expect(resolveStoredCommunity("   ")).resolves.toBeUndefined();
  });
});

describe("parseCallCommand", () => {
  beforeEach(() => active$.next({ pubkey: VIEWER }));

  // The channel needs a decrypted vault, which this suite mocks away; what is
  // asserted here is that the community resolved and the protocol was named.
  it("names the Concord community it resolved", async () => {
    await expect(parseCallCommand(["bitcoin", "general"])).resolves.toEqual({
      protocol: "concord",
      communityId: BUILDERS,
    });
  });

  it("resolves a community with no channel to its full id", async () => {
    await expect(parseCallCommand(["bitcoin"])).resolves.toEqual({
      protocol: "concord",
      communityId: BUILDERS,
    });
  });

  it("carries a miss through as a prefix — the vault may not have synced", async () => {
    await expect(parseCallCommand(["NostRica"])).resolves.toEqual({
      protocol: "concord",
      communityId: "nostrica",
    });
  });

  it("shows the running call with no argument", async () => {
    await expect(parseCallCommand([])).resolves.toEqual({});
  });

  // THE case, and the one that was broken: `shell-quote` treats `'` as a quote
  // character, so the palette hands a parser two tokens with the separator
  // gone. Every documented example goes through this path.
  it("rejoins the pair the palette split on the apostrophe", async () => {
    await expect(
      parseCallCommand(["relay.example.com", "bitcoin-dev"]),
    ).resolves.toEqual({
      protocol: "nip-29",
      relayUrl: "wss://relay.example.com",
      groupId: "bitcoin-dev",
    });
  });

  // Only when the first token looks like a host: a two-word community name is
  // not a group, so the first word is read as the community.
  it("does not rejoin two words that are a community name", async () => {
    const parsed = await parseCallCommand(["bitcoin", "builders"]);
    expect(parsed.protocol).toBe("concord");
  });

  // A relay group has a typeable address, unlike a Concord channel, so this
  // needs no local vault lookup at all.
  it("takes a relay group's space by its address", async () => {
    await expect(
      parseCallCommand(["relay.example.com'bitcoin-dev"]),
    ).resolves.toEqual({
      protocol: "nip-29",
      relayUrl: "wss://relay.example.com",
      groupId: "bitcoin-dev",
    });
  });

  it("keeps an explicit scheme, and the group id verbatim", async () => {
    await expect(parseCallCommand(["wss://nos.lol'Welcome"])).resolves.toEqual({
      protocol: "nip-29",
      relayUrl: "wss://nos.lol",
      groupId: "Welcome",
    });
  });

  // Nothing else in the app can address a group over plaintext either, and the
  // AV endpoint is what refuses it — the parser's job is only to read the pair.
  it("reads a ws:// pair rather than silently upgrading it", async () => {
    await expect(
      parseCallCommand(["ws://localhost:7777'test"]),
    ).resolves.toEqual({
      protocol: "nip-29",
      relayUrl: "ws://localhost:7777",
      groupId: "test",
    });
  });

  it("does not mistake a community name for a group", async () => {
    const parsed = await parseCallCommand(["bitcoin"]);
    expect(parsed.protocol).toBe("concord");
  });
});
