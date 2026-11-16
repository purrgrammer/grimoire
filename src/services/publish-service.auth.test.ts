/**
 * A relay that refuses an EVENT with `OK false auth-required` and never sends
 * an AUTH challenge (#273).
 *
 * applesauce retries the refused EVENT behind `waitForAuth`, which nothing can
 * satisfy without a challenge, and gives up at its 30s publish timeout with a
 * bare "Timeout". The publish has to say what actually happened, and not make
 * the user wait half a minute to hear it.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  type EventTemplate,
} from "nostr-tools/pure";
import { normalizeURL } from "applesauce-core/helpers";
import pool from "./relay-pool";
import publishService, {
  AUTH_NO_CHALLENGE_ERROR,
  isAuthRequiredPublishError,
} from "./publish-service";
import { startMockRelay, fakeEvent, type MockRelay } from "@/test/mock-relay";

const relays: MockRelay[] = [];

afterEach(async () => {
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

describe("publishService with an auth-required relay", () => {
  it("reports auth-required without a challenge, well before the 30s timeout", async () => {
    const auth = await startMockRelay({ kind: "auth-required" });
    const ok = await startMockRelay({ kind: "normal" });
    relays.push(auth, ok);

    const started = Date.now();
    const result = await publishService.publish(
      fakeEvent(),
      [auth.url, ok.url],
      { skipEventStore: true },
    );

    expect(Date.now() - started).toBeLessThan(8_000);
    expect(result.successful).toEqual([ok.url]);
    expect(result.failed).toEqual([
      { relay: auth.url, error: AUTH_NO_CHALLENGE_ERROR },
    ]);
    expect(isAuthRequiredPublishError(result.failed[0].error)).toBe(true);
    expect(auth.accepted()).toEqual([]);
  }, 15_000);

  it("does not cut short a valid authentication that takes longer than the grace period", async () => {
    // nip42-gated sends its challenge on connect and refuses EVENTs from an
    // unauthenticated author — the normal NIP-42 shape. A challenge exists,
    // so the no-challenge fast-fail must stay out of the way while a slow
    // signer (a bunker, a hardware key) takes its time.
    const gated = await startMockRelay({ kind: "nip42-gated" });
    relays.push(gated);
    const key = generateSecretKey();
    const event = finalizeEvent(
      { kind: 1, created_at: 1, tags: [], content: "hi" },
      key,
    );

    const publishing = publishService.publish(event, [gated.url], {
      skipEventStore: true,
    });

    // Well past AUTH_CHALLENGE_GRACE_MS before the user's signer answers.
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    const relay = pool.relays.get(normalizeURL(gated.url));
    expect(relay?.challenge).toBeTruthy();
    await relay!.authenticate({
      signEvent: (template: EventTemplate) => finalizeEvent(template, key),
    });

    const result = await publishing;
    expect(result.failed).toEqual([]);
    expect(result.successful).toEqual([gated.url]);
    expect(gated.accepted().map((e) => e.id)).toEqual([event.id]);
  }, 20_000);

  it("leaves ordinary rejections alone", () => {
    expect(isAuthRequiredPublishError("blocked: spam")).toBe(false);
    expect(isAuthRequiredPublishError(undefined)).toBe(false);
  });
});
