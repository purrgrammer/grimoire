import { beforeEach, describe, expect, it, vi } from "vitest";

import db from "@/services/db";

import {
  _resetGroupKeyMemoForTests,
  channelGroupKey,
  random32,
} from "./derive";
import {
  _flushGroupKeyPersistenceForTests,
  _resetGroupKeyPersistenceForTests,
  clearGroupKeyPersistence,
  initGroupKeyPersistence,
} from "./group-key-persist";

const KV_KEY = "concordGroupKeyMemo";

beforeEach(async () => {
  await db.concordKv.clear();
  _resetGroupKeyPersistenceForTests();
  _resetGroupKeyMemoForTests();
});

describe("group key persistence", () => {
  it("persists a derivation and hydrates it into a cold memo", async () => {
    const root = random32();
    const channel = random32();

    await initGroupKeyPersistence();
    const original = channelGroupKey(root, channel, 1n);
    void original.convKey; // force the lazy ECDH so `ck` is persisted too
    await _flushGroupKeyPersistenceForTests();

    const stored = await db.concordKv.get(KV_KEY);
    expect(Array.isArray(stored?.value)).toBe(true);
    expect((stored!.value as unknown[]).length).toBeGreaterThan(0);

    // Cold start: same inputs, no in-memory memo.
    _resetGroupKeyPersistenceForTests();
    _resetGroupKeyMemoForTests();
    await initGroupKeyPersistence();
    const rehydrated = channelGroupKey(root, channel, 1n);
    expect(rehydrated.pk).toBe(original.pk);
    expect(rehydrated.sk).toEqual(original.sk);
    expect(rehydrated.convKey).toEqual(original.convKey);
  });

  it("starts once however many times it is called", async () => {
    const spy = vi.spyOn(db.concordKv, "get");
    await Promise.all([
      initGroupKeyPersistence(),
      initGroupKeyPersistence(),
      initGroupKeyPersistence(),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("survives an unreadable cache — keys just re-derive", async () => {
    // A persisted entry can never go stale (Appendix A is frozen), only
    // unusable; the derivation must not depend on the cache being sound.
    await db.concordKv.put({ key: KV_KEY, value: "not-an-array" });
    await initGroupKeyPersistence();
    const root = random32();
    expect(channelGroupKey(root, random32(), 0n).pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("skips malformed persisted rows rather than trusting them", async () => {
    await db.concordKv.put({
      key: KV_KEY,
      value: [{ h: "zz", sk: "nope" }, null, 7],
    });
    await initGroupKeyPersistence();
    expect(channelGroupKey(random32(), random32(), 0n).pk).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("clears the persisted derivations", async () => {
    await initGroupKeyPersistence();
    channelGroupKey(random32(), random32(), 0n);
    await _flushGroupKeyPersistenceForTests();
    expect(await db.concordKv.get(KV_KEY)).toBeDefined();

    await clearGroupKeyPersistence();
    expect(await db.concordKv.get(KV_KEY)).toBeUndefined();
  });
});
