/**
 * The wire, against real relays.
 *
 * Everything here is a behaviour a green pipeline cannot demonstrate: a message
 * arriving on a subscription nobody re-issued, a round that dies without saying
 * so, a refusal that heals, a cursor that survives a restart. Each corresponds
 * to something armada found the hard way, and the flooding case corresponds to
 * something this repo already shipped.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import {
  bytesToHex,
  channelGroupKey,
  controlGroupKey,
  random32,
} from "@/lib/concord/derive";
import {
  KIND_CONTROL,
  KIND_MESSAGE,
  KIND_SEAL_ENCRYPTED,
  KIND_SEAL_PLAINTEXT,
  VSK_CHANNEL,
} from "@/lib/concord/kinds";
import {
  _configureAuthWaitForTests,
  _resetPlaneSweepForTests,
} from "@/lib/concord/plane-sync";
import { buildRumor, sealRumor, wrapSeal } from "@/lib/concord/stream";
import {
  _resetStreamAuthRegistry,
  registerStreamKeys,
} from "@/lib/concord/stream-auth";
import type { Channel } from "@/lib/concord/types";
import {
  _resetWireBusForTests,
  channelScope,
  controlScope,
  onWireScopes,
  parkScope,
  wireUpScope,
} from "@/lib/concord/wire-bus";
import { buildWireSpec, type WireSpec } from "@/lib/concord/wire-spec";
import { normalizeRelayURL } from "@/lib/relay-url";
import concordPool from "@/services/concord-relay-pool";
import {
  _resetPendingWrapsForTests,
  parkPendingWraps,
  queryChannelRumors,
  queryPlane,
} from "@/services/concord-rumor-store";
import { drainParkedWraps } from "@/services/concord-wire-ingest";
import {
  _configureWireForTests,
  _resetWireCursorsForTests,
  setWireSpec,
  stopWire,
} from "@/services/concord-wire";
import db from "@/services/db";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

// ── Fixtures ────────────────────────────────────────────────────────────────

const root = random32();
const communityId = random32();
const control = controlGroupKey(root, communityId, 0n);
const COMMUNITY = bytesToHex(communityId);

const channelId = random32();
const CHANNEL = bytesToHex(channelId);
const chatKey = channelGroupKey(root, channelId, 0n);

/** The one channel this member holds, at its current (only) epoch. */
const channel: Channel = {
  id: channelId,
  idHex: CHANNEL,
  name: "#general",
  isPrivate: false,
  streams: [{ epoch: 0n, group: chatKey }],
  current: { epoch: 0n, group: chatKey },
};

/** A real control edition: plaintext-sealed, wrapped, signed by the plane key. */
function controlWrap(name: string, createdAt: number): NostrEvent {
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
  return restamp(wrapSeal(seal, control), createdAt, control.sk);
}

/** A real chat message: encrypted seal, channel-bound, wrapped at the stream. */
async function chatWrap(text: string, createdAt: number): Promise<NostrEvent> {
  const author = generateSecretKey();
  const rumor = buildRumor({
    kind: KIND_MESSAGE,
    content: text,
    tags: [
      ["channel", CHANNEL],
      ["epoch", "0"],
    ],
    pubkey: getPublicKey(author),
    createdAtSecs: createdAt,
    ms: null,
  });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, chatKey, {
    signEvent: async (template) => finalizeEvent(template, author),
  });
  return restamp(wrapSeal(seal, chatKey), createdAt, chatKey.sk);
}

/** `wrapSeal` stamps from the clock; put the wrap where the test wants it. */
function restamp(
  wrapped: NostrEvent,
  createdAt: number,
  sk: Uint8Array,
): NostrEvent {
  return finalizeEvent(
    {
      kind: wrapped.kind,
      content: wrapped.content,
      tags: wrapped.tags,
      created_at: createdAt,
    },
    sk,
  );
}

