import { describe, it, expect, afterEach, vi } from "vitest";
import { RelayPool } from "applesauce-relay";
import { firstValueFrom, filter, timeout } from "rxjs";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { requestEvents } from "@/lib/relay-subscription";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";
import {
  _resetStreamAuthRegistry,
  authenticateStreams,
  canSignAsStream,
  noteRelayChallenged,
  noteStreamAuthResult,
  onStreamAuthStale,
  onStreamKeysAdded,
  registerStreamKeys,
  resetRelayAuth,
  signStreamAuths,
  streamAuthsSettled,
} from "./stream-auth";

/**
 * Concord addresses every plane to a DERIVED stream pubkey, so on a relay that
 * gates kind 1059 behind NIP-42 the user's own login authenticates nothing that
 * matters. These are the invariants that whole design rests on.
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
  _resetStreamAuthRegistry();
  for (const p of pools.splice(0)) p.close();
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

/** A plane event authored by the stream key, as a real wrap would be. */
function planeEvent(sk: Uint8Array) {
  return finalizeEvent(
    {
      kind: 1059,
      content: "ciphertext",
      tags: [["p", "f".repeat(64)]],
      created_at: 1_700_000_000,
    },
    sk,
  );
}

describe("stream-key NIP-42", () => {
  it("gates a plane REQ until the client authenticates AS the stream", async () => {
    const streamSk = generateSecretKey();
    const streamPk = getPublicKey(streamSk);
    const r = await relay({
      kind: "nip42-gated",
      events: [planeEvent(streamSk)],
    });
    const p = pool();

    registerStreamKeys([{ pk: streamPk, sk: streamSk }], [r.url]);

    // The user's identity is irrelevant here: the filter is authored by the
    // stream address, which no login can speak for.
    //
    // `waitForAuth: false` is mandatory for every Concord read. Applesauce's
    // default gates a REQ on ITS notion of authentication — a single identity
    // per socket — so the first `auth-required` latches
    // `authRequiredForRead$` and every later REQ blocks on `authenticated$`,
    // which stream AUTHs deliberately never set. We know when our own keys are
    // acked, so applesauce's guess adds nothing and only deadlocks.
    const refused = await requestEvents(
      [r.url],
      [{ kinds: [1059], authors: [streamPk] }],
      {
        pool: p,
        eventStore: null,
        timeout: 2000,
        waitForAuth: false,
      },
    );
    expect(refused).toEqual([]);
    expect(r.authedPubkeys()).toEqual([]);

    // The REQ opened the socket, so the challenge is in hand. A relay's
    // challenge stays valid for the socket's lifetime, which is what lets a key
    // authenticate after its REQ was already refused.
    const rel = p.relay(r.url);
    await firstValueFrom(rel.challenge$.pipe(filter(Boolean), timeout(2000)));

    const acked = await authenticateStreams(rel);
    expect(acked).toEqual([streamPk]);
    expect(r.authedPubkeys()).toEqual([streamPk]);

    const served = await requestEvents(
      [r.url],
      [{ kinds: [1059], authors: [streamPk] }],
      {
        pool: p,
        eventStore: null,
        timeout: 2000,
        waitForAuth: false,
      },
    );
    expect(served).toHaveLength(1);
    expect(served[0].pubkey).toBe(streamPk);
  });

  it("deadlocks without waitForAuth:false, even fully authenticated", async () => {
    // The guard for the option above. Once a REQ has been refused,
    // applesauce latches `authRequiredForRead$` and gates every later read on
    // `authenticated$` — which our stream AUTHs never set, by design. So the
    // read hangs until the caller's own timeout despite the relay being
    // perfectly willing to serve it. Dropping `waitForAuth: false` anywhere in
    // the Concord read path reintroduces this, and it reads as "the relay
    // returned nothing", not as a bug.
    const streamSk = generateSecretKey();
    const streamPk = getPublicKey(streamSk);
    const r = await relay({
      kind: "nip42-gated",
      events: [planeEvent(streamSk)],
    });
    const p = pool();
    registerStreamKeys([{ pk: streamPk, sk: streamSk }], [r.url]);

    await requestEvents([r.url], [{ kinds: [1059], authors: [streamPk] }], {
      pool: p,
      eventStore: null,
      timeout: 300,
      waitForAuth: false,
    });
    const rel = p.relay(r.url);
    await firstValueFrom(rel.challenge$.pipe(filter(Boolean), timeout(2000)));
    expect(await authenticateStreams(rel)).toEqual([streamPk]);

    // Authenticated as the stream, and the relay would serve it — but the
    // default read strategy never lets the REQ out.
    const gated = await requestEvents(
      [r.url],
      [{ kinds: [1059], authors: [streamPk] }],
      {
        pool: p,
        eventStore: null,
        timeout: 300,
      },
    );
    expect(gated).toEqual([]);
  });

  it("does not flood a gating relay when some other key is authenticated", async () => {
    // The sharper half of the same gate, and the reason `waitForAuth: false` is
    // protection rather than tuning.
    //
    // Applesauce's auth retry has no `count`, and its notifier is
    // `authenticated$.pipe(filter(Boolean), take(1))` over a BehaviorSubject.
    // So if ANYTHING has authenticated this socket — relay-auth-manager
    // auto-authenticating the user is the obvious case — the notifier emits
    // synchronously and the refused REQ resubscribes as fast as the round trip
    // allows. Measured at ~17k REQ/s against localhost: the same failure class
    // as the resubscribe loop CLAUDE.md already documents, aimed at someone
    // else's relay.
    const streamSk = generateSecretKey();
    const streamPk = getPublicKey(streamSk);
    const userSk = generateSecretKey();
    const r = await relay({ kind: "nip42-gated", events: [] });
    const p = pool();
    const rel = p.relay(r.url);

    // Open the socket and take the challenge, then authenticate as the USER —
    // a key with no bearing on the filter below.
    await requestEvents([r.url], [{ kinds: [1] }], {
      pool: p,
      eventStore: null,
      timeout: 300,
      waitForAuth: false,
    });
    const challenge = await firstValueFrom(
      rel.challenge$.pipe(filter(Boolean), timeout(2000)),
    );
    await rel.auth(
      finalizeEvent(
        {
          kind: 22242,
          content: "",
          tags: [
            ["relay", r.url],
            ["challenge", challenge],
          ],
          created_at: Math.floor(Date.now() / 1000),
        },
        userSk,
      ),
    );
    expect(rel.authenticated).toBe(true);

    // A plane REQ for a stream we have NOT authenticated as. With the opt-out
    // it is refused once and left alone.
    const before = r.reqCount();
    await requestEvents([r.url], [{ kinds: [1059], authors: [streamPk] }], {
      pool: p,
      eventStore: null,
      timeout: 500,
      waitForAuth: false,
    });
    expect(r.reqCount() - before).toBeLessThanOrEqual(2);
  });

  it("does not clobber the socket's single-identity auth state", async () => {
    // applesauce models NIP-42 as ONE identity per socket: `relay.auth()` does
    // `authentication$.next(event)`. Authenticating as N streams through it
    // would leave the relay reporting a derived stream address as who the
    // socket is authenticated as — and `relay-auth-manager` watches
    // `authenticated$` to decide whether the USER is authenticated, so it would
    // read a stream's ack as the user's and stop prompting.
    const streamSk = generateSecretKey();
    const streamPk = getPublicKey(streamSk);
    const r = await relay({ kind: "nip42-gated", events: [] });
    const p = pool();
    registerStreamKeys([{ pk: streamPk, sk: streamSk }], [r.url]);

    await requestEvents([r.url], [{ kinds: [1059], authors: [streamPk] }], {
      pool: p,
      eventStore: null,
      timeout: 2000,
    });
    const rel = p.relay(r.url);
    const challenge = await firstValueFrom(
      rel.challenge$.pipe(filter(Boolean), timeout(2000)),
    );

    await authenticateStreams(rel);
    expect(r.authedPubkeys()).toEqual([streamPk]);
    expect(rel.authentication$.value).toBeNull();

    // And the contrast, so the reason this module avoids `auth()` stays visible.
    await rel.auth(signStreamAuths(challenge, r.url, [streamPk])[0]);
    expect(rel.authentication$.value?.pubkey).toBe(streamPk);
  });

  it("skips address-only keys instead of blocking on them", async () => {
    // A split Control Plane's `control_pk` is held by every member but signed
    // for only by staff, so there is no secret to answer a challenge with.
    // Waiting on it would wedge every sweep forever.
    const held = generateSecretKey();
    const heldPk = getPublicKey(held);
    const addressOnly = getPublicKey(generateSecretKey());

    registerStreamKeys(
      [{ pk: heldPk, sk: held }, { pk: addressOnly }],
      ["wss://relay.test"],
    );

    expect(canSignAsStream(heldPk)).toBe(true);
    expect(canSignAsStream(addressOnly)).toBe(false);

    const signed = signStreamAuths("challenge", "wss://relay.test");
    expect(signed.map((e) => e.pubkey)).toEqual([heldPk]);

    // Never challenged → nothing to wait for.
    expect(streamAuthsSettled("wss://relay.test", [heldPk, addressOnly])).toBe(
      true,
    );
  });

  it("widens a key's relay scope but never narrows it", async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);

    expect(registerStreamKeys([{ pk, sk }], ["wss://a.test"])).toEqual([pk]);
    // Re-registering with a relay already covered changes nothing.
    expect(registerStreamKeys([{ pk, sk }], ["wss://a.test"])).toEqual([]);
    // A second community on another relay widens it.
    expect(registerStreamKeys([{ pk, sk }], ["wss://b.test"])).toEqual([pk]);

    expect(signStreamAuths("c", "wss://a.test").map((e) => e.pubkey)).toEqual([
      pk,
    ]);
    expect(signStreamAuths("c", "wss://b.test").map((e) => e.pubkey)).toEqual([
      pk,
    ]);
    expect(signStreamAuths("c", "wss://other.test")).toEqual([]);
  });

  it("upgrades an address-only registration when the secret arrives", async () => {
    // A member promoted to staff receives `control_root` and can suddenly sign
    // for an address they previously only held.
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);

    registerStreamKeys([{ pk }], ["wss://a.test"]);
    expect(canSignAsStream(pk)).toBe(false);

    // The upgrade MUST be reported. `changed` is what fires the listeners that
    // re-sign AUTH frames; an unannounced upgrade means nothing ever sends a
    // 22242 for this address, so every REQ authored by it stays refused until
    // the socket reopens — visible only as an empty plane.
    expect(registerStreamKeys([{ pk, sk }], ["wss://a.test"])).toEqual([pk]);
    expect(canSignAsStream(pk)).toBe(true);
    expect(signStreamAuths("c", "wss://a.test").map((e) => e.pubkey)).toEqual([
      pk,
    ]);
  });

  it("widens the scope in the same call that delivers the secret", async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    registerStreamKeys([{ pk }], ["wss://a.test"]);
    registerStreamKeys([{ pk, sk }], ["wss://b.test"]);
    // Both facts landed: the secret, and the new relay.
    expect(canSignAsStream(pk)).toBe(true);
    expect(signStreamAuths("c", "wss://b.test").map((e) => e.pubkey)).toEqual([
      pk,
    ]);
    expect(signStreamAuths("c", "wss://a.test").map((e) => e.pubkey)).toEqual([
      pk,
    ]);
  });

  it("notifies listeners when a key is added or upgraded", async () => {
    const seen: string[][] = [];
    const off = onStreamKeysAdded((added) => seen.push(added));
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    registerStreamKeys([{ pk }], ["wss://a.test"]);
    registerStreamKeys([{ pk, sk }], ["wss://a.test"]);
    registerStreamKeys([{ pk, sk }], ["wss://a.test"]); // no-op
    off();
    expect(seen).toEqual([[pk], [pk]]);
  });
});

