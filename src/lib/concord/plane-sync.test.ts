import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RelayPool } from "applesauce-relay";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import db from "@/services/db";
import { queryPlane } from "@/services/concord-rumor-store";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

import { bytesToHex, controlGroupKey, random32 } from "./derive";
import { KIND_CONTROL, KIND_SEAL_PLAINTEXT, VSK_CHANNEL } from "./kinds";
import {
  _configureAuthWaitForTests,
  _configureSweepCadenceForTests,
  _configureSweepPagingForTests,
  _resetPlaneSweepForTests,
  controlSweepReach,
  controlSweepTruncated,
  controlSweepUnreadable,
  markControlPlaneStale,
  sweepControl,
} from "./plane-sync";
import {
  _resetStreamAuthRegistry,
  authenticateStreams,
  registerStreamKeys,
} from "./stream-auth";
import { buildRumor, wrapSeal } from "./stream";
import type { Community } from "./types";

let relay: MockRelay | undefined;
let pool: RelayPool | undefined;

const root = random32();
const communityId = random32();
const group = controlGroupKey(root, communityId, 0n);

/** A legacy (epoch-0) community whose Control Plane sits at the derived address. */
function community(relays: string[]): Community {
  return {
    id: communityId,
    idHex: bytesToHex(communityId),
    owner: "aa".repeat(32),
    ownerSalt: random32(),
    root,
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays,
    name: "Test",
  };
}

/**
 * A real control edition on the wire: a plaintext-sealed kind-3308 rumor,
 * wrapped and signed by the control stream key. Anything less would not survive
 * the store's plane fences, which is the point.
 */
function controlWrap(createdAt: number, name: string): NostrEvent {
  const author = generateSecretKey();
  const rumor = buildRumor({
    kind: KIND_CONTROL,
    content: JSON.stringify({ name }),
    tags: [["vsk", VSK_CHANNEL]],
    pubkey: getPublicKey(author),
    createdAtSecs: createdAt,
    ms: null,
  });
  const seal = finalizeEvent(
    {
      kind: KIND_SEAL_PLAINTEXT,
      content: JSON.stringify(rumor),
      tags: [],
      created_at: createdAt,
    },
    author,
  );
  const wrapped = wrapSeal(seal, group);
  // wrapSeal stamps `created_at` from the clock; the pager walks on it, so the
  // wrap has to sit where the test puts it. Re-sign at that timestamp.
  return finalizeEvent(
    {
      kind: wrapped.kind,
      content: wrapped.content,
      tags: wrapped.tags,
      created_at: createdAt,
    },
    group.sk,
  );
}

/** A wrap at the control address that will NOT open — the flood shape. */
function junkWrap(createdAt: number, salt: string): NostrEvent {
  return finalizeEvent(
    {
      kind: 1059,
      content: `not-nip44-${salt}`,
      tags: [["p", "ff".repeat(32)]],
      created_at: createdAt,
    },
    group.sk,
  );
}

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.concordSnapshots.clear();
  await db.concordKv.clear();
  _resetPlaneSweepForTests();
  _resetStreamAuthRegistry();
  _configureAuthWaitForTests(50);
  _configureSweepPagingForTests({
    pageLimit: 500,
    maxEvents: 15_000,
    wallPage: 10_000,
  });
  _configureSweepCadenceForTests({ fullSweepIntervalMs: 6 * 60 * 60_000 });
});

afterEach(async () => {
  pool?.close();
  pool = undefined;
  await relay?.close();
  relay = undefined;
});

