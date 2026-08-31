import { describe, it, expect, afterEach } from "vitest";
import {
  getBlockedRelays,
  getBlockedRelaysOwner,
  isRelayBlocked,
  filterBlockedRelays,
  setBlockedRelays,
  blocked$,
} from "./blocked-relays";

const OWNER = "a".repeat(64);

afterEach(() => {
  setBlockedRelays([], null);
});

describe("blocked relay matching", () => {
  it("matches regardless of trailing slash, scheme case, or host case", () => {
    // The list is authored by hand in a text field; the URLs it is compared
    // against come off relay hints. Neither is normalized at the source.
    setBlockedRelays(["wss://Spam.example.com"], OWNER);

    for (const url of [
      "wss://spam.example.com",
      "wss://spam.example.com/",
      "wss://SPAM.example.com/",
      "WSS://spam.example.com",
    ]) {
      expect(isRelayBlocked(url), url).toBe(true);
    }
  });

  it("does not match a different host that shares a prefix", () => {
    setBlockedRelays(["wss://spam.example.com"], OWNER);

    expect(isRelayBlocked("wss://spam.example.com.evil.net")).toBe(false);
    expect(isRelayBlocked("wss://notspam.example.com")).toBe(false);
  });

  it("treats an unparseable URL as not blocked instead of throwing", () => {
    // `normalizeRelayURL` throws by contract. This runs on every read in the
    // app against hint-derived URLs, so one piece of garbage must not take down
    // a subscription.
    setBlockedRelays(["wss://spam.example.com"], OWNER);

    expect(() => isRelayBlocked("")).not.toThrow();
    expect(isRelayBlocked("")).toBe(false);
    expect(isRelayBlocked("not a url at all")).toBe(false);
  });

  it("ignores list entries that cannot be normalized", () => {
    setBlockedRelays(["", "wss://good.example.com", "://nonsense"], OWNER);

    expect(getBlockedRelays().size).toBe(1);
    expect(isRelayBlocked("wss://good.example.com")).toBe(true);
  });

  it("blocks nothing when the list is empty", () => {
    setBlockedRelays([], null);
    expect(isRelayBlocked("wss://anything.example.com")).toBe(false);
  });
});

describe("filterBlockedRelays", () => {
  it("drops blocked relays and preserves the caller's own URL spelling", () => {
    // Callers use these strings as map keys — `message.from`, per-relay publish
    // status — so rewriting them here would break that matching.
    setBlockedRelays(["wss://spam.example.com"], OWNER);

    expect(
      filterBlockedRelays([
        "wss://good.example.com",
        "wss://SPAM.example.com/",
        "wss://other.example.com/",
      ]),
    ).toEqual(["wss://good.example.com", "wss://other.example.com/"]);
  });

  it("returns an empty list when every relay is blocked", () => {
    setBlockedRelays(["wss://a.example.com", "wss://b.example.com"], OWNER);

    expect(
      filterBlockedRelays(["wss://a.example.com", "wss://b.example.com"]),
    ).toEqual([]);
  });
});

describe("blocked$", () => {
  it("suppresses an identical set so an unchanged list cannot trigger a prune", () => {
    // A replaceable event can be re-delivered by every relay that holds it.
    // Re-emitting would close sockets opened since the last emission.
    const emissions: number[] = [];
    const sub = blocked$.subscribe((set) => emissions.push(set.size));

    setBlockedRelays(["wss://spam.example.com"], OWNER);
    setBlockedRelays(["wss://spam.example.com"], OWNER);
    setBlockedRelays(["wss://spam.example.com/"], OWNER);

    sub.unsubscribe();

    // Initial empty emission, then exactly one change.
    expect(emissions).toEqual([0, 1]);
  });

  it("emits when the list actually changes", () => {
    const emissions: number[] = [];
    const sub = blocked$.subscribe((set) => emissions.push(set.size));

    setBlockedRelays(["wss://a.example.com"], OWNER);
    setBlockedRelays(["wss://a.example.com", "wss://b.example.com"], OWNER);
    setBlockedRelays([], null);

    sub.unsubscribe();

    expect(emissions).toEqual([0, 1, 2, 0]);
  });
});

describe("persistence across sessions", () => {
  it("writes the set under its owner so a reload can enforce immediately", () => {
    // The startup window this closes: kind 10006 is fetched over the network
    // and the EventStore is in-memory, so without a seed a cold load enforces
    // nothing until the fetch lands and blocked relays join the pool visibly.
    setBlockedRelays(["wss://spam.example.com"], OWNER);

    const raw = localStorage.getItem("grimoire:blocked-relays");
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!);
    expect(stored.lastActive).toBe(OWNER);
    expect(stored.byPubkey[OWNER]).toEqual(["wss://spam.example.com/"]);
  });

  it("keeps another account's seed when the active account changes", () => {
    // A single-slot store deleted it, so returning to the first account found
    // no seed and its startup window reopened on every cold start.
    const other = "c".repeat(64);
    setBlockedRelays(["wss://spam.example.com"], OWNER);
    setBlockedRelays(["wss://other.example.com"], other);

    const stored = JSON.parse(localStorage.getItem("grimoire:blocked-relays")!);
    expect(stored.lastActive).toBe(other);
    expect(stored.byPubkey[OWNER]).toEqual(["wss://spam.example.com/"]);
    expect(stored.byPubkey[other]).toEqual(["wss://other.example.com/"]);
  });

  it("drops only the pointer when there is no account", () => {
    setBlockedRelays(["wss://spam.example.com"], OWNER);
    setBlockedRelays([], null);

    const stored = JSON.parse(localStorage.getItem("grimoire:blocked-relays")!);
    expect(stored.lastActive).toBeUndefined();
    // The signed-out account's own list survives for its next sign-in.
    expect(stored.byPubkey[OWNER]).toEqual(["wss://spam.example.com/"]);
    expect(getBlockedRelaysOwner()).toBeNull();
    expect(isRelayBlocked("wss://spam.example.com")).toBe(false);
  });

  it("tracks the owner so a seed is never applied to another account", () => {
    setBlockedRelays(["wss://spam.example.com"], OWNER);
    expect(getBlockedRelaysOwner()).toBe(OWNER);

    const other = "b".repeat(64);
    setBlockedRelays(["wss://other.example.com"], other);

    expect(getBlockedRelaysOwner()).toBe(other);
    expect(isRelayBlocked("wss://spam.example.com")).toBe(false);
    expect(isRelayBlocked("wss://other.example.com")).toBe(true);
  });
});
