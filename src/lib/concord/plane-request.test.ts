import { afterEach, describe, expect, it } from "vitest";
import { RelayPool } from "applesauce-relay";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import { fakeEvent, startMockRelay, type MockRelay } from "@/test/mock-relay";

import { planeRequest } from "./plane-request";
import {
  _resetStreamAuthRegistry,
  authenticateStreams,
  registerStreamKeys,
} from "./stream-auth";

/**
 * The three outcomes the sweep's whole design rests on being DISTINGUISHABLE.
 * `requestEvents()` collapses all of them to `[]`, which is why plane reads do
 * not use it.
 */

let relay: MockRelay | undefined;
let pool: RelayPool | undefined;

afterEach(async () => {
  pool?.close();
  pool = undefined;
  await relay?.close();
  relay = undefined;
  _resetStreamAuthRegistry();
});

const KIND_WRAP = 1059;

function wrap(sk: Uint8Array, createdAt: number, content = "x"): NostrEvent {
  return finalizeEvent(
    { kind: KIND_WRAP, content, tags: [], created_at: createdAt },
    sk,
  );
}

describe("planeRequest outcomes", () => {
  it("reports `eose` and the events on a healthy read", async () => {
    const event = fakeEvent({ kind: KIND_WRAP, id: "1" });
    relay = await startMockRelay({ kind: "normal", events: [event] });
    pool = new RelayPool();

    const result = await planeRequest(
      relay.url,
      { kinds: [KIND_WRAP] },
      { pool },
    );
    expect(result.outcome).toBe("eose");
    expect(result.events.map((e) => e.id)).toEqual([event.id]);
  });

  it("reports `eose` — not silence — for a genuinely empty plane", async () => {
    relay = await startMockRelay({ kind: "normal", events: [] });
    pool = new RelayPool();

    const result = await planeRequest(
      relay.url,
      { kinds: [KIND_WRAP] },
      { pool },
    );
    expect(result.outcome).toBe("eose");
    expect(result.events).toEqual([]);
  });

  it("reports `refused` on an auth-required CLOSED", async () => {
    // The distinction the sweep exists on: this is the gate, not an empty
    // plane, and it must NOT advance a floor or count as a relay reached.
    relay = await startMockRelay({ kind: "auth-required" });
    pool = new RelayPool();

    const result = await planeRequest(
      relay.url,
      { kinds: [KIND_WRAP] },
      { pool },
    );
    expect(result.outcome).toBe("refused");
    expect(result.events).toEqual([]);
    expect(result.reason).toContain("auth-required");
  });

  it("reports `closed` on a CLOSED for any other reason", async () => {
    relay = await startMockRelay({ kind: "close-after-eose", events: [] });
    pool = new RelayPool();

    // EOSE arrives first here, which is the correct read: the relay answered.
    const result = await planeRequest(
      relay.url,
      { kinds: [KIND_WRAP] },
      { pool },
    );
    expect(result.outcome).toBe("eose");
  });

  it("reports `timeout` on a relay that accepts the REQ and says nothing", async () => {
    relay = await startMockRelay({ kind: "silent" });
    pool = new RelayPool();

    const started = Date.now();
    const result = await planeRequest(
      relay.url,
      { kinds: [KIND_WRAP] },
      { pool, timeout: 300 },
    );
    expect(result.outcome).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("does NOT flood a refusing relay", async () => {
    // With applesauce's defaults a refused REQ resubscribes at round-trip
    // speed. One REQ per call is the whole point of the options.
    relay = await startMockRelay({ kind: "auth-required" });
    pool = new RelayPool();

    await planeRequest(relay.url, { kinds: [KIND_WRAP] }, { pool });
    await new Promise((r) => setTimeout(r, 200));
    expect(relay.reqCount()).toBe(1);
  });
});

describe("planeRequest against a NIP-42 gating relay", () => {
  it("is refused before the stream authenticates and served after", async () => {
    // End to end: the stream key answers the challenge, on the same socket,
    // and the previously-refused REQ then succeeds. This is what makes a
    // Concord plane readable on a relay that gates kind 1059.
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const event = wrap(sk, 1_700_000_000);
    relay = await startMockRelay({ kind: "nip42-gated", events: [event] });
    pool = new RelayPool();

    const filter = { kinds: [KIND_WRAP], authors: [pk] };
    const before = await planeRequest(relay.url, filter, { pool });
    expect(before.outcome).toBe("refused");

    registerStreamKeys([{ pk, sk }], [relay.url]);
    const acked = await authenticateStreams(pool.relay(relay.url));
    expect(acked).toEqual([pk]);

    const after = await planeRequest(relay.url, filter, { pool });
    expect(after.outcome).toBe("eose");
    expect(after.events.map((e) => e.id)).toEqual([event.id]);
  });

  it("stays refused for an ADDRESS-ONLY key we cannot sign for", async () => {
    // A split Control Plane's `control_pk` (CORD-02 §2): every member holds the
    // address, only staff hold the secret. On a gating relay that plane is
    // simply unreadable, and the read has to SAY so rather than look empty.
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    relay = await startMockRelay({
      kind: "nip42-gated",
      events: [wrap(sk, 1)],
    });
    pool = new RelayPool();

    registerStreamKeys([{ pk }], [relay.url]); // no secret
    await authenticateStreams(pool.relay(relay.url));

    const result = await planeRequest(
      relay.url,
      { kinds: [KIND_WRAP], authors: [pk] },
      { pool },
    );
    expect(result.outcome).toBe("refused");
  });
});

describe("the paged mock relay honours real filter semantics", () => {
  it("applies authors, until (inclusive), limit and its own page cap", async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const other = generateSecretKey();
    const events = [
      wrap(sk, 100),
      wrap(sk, 200),
      wrap(sk, 300),
      wrap(other, 250), // another author entirely
    ];
    relay = await startMockRelay({ kind: "paged", events, pageLimit: 2 });
    pool = new RelayPool();

    const page = await planeRequest(
      relay.url,
      { kinds: [KIND_WRAP], authors: [pk], until: 200, limit: 10 },
      { pool },
    );
    expect(page.outcome).toBe("eose");
    // Newest-first, `until` inclusive, capped by the relay at 2.
    expect(page.events.map((e) => e.created_at)).toEqual([200, 100]);
  });
});
