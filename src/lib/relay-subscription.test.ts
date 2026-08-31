import { describe, it, expect, afterEach } from "vitest";
import { RelayPool } from "applesauce-relay";
import { requestEvents, streamWithEose } from "./relay-subscription";
import { startMockRelay, fakeEvent, type MockRelay } from "@/test/mock-relay";
import { setBlockedRelays } from "@/services/blocked-relays";

const OWNER = "a".repeat(64);

/**
 * Regression tests for relay plumbing invariants.
 *
 * Every case here corresponds to a bug that shipped: a one-shot request that
 * never settled, an EOSE that could not be reached, events delivered once per
 * relay, and a resubscribe loop that sent tens of thousands of REQs per second.
 * None of them were caught by typechecking or by the rest of the suite.
 */

const relays: MockRelay[] = [];
const pools: RelayPool[] = [];

function pool() {
  const p = new RelayPool();
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

describe("requestEvents", () => {
  it("resolves against a relay that refuses the REQ with auth-required", async () => {
    // applesauce's own `timeout` option cannot catch this: the relay connects,
    // which emits OPEN and disarms it, then sends no EVENT/EOSE/CLOSED/ERROR.
    const r = await relay({ kind: "auth-required" });

    const events = await requestEvents([r.url], [{ kinds: [1] }], {
      pool: pool(),
      eventStore: null,
      timeout: 300,
    });

    expect(events).toEqual([]);
  });

  it("resolves against a relay that connects and then goes silent", async () => {
    const r = await relay({ kind: "silent" });

    const events = await requestEvents([r.url], [{ kinds: [1] }], {
      pool: pool(),
      eventStore: null,
      timeout: 300,
    });

    expect(events).toEqual([]);
  });

  it("returns the events a relay did send", async () => {
    const r = await relay({
      kind: "normal",
      events: [fakeEvent({ id: "1".repeat(64) })],
    });

    const events = await requestEvents([r.url], [{ kinds: [1] }], {
      pool: pool(),
      eventStore: null,
      timeout: 2000,
    });

    expect(events.map((e) => e.id)).toEqual(["1".repeat(64)]);
  });
});

describe("streamWithEose", () => {
  it("signals EOSE when the same relay is passed twice, un-normalized", async () => {
    // `message.from` carries the normalized URL, so comparing against the raw
    // input count made EOSE unreachable for duplicate or unslashed URLs.
    const r = await relay({ kind: "normal" });
    let eosed = false;

    await new Promise<void>((resolve) => {
      const sub = streamWithEose([r.url, `${r.url}/`], [{ kinds: [1] }], {
        pool: pool(),
        store: null,
        eoseTimeout: 5000,
        onEose: () => {
          eosed = true;
          sub.unsubscribe();
          resolve();
        },
      }).subscribe();
      setTimeout(() => {
        sub.unsubscribe();
        resolve();
      }, 3000);
    });

    expect(eosed).toBe(true);
  });

  it("emits each event once even when several relays have it", async () => {
    // pool.req() delivers one copy per relay, unlike pool.subscription().
    const shared = fakeEvent({ id: "d".repeat(64) });
    const a = await relay({ kind: "normal", events: [shared] });
    const b = await relay({ kind: "normal", events: [shared] });

    const seen: string[] = [];
    await new Promise<void>((resolve) => {
      const sub = streamWithEose([a.url, b.url], [{ kinds: [1] }], {
        pool: pool(),
        store: null,
        eoseTimeout: 5000,
        onEose: () => {
          sub.unsubscribe();
          resolve();
        },
      }).subscribe((e) => seen.push(e.id));
      setTimeout(() => {
        sub.unsubscribe();
        resolve();
      }, 3000);
    });

    expect(seen).toEqual(["d".repeat(64)]);
  });

  it("signals EOSE and completes when given no relays", async () => {
    let eosed = false;
    let completed = false;

    await new Promise<void>((resolve) => {
      streamWithEose([], [{ kinds: [1] }], {
        pool: pool(),
        store: null,
        onEose: () => {
          eosed = true;
        },
      }).subscribe({
        complete: () => {
          completed = true;
          resolve();
        },
      });
      setTimeout(resolve, 500);
    });

    expect({ eosed, completed }).toEqual({ eosed: true, completed: true });
  });

  it("does not flood a relay that closes the subscription after EOSE", async () => {
    // `resubscribe: true` becomes repeat({ delay: of(null) }) — synchronous,
    // measured at >20k REQ frames per second. The default must back off.
    const r = await relay({ kind: "close-after-eose" });

    const sub = streamWithEose([r.url], [{ kinds: [1] }], {
      pool: pool(),
      store: null,
      eoseTimeout: 5000,
    }).subscribe();

    await new Promise((resolve) => setTimeout(resolve, 1500));
    sub.unsubscribe();

    // A backed-off reopen sends a small handful; a synchronous loop sends
    // thousands. The bound is deliberately loose — it only has to fail on a flood.
    expect(r.reqCount()).toBeLessThan(20);
  });
});

describe("streamWithEose and blocked relays", () => {
  it("reaches EOSE without waiting for the backstop when a relay is blocked", async () => {
    // The regression this guards: `expected` was built from the caller's list,
    // so a relay the pool silently dropped could never settle and EOSE waited
    // out the full timeout. Chat rendering is gated on EOSE, so that showed as
    // an empty conversation until the backstop fired.
    const allowed = await relay({ kind: "normal" });
    const blocked = await relay({ kind: "silent" });
    setBlockedRelays([blocked.url], OWNER);

    const started = Date.now();
    let eosed = false;

    await new Promise<void>((resolve) => {
      const sub = streamWithEose([allowed.url, blocked.url], [{ kinds: [1] }], {
        pool: pool(),
        store: null,
        // Generous on purpose: the assertion is that EOSE does NOT wait for
        // this, so a short backstop would pass even with the bug present.
        eoseTimeout: 10_000,
        onEose: () => {
          eosed = true;
          sub.unsubscribe();
          resolve();
        },
      }).subscribe();
      setTimeout(() => {
        sub.unsubscribe();
        resolve();
      }, 4000);
    });

    expect(eosed).toBe(true);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("signals EOSE immediately when every relay is blocked", async () => {
    // Otherwise a fully blocked timeline sits in LOADING forever.
    const a = await relay({ kind: "normal" });
    setBlockedRelays([a.url], OWNER);

    let eosed = false;
    const events: string[] = [];

    await new Promise<void>((resolve) => {
      streamWithEose([a.url], [{ kinds: [1] }], {
        pool: pool(),
        store: null,
        eoseTimeout: 10_000,
        onEose: () => {
          eosed = true;
        },
      }).subscribe({
        next: (e) => events.push(e.id),
        complete: () => resolve(),
      });
    });

    expect(eosed).toBe(true);
    expect(events).toEqual([]);
    expect(a.reqCount()).toBe(0);
  });
  it("reaches EOSE when a relay is blocked while its REQ is in flight", async () => {
    // The cold-load case, and the one filtering at subscribe time cannot cover:
    // kind 10006 arrives over the network AFTER the subscription is open. The
    // prune then closes the socket by unsubscribing it, which drops the REQ with
    // no EOSE, CLOSED, ERROR or complete — so that relay can never settle. Chat
    // is gated on EOSE, so without this the conversation is blank for the full
    // 15s backstop on every reload.
    const r = await relay({ kind: "silent" });
    const p = pool();

    let eoseAt: number | null = null;
    const started = Date.now();

    const sub = streamWithEose([r.url], [{ kinds: [1] }], {
      pool: p,
      store: null,
      eoseTimeout: 10_000,
      onEose: () => {
        eoseAt = Date.now() - started;
      },
    }).subscribe();

    // Let the REQ reach the relay before the list lands.
    await new Promise((res) => setTimeout(res, 300));
    expect(r.reqCount()).toBe(1);

    setBlockedRelays([r.url], OWNER);
    await new Promise((res) => setTimeout(res, 200));
    sub.unsubscribe();

    expect(eoseAt).not.toBeNull();
    // Well under the 10s backstop: the assertion is that the prune itself
    // settles it, not the timer.
    expect(eoseAt!).toBeLessThan(2000);
  });
});