describe("sweepControl", () => {
  it("decrypts a plane and stores the rumors, not the wraps", async () => {
    const events = [controlWrap(1_700_000_100, "general")];
    relay = await startMockRelay({ kind: "paged", events });
    pool = new RelayPool();

    const c = community([relay.url]);
    const fresh = await sweepControl(c, group, { pool });
    expect(fresh).toHaveLength(1);

    const stored = await queryPlane(c.idHex, "control");
    expect(stored).toHaveLength(1);
    expect(JSON.parse(stored[0].content).name).toBe("general");
    // The wrap is gone: the store holds the rumor its author signed.
    expect(stored[0].kind).toBe(KIND_CONTROL);
  });

  it("records the relay as reached and not truncated", async () => {
    relay = await startMockRelay({ kind: "paged", events: [] });
    pool = new RelayPool();
    const c = community([relay.url]);

    await sweepControl(c, group, { pool });
    expect(controlSweepReach(c)).toEqual({ reached: 1, total: 1 });
    expect(controlSweepTruncated(c)).toBe(false);
  });

  it("does NOT record a refusing relay as reached", async () => {
    // The distinction the whole design rests on: a gated plane is not an empty
    // one, and treating it as one would let a floor stand over a plane we never
    // read.
    relay = await startMockRelay({ kind: "auth-required" });
    pool = new RelayPool();
    const c = community([relay.url]);

    await sweepControl(c, group, { pool });
    expect(controlSweepReach(c)).toEqual({ reached: 0, total: 1 });
  });

  it("does not re-decrypt a wrap it has already stored", async () => {
    const events = [controlWrap(1_700_000_100, "general")];
    relay = await startMockRelay({ kind: "paged", events });
    pool = new RelayPool();
    const c = community([relay.url]);

    expect(await sweepControl(c, group, { pool })).toHaveLength(1);
    // Second sweep sees the same wrap and skips it — the memo, not the store.
    expect(await sweepControl(c, group, { pool })).toHaveLength(0);
    expect(await queryPlane(c.idHex, "control")).toHaveLength(1);
  });

  it("counts unreadable wraps on every sweep, not just the first", async () => {
    // A standing flood must keep reading as a flood. Tallying only fresh
    // arrivals would report it once and then zero forever — blind on exactly
    // the device that needs telling.
    const events = [junkWrap(1_700_000_100, "a"), junkWrap(1_700_000_101, "b")];
    relay = await startMockRelay({ kind: "paged", events });
    pool = new RelayPool();
    const c = community([relay.url]);

    await sweepControl(c, group, { pool });
    expect(controlSweepUnreadable(c)).toBe(2);
    await sweepControl(c, group, { pool });
    expect(controlSweepUnreadable(c)).toBe(2);
  });

  it("pages past the relay's per-filter limit", async () => {
    _configureSweepPagingForTests({ pageLimit: 2 });
    const events = [
      controlWrap(1_700_000_100, "a"),
      controlWrap(1_700_000_200, "b"),
      controlWrap(1_700_000_300, "c"),
      controlWrap(1_700_000_400, "d"),
      controlWrap(1_700_000_500, "e"),
    ];
    relay = await startMockRelay({ kind: "paged", events });
    pool = new RelayPool();
    const c = community([relay.url]);

    const fresh = await sweepControl(c, group, { pool });
    expect(fresh).toHaveLength(5);
    expect(await queryPlane(c.idHex, "control")).toHaveLength(5);
  });

  it("stops on its own event budget and reports truncated", async () => {
    _configureSweepPagingForTests({ pageLimit: 2, maxEvents: 2 });
    const events = [
      controlWrap(1_700_000_100, "a"),
      controlWrap(1_700_000_200, "b"),
      controlWrap(1_700_000_300, "c"),
      controlWrap(1_700_000_400, "d"),
    ];
    relay = await startMockRelay({ kind: "paged", events });
    pool = new RelayPool();
    const c = community([relay.url]);

    await sweepControl(c, group, { pool });
    expect(controlSweepTruncated(c)).toBe(true);
  });

  it("steps over a same-second wall instead of looping on it", async () => {
    // Every wrap at ONE timestamp, more than a page holds. `until` is
    // inclusive, so a naive pager re-asks the same block forever. The cheapest
    // way to stall a client, since created_at is the publisher's to choose.
    _configureSweepPagingForTests({ pageLimit: 2, wallPage: 4 });
    const events = [
      controlWrap(1_700_000_100, "a"),
      controlWrap(1_700_000_100, "b"),
      controlWrap(1_700_000_100, "c"),
      controlWrap(1_700_000_050, "older"),
    ];
    relay = await startMockRelay({ kind: "paged", events });
    pool = new RelayPool();
    const c = community([relay.url]);

    const fresh = await sweepControl(c, group, { pool });
    // It got past the wall and reached the older edition below it.
    expect(fresh).toHaveLength(4);
  });

  it("cannot prove a second was drained when the relay caps below the ask", async () => {
    // The credibility band: a relay capped at its own page size answers a
    // 10,000 request with that cap either way, so "the second holds exactly
    // this" is indistinguishable from "the relay will not serve more".
    _configureSweepPagingForTests({ pageLimit: 2, wallPage: 10 });
    const events = [
      controlWrap(1_700_000_100, "a"),
      controlWrap(1_700_000_100, "b"),
      controlWrap(1_700_000_100, "c"),
    ];
    relay = await startMockRelay({ kind: "paged", events, pageLimit: 2 });
    pool = new RelayPool();
    const c = community([relay.url]);

    await sweepControl(c, group, { pool });
    expect(controlSweepTruncated(c)).toBe(true);
  });

  it("a truncated full read establishes NO floor, so the next sweep re-reads whole", async () => {
    _configureSweepPagingForTests({ pageLimit: 2, maxEvents: 2 });
    const events = [
      controlWrap(1_700_000_100, "a"),
      controlWrap(1_700_000_200, "b"),
      controlWrap(1_700_000_300, "c"),
      controlWrap(1_700_000_400, "d"),
    ];
    relay = await startMockRelay({ kind: "paged", events });
    pool = new RelayPool();
    const c = community([relay.url]);

    await sweepControl(c, group, { pool });
    expect(controlSweepTruncated(c)).toBe(true);

    // Budget lifted: the re-read must reach the editions the first sweep never
    // got to. A floor set by the truncated read would have hidden them.
    _configureSweepPagingForTests({ maxEvents: 15_000 });
    await sweepControl(c, group, { pool });
    expect(await queryPlane(c.idHex, "control")).toHaveLength(4);
  });

  it("markControlPlaneStale forces the next sweep back to a full read", async () => {
    const events = [controlWrap(1_700_000_100, "a")];
    relay = await startMockRelay({ kind: "paged", events });
    pool = new RelayPool();
    const c = community([relay.url]);

    await sweepControl(c, group, { pool });
    const beforeReqs = relay.reqCount();
    // A delta sweep would ride a `since`; after this it must not.
    markControlPlaneStale(c);
    await sweepControl(c, group, { pool });
    expect(relay.reqCount()).toBeGreaterThan(beforeReqs);
  });

  it("a MID-FLIGHT markControlPlaneStale is not undone by the sweep it interrupts", async () => {
    // The fold's only escape hatch. A sweep in flight when the fold reports
    // `incomplete` must not write its stale floor back — doing so leaves the
    // next sweep on the delta path, and the below-floor edition the fold could
    // not account for (an unban published while offline) stays invisible until
    // the 6-hour age-out. Single-flight makes the overlap routine rather than
    // rare: a fold-triggered re-sweep JOINS the one already running.
    const events = [controlWrap(1_700_000_500, "recent")];
    // A SLOW relay, so the stale-mark provably lands mid-sweep. Firing it off a
    // bare setTimeout(0) is not enough: the round trip can finish first, and
    // then the sweep simply sees no floor and goes full on its own — the test
    // passes while testing nothing.
    relay = await startMockRelay({ kind: "paged", events, delayMs: 250 });
    pool = new RelayPool();
    const c = community([relay.url]);

    await sweepControl(c, group, { pool }); // establishes the floor
    events.push(controlWrap(1_600_000_000, "unban"));

    const inFlight = sweepControl(c, group, { pool });
    // After the sweep has read its floor, well before it writes one back.
    await new Promise((r) => setTimeout(r, 60));
    markControlPlaneStale(c);
    await inFlight;

    // The next sweep must be FULL and pick up the below-floor edition.
    await sweepControl(c, group, { pool });
    expect(await queryPlane(c.idHex, "control")).toHaveLength(2);
  });
});