describe("per-relay ack tracking", () => {
  const URL = "wss://gate.test";

  it("reports settled when the relay never challenged", () => {
    const pk = getPublicKey(generateSecretKey());
    expect(streamAuthsSettled(URL, [pk])).toBe(true);
  });

  it("holds unsettled until every signable key is acked", () => {
    const a = generateSecretKey();
    const b = generateSecretKey();
    const [pkA, pkB] = [getPublicKey(a), getPublicKey(b)];
    registerStreamKeys(
      [
        { pk: pkA, sk: a },
        { pk: pkB, sk: b },
      ],
      [URL],
    );
    noteRelayChallenged(URL);
    expect(streamAuthsSettled(URL, [pkA, pkB])).toBe(false);
    noteStreamAuthResult(URL, pkA, true);
    expect(streamAuthsSettled(URL, [pkA, pkB])).toBe(false);
    noteStreamAuthResult(URL, pkB, true);
    expect(streamAuthsSettled(URL, [pkA, pkB])).toBe(true);
  });

  it("does not count a REFUSED auth as an ack", () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    registerStreamKeys([{ pk, sk }], [URL]);
    noteRelayChallenged(URL);
    noteStreamAuthResult(URL, pk, false);
    expect(streamAuthsSettled(URL, [pk])).toBe(false);
  });

  it("still waits on a pubkey that is not registered at all", () => {
    // The distinction that matters: a REGISTERED-but-secretless address (a
    // split control_pk) is skipped, because no secret can ever answer for it.
    // An UNREGISTERED pubkey is a registration that has not landed yet, and
    // skipping it reports settled for a REQ that will simply be refused, with
    // no gate left to retry behind.
    const held = generateSecretKey();
    const heldPk = getPublicKey(held);
    const addressOnly = getPublicKey(generateSecretKey());
    const unregistered = getPublicKey(generateSecretKey());
    registerStreamKeys([{ pk: heldPk, sk: held }, { pk: addressOnly }], [URL]);
    noteRelayChallenged(URL);
    noteStreamAuthResult(URL, heldPk, true);

    expect(streamAuthsSettled(URL, [heldPk, addressOnly])).toBe(true);
    expect(streamAuthsSettled(URL, [heldPk, unregistered])).toBe(false);
  });

  it("drops the acks when the socket is reset", () => {
    // A reopened socket is a fresh unauthenticated session; carrying the acks
    // over would report settled for a connection that knows none of them.
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    registerStreamKeys([{ pk, sk }], [URL]);
    noteRelayChallenged(URL);
    noteStreamAuthResult(URL, pk, true);
    expect(streamAuthsSettled(URL, [pk])).toBe(true);

    resetRelayAuth(URL);
    expect(streamAuthsSettled(URL, [pk])).toBe(true); // no challenge yet
    noteRelayChallenged(URL);
    expect(streamAuthsSettled(URL, [pk])).toBe(false); // the ack is gone
  });

  it("self-heals a stale challenge instead of blocking forever", async () => {
    // Past the window an AUTH frame or its OK was lost. Keep reporting
    // unsettled and every sweep burns its wait cap on a socket that will never
    // recover without a re-auth.
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    registerStreamKeys([{ pk, sk }], [URL]);
    noteRelayChallenged(URL);
    expect(streamAuthsSettled(URL, [pk])).toBe(false);

    const stale: string[] = [];
    const off = onStreamAuthStale((url) => stale.push(url));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 13_000);
    expect(streamAuthsSettled(URL, [pk])).toBe(true);
    vi.useRealTimers();
    off();
    expect(stale).toHaveLength(1);
  });
});
