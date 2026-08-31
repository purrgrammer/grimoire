import { describe, it, expect, afterEach } from "vitest";
import { BlockingRelayPool } from "./blocking-relay-pool";
import { setBlockedRelays } from "./blocked-relays";
import { startMockRelay, fakeEvent, type MockRelay } from "@/test/mock-relay";
import { requestEvents } from "@/lib/relay-subscription";

const OWNER = "a".repeat(64);

/**
 * The claim under test is "never open a socket to a blocked relay". A mock relay
 * counts its own REQ frames, so that claim is directly observable rather than
 * inferred from what the client returned.
 */

const relays: MockRelay[] = [];
const pools: BlockingRelayPool[] = [];

function pool() {
  const p = new BlockingRelayPool();
  pools.push(p);
  return p;
}

async function relay(...args: Parameters<typeof startMockRelay>) {
  const r = await startMockRelay(...args);
  relays.push(r);
  return r;
}

afterEach(async () => {
  for (const p of pools.splice(0)) p.close();
  await Promise.all(relays.splice(0).map((r) => r.close()));
  setBlockedRelays([], null);
});

describe("BlockingRelayPool", () => {
  it("never sends a REQ to a blocked relay", async () => {
    const blocked = await relay({
      kind: "normal",
      events: [fakeEvent({ id: "a".repeat(64) })],
    });
    setBlockedRelays([blocked.url], OWNER);

    const events = await requestEvents([blocked.url], [{ kinds: [1] }], {
      pool: pool(),
      eventStore: null,
      timeout: 1000,
    });

    expect(events).toEqual([]);
    expect(blocked.reqCount()).toBe(0);
  });

  it("never registers a blocked relay in the pool", async () => {
    // Registration alone is consequential: it fires `add$`, which liveness and
    // the auth manager both watch, and an auth manager may AUTH it.
    const blocked = await relay({ kind: "normal" });
    setBlockedRelays([blocked.url], OWNER);

    const p = pool();
    await requestEvents([blocked.url], [{ kinds: [1] }], {
      pool: p,
      eventStore: null,
      timeout: 1000,
    });

    expect(p.relays.size).toBe(0);
  });

  it("serves the allowed relays in a partly blocked list", async () => {
    const allowed = await relay({
      kind: "normal",
      events: [fakeEvent({ id: "b".repeat(64) })],
    });
    const blocked = await relay({
      kind: "normal",
      events: [fakeEvent({ id: "c".repeat(64) })],
    });
    setBlockedRelays([blocked.url], OWNER);

    const events = await requestEvents(
      [allowed.url, blocked.url],
      [{ kinds: [1] }],
      { pool: pool(), eventStore: null, timeout: 2000 },
    );

    expect(events.map((e) => e.id)).toEqual(["b".repeat(64)]);
    expect(blocked.reqCount()).toBe(0);
    expect(allowed.reqCount()).toBe(1);
  });

  it("resolves promptly when every relay is blocked", async () => {
    // An empty group is `merge()` of nothing, which completes at once. The risk
    // is the opposite of a hang here, but a regression to a hang would pin a
    // timeline in LOADING forever.
    const a = await relay({ kind: "normal" });
    const b = await relay({ kind: "normal" });
    setBlockedRelays([a.url, b.url], OWNER);

    const started = Date.now();
    const events = await requestEvents([a.url, b.url], [{ kinds: [1] }], {
      pool: pool(),
      eventStore: null,
      timeout: 5000,
    });

    expect(events).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("closes and drops a live socket when the relay becomes blocked", async () => {
    // Connect-then-prune: the list arrives after startup, so enforcement has to
    // reach relays that are already connected.
    const r = await relay({ kind: "normal" });
    const p = pool();

    await requestEvents([r.url], [{ kinds: [1] }], {
      pool: p,
      eventStore: null,
      timeout: 2000,
    });
    expect(p.relays.size).toBe(1);

    setBlockedRelays([r.url], OWNER);

    expect(p.relays.size).toBe(0);
  });

  it("prunes by the pool's own key, not the lowercased blocked entry", async () => {
    // `remove()` looks its argument up raw, and the pool keys by applesauce's
    // normalizeURL, which does not lowercase. Comparing the two sets directly
    // silently pruned nothing.
    const r = await relay({ kind: "normal" });
    const p = pool();

    await requestEvents([r.url.toUpperCase()], [{ kinds: [1] }], {
      pool: p,
      eventStore: null,
      timeout: 2000,
    });

    setBlockedRelays([r.url], OWNER);

    expect(p.relays.size).toBe(0);
  });

  it("lets a relay connect again once it is unblocked", async () => {
    const r = await relay({
      kind: "normal",
      events: [fakeEvent({ id: "e".repeat(64) })],
    });
    setBlockedRelays([r.url], OWNER);
    const p = pool();

    await requestEvents([r.url], [{ kinds: [1] }], {
      pool: p,
      eventStore: null,
      timeout: 1000,
    });
    expect(r.reqCount()).toBe(0);

    setBlockedRelays([], null);

    const events = await requestEvents([r.url], [{ kinds: [1] }], {
      pool: p,
      eventStore: null,
      timeout: 2000,
    });

    expect(events.map((e) => e.id)).toEqual(["e".repeat(64)]);
  });
});