describe("sweepControl on a NIP-42 gating relay", () => {
  it("retries behind the auth gate after a refusal and reads the plane", async () => {
    // The common path on grimoire's pool: the relay connects on the first REQ,
    // so the opening plane read races the challenge, is refused, and only the
    // retry — after the stream key answers — succeeds.
    _configureAuthWaitForTests(2_000);
    const events = [controlWrap(1_700_000_100, "general")];
    relay = await startMockRelay({ kind: "nip42-gated", events });
    pool = new RelayPool();
    const c = community([relay.url]);

    registerStreamKeys([{ pk: group.pk, sk: group.sk }], [relay.url]);
    // Stand in for the lifecycle wiring: authenticate as soon as a challenge
    // exists, concurrently with the sweep that is about to be refused.
    const relayHandle = pool.relay(relay.url);
    void (async () => {
      for (let i = 0; i < 100 && !relayHandle.challenge; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      await authenticateStreams(relayHandle);
    })();

    const fresh = await sweepControl(c, group, { pool });
    expect(fresh).toHaveLength(1);
    expect(controlSweepReach(c)).toEqual({ reached: 1, total: 1 });
  });

  it("gives up without hanging when the AUTHs are never answered", async () => {
    // An ADDRESS-ONLY control key (a split epoch, CORD-02 §2) can never answer.
    // The sweep must report the relay unreached rather than block on a gate
    // nothing will ever open.
    _configureAuthWaitForTests(100);
    relay = await startMockRelay({ kind: "nip42-gated", events: [] });
    pool = new RelayPool();
    const c = community([relay.url]);
    registerStreamKeys([{ pk: group.pk }], [relay.url]); // no secret

    const started = Date.now();
    await sweepControl(c, group, { pool });
    expect(controlSweepReach(c)).toEqual({ reached: 0, total: 1 });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
