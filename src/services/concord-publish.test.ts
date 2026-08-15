/**
 * Publishing a Concord wrap.
 *
 * A member's relay set is routinely three relays where one is dead, so the
 * interesting cases are all about what "sent" means when they disagree.
 */

import { afterEach, describe, expect, it } from "vitest";
import { finalizeEvent } from "nostr-tools/pure";

import { channelGroupKey, random32 } from "@/lib/concord/derive";
import { KIND_WRAP } from "@/lib/concord/kinds";
import { planeRequest } from "@/lib/concord/plane-request";
import {
  _resetStreamAuthRegistry,
  authenticateStreams,
  registerStreamKeys,
} from "@/lib/concord/stream-auth";
import concordPool from "@/services/concord-relay-pool";
import { publishWrap } from "@/services/concord-publish";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

const group = channelGroupKey(random32(), random32(), 0n);

/** A wrap signed by the stream key, which is what a relay gates on. */
const wrap = () =>
  finalizeEvent(
    {
      kind: KIND_WRAP,
      content: "ciphertext",
      tags: [["p", "cc".repeat(32)]],
      created_at: Math.floor(Date.now() / 1000),
    },
    group.sk,
  );

const relays: MockRelay[] = [];

async function relay(...args: Parameters<typeof startMockRelay>) {
  const r = await startMockRelay(...args);
  relays.push(r);
  return r;
}

afterEach(async () => {
  _resetStreamAuthRegistry();
  for (const r of concordPool.relays.values()) concordPool.remove(r, true);
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

describe("publishWrap", () => {
  it("delivers to a relay that accepts", async () => {
    const r = await relay({ kind: "normal" });
    const event = wrap();

    const outcome = await publishWrap([r.url], event, 5_000);

    expect(outcome.accepted).toHaveLength(1);
    expect(r.accepted().map((e) => e.id)).toEqual([event.id]);
  });

  it("resolves on the FIRST ack, without waiting for a dead relay", async () => {
    // The case that makes a chat client feel broken: one dead relay in the set
    // holding every send open for the full timeout.
    const live = await relay({ kind: "normal" });
    const dead = await relay({ kind: "silent" });

    const started = Date.now();
    const outcome = await publishWrap([dead.url, live.url], wrap(), 10_000);

    expect(outcome.accepted).toEqual([expect.stringContaining("localhost")]);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("throws when every relay refuses, without waiting out the timeout", async () => {
    // All answered, none accepted — there is nothing left to wait for.
    const r = await relay({ kind: "auth-required" });

    const started = Date.now();
    await expect(publishWrap([r.url], wrap(), 10_000)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("gives up when EVERY relay stays silent, rather than hanging forever", async () => {
    // "Sending spins forever" is this: no relay answers at all, so nothing
    // resolves and nothing rejects. The dead-relay test above is satisfied by
    // the LIVE relay's ack, so it never exercised the all-silent case.
    const a = await relay({ kind: "silent" });
    const b = await relay({ kind: "silent" });

    const started = Date.now();
    await expect(publishWrap([a.url, b.url], wrap(), 1_500)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(6_000);
  }, 20_000);

  it("explains an auth refusal in words a sender can act on", async () => {
    const r = await relay({ kind: "auth-required" });
    await expect(publishWrap([r.url], wrap(), 5_000)).rejects.toThrow(
      /authenticating/,
    );
  });

  it("throws rather than silently succeeding with no relays", async () => {
    await expect(publishWrap([], wrap())).rejects.toThrow(/no relays/i);
  });

  it("is accepted by a gating relay once the stream AUTH has landed", async () => {
    // The write half of the NIP-42 story: a relay with kind 1059 in its
    // AUTH_KINDS gates the EVENT on the AUTHOR being authenticated, and the
    // author of a Concord wrap is the stream key — never the user. This is why
    // publishing has to go through the Concord pool, where those AUTHs live.
    const r = await relay({ kind: "nip42-gated" });
    registerStreamKeys([group], [r.url]);

    // The same wiring `concord-stream-auth.ts` installs in the app: answer the
    // challenge as the stream the moment it arrives.
    const socket = concordPool.relay(r.url);
    const watching = socket.challenge$.subscribe((challenge) => {
      if (challenge) void authenticateStreams(socket).catch(() => undefined);
    });
    // A plane READ opens the socket, exactly as the wire does in the app.
    // Publishing rides an already-live connection: `multiplex` connects the raw
    // socket but does not run applesauce's state machine, so `challenge$` is
    // only populated while something else holds the relay open. In the app the
    // wire's standing REQ is that something, and sending requires a Concord
    // window, which is what starts the wire.
    await planeRequest(r.url, { kinds: [KIND_WRAP] }, { pool: concordPool });
    const deadline = Date.now() + 3_000;
    while (!r.authedPubkeys().includes(group.pk) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    watching.unsubscribe();
    expect(r.authedPubkeys()).toContain(group.pk);

    const event = wrap();
    const outcome = await publishWrap([r.url], event, 3_000);
    expect(outcome.accepted).toHaveLength(1);
    expect(r.accepted().map((e) => e.id)).toContain(event.id);
  }, 10_000);

  it("keeps publishing on a socket that has already been refused once", async () => {
    // THE reason this module does not use `relay.event()`.
    //
    // applesauce wraps every non-AUTH publish in
    // `waitForAuth(authRequiredForPublish$, …)`. One `auth-required` OK arms
    // `receivedAuthRequiredForEvent`, and every later publish on that Relay
    // then hangs until `authenticated$` turns true — which never happens here,
    // because Concord answers NIP-42 as the STREAM (`relay.event(evt, "AUTH")`
    // never sets `authenticationResponse$`). The flag clears only when the
    // socket reopens, and the wire deliberately keeps it open, so ONE early
    // refusal would wedge sending for the whole session.
    //
    // Measured before the fix: the second publish's EVENT frame never reached
    // the relay at all. Swap `publishToRelay` back to `relay.event()` and this
    // goes red.
    const r = await relay({ kind: "nip42-gated" });
    registerStreamKeys([group], [r.url]);
    const socket = concordPool.relay(r.url);
    const watching = socket.challenge$.subscribe((challenge) => {
      if (challenge) void authenticateStreams(socket).catch(() => undefined);
    });

    // Refused: the socket opens on this publish, so the challenge has not been
    // answered yet. This is the frame that arms the flag.
    await expect(publishWrap([r.url], wrap(), 1_000)).rejects.toThrow();

    // The challenge arrives on the same socket and the stream answers it —
    // exactly what `concord-stream-auth.ts` does in the app.
    await planeRequest(r.url, { kinds: [KIND_WRAP] }, { pool: concordPool });
    const deadline = Date.now() + 3_000;
    while (!r.authedPubkeys().includes(group.pk) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    watching.unsubscribe();
    expect(r.authedPubkeys()).toContain(group.pk);

    // Same Relay instance, now authenticated. The retry must go out.
    const event = wrap();
    const outcome = await publishWrap([r.url], event, 3_000);
    expect(outcome.accepted).toHaveLength(1);
    expect(r.accepted().map((e) => e.id)).toContain(event.id);
  }, 15_000);

  it("is refused by a gating relay with no stream AUTH", async () => {
    const r = await relay({ kind: "nip42-gated" });
    await expect(publishWrap([r.url], wrap(), 5_000)).rejects.toThrow(
      /authenticating/,
    );
  });
});
