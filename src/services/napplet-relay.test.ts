import { describe, it, expect, afterEach } from "vitest";
import { RelayPool } from "applesauce-relay";
import { EventStore } from "applesauce-core";

import { createNappletRelayPool } from "./napplet-relay";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

/** A real signed event: the shared EventStore drops anything it cannot verify. */
function signedNote() {
  return finalizeEvent(
    { kind: 1, content: "hello", tags: [], created_at: 1_700_000_000 },
    generateSecretKey(),
  );
}

/**
 * A contract test for the one thing about this adapter Kehto cares about.
 *
 * Kehto's shell does `if (item === "EOSE") callback("EOSE")` on the observable we
 * hand it, and its runtime only sends the napplet a `relay.eose` on that
 * sentinel — or after a 15-second fallback timer. An applesauce v6 pool
 * subscription emits `NostrEvent` only, so returning `pool.subscription()` raw
 * made every napplet subscription EOSE 15s late while typechecking cleanly (the
 * observer is typed `(item: unknown) => void`). Asserting a *deadline* here is
 * the point: without it, a regression looks like a pass that took 15 seconds.
 */

const relays: MockRelay[] = [];
const pools: RelayPool[] = [];

async function relay(...args: Parameters<typeof startMockRelay>) {
  const r = await startMockRelay(...args);
  relays.push(r);
  return r;
}

function pool() {
  const p = new RelayPool();
  pools.push(p);
  return p;
}

afterEach(async () => {
  for (const p of pools.splice(0)) p.close();
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

/** Collect what Kehto's callback would see, in order. */
function collect(
  adapter: ReturnType<typeof createNappletRelayPool>,
  urls: string[],
) {
  const seen: unknown[] = [];
  const sub = adapter
    .subscription(urls, [{ kinds: [1] }])
    .subscribe((item) => seen.push(item));
  return { seen, unsubscribe: () => sub.unsubscribe() };
}

async function until(predicate: () => boolean, deadlineMs: number) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > deadlineMs) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
  return true;
}

describe("createNappletRelayPool", () => {
  it("emits the EOSE sentinel Kehto reads, well inside its 15s fallback", async () => {
    const eventStore = new EventStore();
    const r = await relay({ kind: "normal", events: [signedNote()] });
    const adapter = createNappletRelayPool({ pool: pool(), eventStore });

    const { seen, unsubscribe } = collect(adapter, [r.url]);
    const arrived = await until(() => seen.includes("EOSE"), 3_000);
    unsubscribe();

    expect(arrived).toBe(true);
    // The event precedes the boundary, which is what makes the boundary useful.
    expect(seen.filter((i) => i !== "EOSE")).toHaveLength(1);
    expect(seen[seen.length - 1]).toBe("EOSE");
  });

  it("writes events into the store it was given, not a throwaway", async () => {
    // The v6 default is an in-memory store nobody reads, so omitting it drops
    // every event from the shared one while the napplet still receives them.
    const eventStore = new EventStore();
    const r = await relay({ kind: "normal", events: [signedNote()] });
    const adapter = createNappletRelayPool({ pool: pool(), eventStore });

    const { seen, unsubscribe } = collect(adapter, [r.url]);
    await until(() => seen.includes("EOSE"), 3_000);
    unsubscribe();

    expect(eventStore.getTimeline({ kinds: [1] })).toHaveLength(1);
  });
});