function spec(
  relays: string[],
  over: { withChannel?: boolean } = {},
): WireSpec {
  return buildWireSpec({
    channels: over.withChannel
      ? [{ relays, channel, communityIdHex: COMMUNITY }]
      : [],
    control: [
      {
        relays,
        idHex: COMMUNITY,
        current: control,
        groups: [control],
        refounded: false,
      },
    ],
  });
}

// ── Harness ─────────────────────────────────────────────────────────────────

const relays: MockRelay[] = [];

async function relay(...args: Parameters<typeof startMockRelay>) {
  const r = await startMockRelay(...args);
  relays.push(r);
  return r;
}

/** Collect bus rings for the duration of a test. */
function busLog(): string[] {
  const seen: string[] = [];
  onWireScopes((scopes) => seen.push(...scopes));
  return seen;
}

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll until `check` holds, and THROW if it never does.
 *
 * Deliberately not a silent give-up: a helper that returns on timeout turns
 * every assertion after it into "0 === 0", and a whole suite here passed
 * vacuously that way before the first bug was found.
 */
async function until(what: string, check: () => boolean, ms = 3_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() >= deadline)
      throw new Error(`timed out waiting for ${what}`);
    await tick(20);
  }
}

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.concordSnapshots.clear();
  await db.concordKv.clear();
  await db.concordPendingWraps.clear();
  await _resetWireCursorsForTests();
  _resetPlaneSweepForTests();
  _resetStreamAuthRegistry();
  _resetPendingWrapsForTests();
  _resetWireBusForTests();
  _configureAuthWaitForTests(50);
  // Watchdogs and backoff on a scale a test can wait out. The production values
  // are 30s / 90s / 5s.
  _configureWireForTests({
    silentMs: 400,
    quietMs: 600,
    tickMs: 50,
    backoffMinMs: 50,
    backoffMaxMs: 200,
  });
});

