/**
 * A publish that can only reach blocked relays must be reported undeliverable.
 *
 * The failure mode being pinned: `BlockingRelayPool.group()` drops blocked
 * relays before a socket opens, so `pool.publish([blocked])` resolves `[]`.
 * Reading `responses[0]` off that gives `undefined`, which the existing
 * else-branch reports as "Relay rejected event" — pointing anyone debugging it
 * at the relay instead of at their own blocked list. Worse, for a caller that
 * only checks `ok`, a fully blocked publish must not look like a success.
 */

import { describe, it, expect, afterEach } from "vitest";
import publishService from "./publish-service";
import { setBlockedRelays } from "./blocked-relays";
import { startMockRelay, fakeEvent, type MockRelay } from "@/test/mock-relay";

const OWNER = "a".repeat(64);
const relays: MockRelay[] = [];

async function relay(...args: Parameters<typeof startMockRelay>) {
  const r = await startMockRelay(...args);
  relays.push(r);
  return r;
}

afterEach(async () => {
  await Promise.all(relays.splice(0).map((r) => r.close()));
  setBlockedRelays([], null);
});

describe("publishService with blocked relays", () => {
  it("reports a blocked relay as undeliverable, naming the blocked list", async () => {
    const r = await relay({ kind: "normal" });
    setBlockedRelays([r.url], OWNER);

    const result = await publishService.publish(fakeEvent(), [r.url], {
      skipEventStore: true,
    });

    expect(result.ok).toBe(false);
    expect(result.successful).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toMatch(/blocked relays list/i);
    // Not the misleading default.
    expect(result.failed[0].error).not.toMatch(/rejected/i);
    // And nothing was sent.
    expect(r.accepted()).toEqual([]);
  });

  it("still succeeds on the relays that are not blocked", async () => {
    const allowed = await relay({ kind: "normal" });
    const blocked = await relay({ kind: "normal" });
    setBlockedRelays([blocked.url], OWNER);

    const result = await publishService.publish(
      fakeEvent(),
      [allowed.url, blocked.url],
      { skipEventStore: true },
    );

    expect(result.ok).toBe(true);
    expect(result.successful).toEqual([allowed.url]);
    expect(result.failed.map((f) => f.relay)).toEqual([blocked.url]);
    expect(blocked.accepted()).toEqual([]);
    expect(allowed.accepted()).toHaveLength(1);
  });
});