afterEach(async () => {
  stopWire();
  _resetWireBusForTests();
  for (const r of concordPool.relays.values()) concordPool.remove(r, true);
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

// ── Live delivery ───────────────────────────────────────────────────────────

describe("live delivery", () => {
  it("stores a control edition pushed AFTER eose, and rings its community", async () => {
    // The whole point of the phase. Nothing re-issued a REQ here: the relay
    // spoke first, on a subscription that was already open.
    const r = await relay({ kind: "normal" });
    const rings = busLog();
    setWireSpec(spec([r.url]));

    await until("the first REQ", () => r.reqCount() > 0);
    r.push(controlWrap("general", Math.floor(Date.now() / 1000)));

    await until("a control ring", () =>
      rings.includes(controlScope(COMMUNITY)),
    );
    expect(rings).toContain(controlScope(COMMUNITY));
    expect(await queryPlane(COMMUNITY, "control")).toHaveLength(1);
  });

  it("rings a relay's revival, which is what lets a queued send go", async () => {
    // Not `navigator.onLine`: a wrap is published over `relay.multiplex()`, and
    // on a gating relay only the round holding this socket has settled the
    // stream AUTH that makes the wrap acceptable. So the outbox waits for THIS
    // — a round that is answering — and nothing weaker.
    const r = await relay({ kind: "normal" });
    const rings = busLog();
    setWireSpec(spec([r.url]));

    await until("a wire-up ring", () =>
      rings.includes(wireUpScope(normalizeRelayURL(r.url))),
    );
  });

  it("stores a chat message pushed after eose, and rings its channel", async () => {
    const r = await relay({ kind: "normal" });
    const rings = busLog();
    setWireSpec(spec([r.url], { withChannel: true }));

    await until("the first REQ", () => r.reqCount() > 0);
    r.push(await chatWrap("hello from armada", Math.floor(Date.now() / 1000)));

    await until("a channel ring", () => rings.includes(channelScope(CHANNEL)));
    const rows = await queryChannelRumors(COMMUNITY, CHANNEL, { limit: 10 });
    expect(rows.map((row) => row.content)).toEqual(["hello from armada"]);
  });

  it("parks a wrap for a stream it holds no key for, and says so", async () => {
    // Ordinary rather than an error: a rekey not caught up with, a channel
    // granted moments ago. Dropping it would make the message recoverable only
    // by a backfill that may never run.
    const stranger = channelGroupKey(random32(), random32(), 0n);
    const r = await relay({ kind: "normal" });
    const rings = busLog();
    setWireSpec(spec([r.url]));
    await until("the first REQ", () => r.reqCount() > 0);

    const seal = finalizeEvent(
      {
        kind: KIND_SEAL_PLAINTEXT,
        content: "{}",
        tags: [],
        created_at: 1,
      },
      generateSecretKey(),
    );
    const orphan = wrapSeal(seal, stranger);
    r.push(orphan);

    await until("a park ring", () => rings.includes(parkScope(stranger.pk)));
    expect(await db.concordPendingWraps.count()).toBe(1);
  });
});

describe("the parked-wrap drain", () => {
  it("acks ONLY the wraps whose rumors reached the store", async () => {
    // The loss-proof invariant. A wrap that could not be opened — a key we
    // still do not hold, a retired epoch's cutoff — must stay parked; acking it
    // here is the one way a notified message becomes locally destructible.
    const stranger = channelGroupKey(random32(), random32(), 0n);
    const at = Math.floor(Date.now() / 1000);

    // One openable control wrap and one we hold no key for, both parked.
    const mine = controlWrap("drained", at);
    const seal = finalizeEvent(
      { kind: KIND_SEAL_PLAINTEXT, content: "{}", tags: [], created_at: at },
      generateSecretKey(),
    );
    const theirs = restamp(wrapSeal(seal, stranger), at, stranger.sk);
    await parkPendingWraps([mine, theirs]);

    // The spec holds a key for the control address and none for the stranger.
    await drainParkedWraps(spec([]));

    const left = await db.concordPendingWraps.toArray();
    expect(left.map((w) => w.id)).toEqual([theirs.id]);
    expect(await queryPlane(COMMUNITY, "control")).toHaveLength(1);
  });

  it("leaves a wrap parked when the store refuses it", async () => {
    // A control wrap carrying a `channel` tag is refused by the plane fence
    // (CORD-02 §5) — it opens, but nothing is written. Acking on "we hold that
    // key" rather than on "it is in the store" would drop it here.
    const at = Math.floor(Date.now() / 1000);
    const author = generateSecretKey();
    const rumor = buildRumor({
      kind: KIND_CONTROL,
      content: "{}",
      tags: [
        ["vsk", VSK_CHANNEL],
        ["channel", CHANNEL],
      ],
      pubkey: getPublicKey(author),
      createdAtSecs: at,
      ms: null,
    });
    const seal = finalizeEvent(
      {
        kind: KIND_SEAL_PLAINTEXT,
        content: JSON.stringify(rumor),
        tags: [],
        created_at: at,
      },
      author,
    );
    const fenced = restamp(wrapSeal(seal, control), at, control.sk);
    await parkPendingWraps([fenced]);

    await drainParkedWraps(spec([]));

    expect(await db.concordPendingWraps.count()).toBe(1);
    expect(await queryPlane(COMMUNITY, "control")).toHaveLength(0);
  });
});

// ── The round loop ──────────────────────────────────────────────────────────

describe("the round loop", () => {
  it("re-REQs a relay that accepts the REQ and then says nothing", async () => {
    // A swallowed REQ — held behind a wedged AUTH exchange, or a half-open
    // socket — is indistinguishable from a quiet relay except by the clock.
    // Without the watchdog the subscription is dead until the app restarts.
    const r = await relay({ kind: "silent" });
    setWireSpec(spec([r.url]));

    await until("a second REQ", () => r.reqCount() >= 2, 4_000);
    expect(r.reqCount()).toBeGreaterThanOrEqual(2);
  });

  it("does not let a socket opening kill the round that opened it", async () => {
    // applesauce connects ON DEMAND, so a relay's `open$` fires moments after
    // the round that caused it — and again after every reconnect, because the
    // socket drops 30s past the last unsubscribe. Treating those as
    // relay-initiated reopens aborts the round each time.
    //
    // At the 60s backoff ceiling that becomes absorbing: sleep, socket closes,
    // next round reconnects, its own open kills it before it hears anything, so
    // it is never healthy enough to reset the backoff and the relay is
    // permanently deaf with nothing logged. Only an ESTABLISHED round may be
    // bumped.
    _configureWireForTests({ quietMs: 10_000, silentMs: 10_000 });
    const r = await relay({ kind: "normal" });
    setWireSpec(spec([r.url]));

    await until("the first REQ", () => r.reqCount() > 0);
    await tick(600);
    expect(r.reqCount()).toBe(1);
  });

  it("does not flood a relay that CLOSEs every round", async () => {
    // `resubscribe: true` retries a CLOSED with no delay and no count, which
    // measured >20k REQ/s here once. The backoff is what stands between the
    // wire and someone else's relay.
    const r = await relay({ kind: "close-after-eose" });
    setWireSpec(spec([r.url]));

    await tick(1_500);
    expect(r.reqCount()).toBeGreaterThan(1);
    expect(r.reqCount()).toBeLessThan(40);
  });

  it("does not flood a gating relay it can never authenticate to", async () => {
    // No stream keys are registered, so every round is refused forever. This is
    // the shape that matters: the wire must wait rather than re-REQ at
    // round-trip speed into someone else's relay. ~17k REQ/s was measured here
    // once, against a live third party.
    //
    // The backoff is turned OFF so this isolates the post-refusal auth wait.
    // With both in play the backoff alone holds the count down and the test
    // stops saying anything about the wait — which is how it read at first.
    _configureWireForTests({ backoffMinMs: 1, backoffMaxMs: 1 });
    _configureAuthWaitForTests(300);
    const r = await relay({ kind: "nip42-gated" });
    setWireSpec(spec([r.url]));

    await tick(1_500);
    expect(r.reqCount()).toBeGreaterThan(0);
    expect(r.reqCount()).toBeLessThan(12);
  });

  it("heals a refused round once the stream AUTH lands", async () => {
    // The common path on a gating relay: the socket connects on the first REQ,
    // so the REQ races the NIP-42 challenge and is refused. The retry must wait
    // for the AUTH to be ANSWERED, not fire straight back into the refusal.
    const r = await relay({ kind: "nip42-gated" });
    registerStreamKeys([control], [r.url]);
    const rings = busLog();
    setWireSpec(spec([r.url]));

    await until(
      "the stream AUTH",
      () => r.authedPubkeys().includes(control.pk),
      5_000,
    );
    await until("the re-issued REQ", () => r.reqCount() >= 2, 5_000);
    r.push(controlWrap("healed", Math.floor(Date.now() / 1000)));

    await until(
      "a control ring",
      () => rings.includes(controlScope(COMMUNITY)),
      5_000,
    );
    expect(await queryPlane(COMMUNITY, "control")).toHaveLength(1);
  });
});

// ── The per-relay diff ──────────────────────────────────────────────────────

describe("the per-relay diff", () => {
  it("leaves an unchanged relay's round alone when another relay's changes", async () => {
    // The inputs settle several times during startup. Restarting every relay on
    // each settle aborts catch-up replays mid-flight and re-auths every
    // subscription, most with identical filters.
    const stable = await relay({ kind: "normal" });
    const changing = await relay({ kind: "normal" });

    setWireSpec(
      buildWireSpec({
        channels: [],
        control: [
          {
            relays: [stable.url],
            idHex: COMMUNITY,
            current: control,
            groups: [control],
            refounded: false,
          },
        ],
      }),
    );
    await until("the stable relay's REQ", () => stable.reqCount() > 0);
    const before = stable.reqCount();

    // A second community appears on a DIFFERENT relay — nothing about the first
    // relay's filter set changed.
    setWireSpec(
      buildWireSpec({
        channels: [],
        control: [
          {
            relays: [stable.url],
            idHex: COMMUNITY,
            current: control,
            groups: [control],
            refounded: false,
          },
          {
            relays: [changing.url],
            idHex: bytesToHex(random32()),
            current: controlGroupKey(random32(), random32(), 0n),
            groups: [],
            refounded: false,
          },
        ],
      }),
    );
    await until("the new relay's REQ", () => changing.reqCount() > 0);

    expect(stable.reqCount()).toBe(before);
  });
});

// ── Cursors ─────────────────────────────────────────────────────────────────

describe("cursors", () => {
  it("opens the first round from the fresh lookback, not from the epoch", async () => {
    const r = await relay({ kind: "normal" });
    setWireSpec(spec([r.url]));
    await until("the first filter", () => r.reqFilters().length > 0);

    const now = Math.floor(Date.now() / 1000);
    const since = r.reqFilters()[0].since as number;
    // Five minutes. A live subscription is not how history is fetched.
    expect(since).toBeGreaterThan(now - 6 * 60);
    expect(since).toBeLessThanOrEqual(now);
  });

  it("resumes a later round from what it ingested, with an overlap", async () => {
    const r = await relay({ kind: "normal" });
    const rings = busLog();
    setWireSpec(spec([r.url]));
    await until("the first REQ", () => r.reqCount() > 0);

    const at = Math.floor(Date.now() / 1000);
    r.push(controlWrap("cursor", at));
    await until("a control ring", () =>
      rings.includes(controlScope(COMMUNITY)),
    );

    // Force a fresh round and read what it asked for.
    const before = r.reqFilters().length;
    await until("a rotated round", () => r.reqFilters().length > before, 4_000);
    const filters = r.reqFilters();
    const since = filters[filters.length - 1].since as number;
    // The cursor, minus the 60s skew overlap.
    expect(since).toBeGreaterThanOrEqual(at - 61);
    expect(since).toBeLessThanOrEqual(at);
  });

  it("refuses to be dragged past the local clock", async () => {
    // One wrap stamped in the future — a skewed clock, or a hostile timestamp —
    // would otherwise push the DURABLE cursor beyond `now`. Every later REQ
    // then opens with `since > now` and this relay goes deaf permanently, while
    // everyone else's correctly-stamped messages simply stop matching.
    const r = await relay({ kind: "normal" });
    const rings = busLog();
    setWireSpec(spec([r.url]));
    await until("the first REQ", () => r.reqCount() > 0);

    const now = Math.floor(Date.now() / 1000);
    r.push(controlWrap("from the future", now + 86_400));
    await until("a control ring", () =>
      rings.includes(controlScope(COMMUNITY)),
    );

    const before = r.reqFilters().length;
    await until("a rotated round", () => r.reqFilters().length > before, 4_000);
    const filters = r.reqFilters();
    const since = filters[filters.length - 1].since as number;
    expect(since).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it("persists the cursor, so a warm start does not replay the backlog", async () => {
    const r = await relay({ kind: "normal" });
    const rings = busLog();
    const wireSpec = spec([r.url]);
    setWireSpec(wireSpec);
    await until("the first REQ", () => r.reqCount() > 0);

    const at = Math.floor(Date.now() / 1000);
    r.push(controlWrap("warm", at));
    await until("a control ring", () =>
      rings.includes(controlScope(COMMUNITY)),
    );

    // Durable, so a reload resumes where it left off. Reading an unwarmed cache
    // would resume from the fresh lookback and re-ingest the backlog on every
    // launch — which is why the loop waits for it before its first REQ.
    stopWire();
    const row = await db.concordKv.get(`wire-cursor:${wireSpec.subs[0].relay}`);
    expect(row?.value).toBe(at);
  });
});
