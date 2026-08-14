import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetWireBusForTests,
  channelScope,
  controlScope,
  emitWireScopes,
  onWireScope,
  onWireScopes,
  parkScope,
} from "./wire-bus";

describe("wire bus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetWireBusForTests();
  });
  afterEach(() => {
    _resetWireBusForTests();
    vi.useRealTimers();
  });

  it("names each scope the way armada spells it", () => {
    expect(channelScope("ab".repeat(32))).toBe(`c2:${"ab".repeat(32)}`);
    expect(controlScope("cd".repeat(32))).toBe(`c2ctl:${"cd".repeat(32)}`);
    expect(parkScope("ef".repeat(32))).toBe(`c2park:${"ef".repeat(32)}`);
  });

  it("coalesces a burst into ONE notification", () => {
    const seen: Array<ReadonlySet<string>> = [];
    onWireScopes((scopes) => seen.push(new Set(scopes)));

    // A catch-up replay writing a page of rumors: many emits, one ring. Without
    // the window each write re-reads the store and re-renders the timeline.
    for (let i = 0; i < 200; i++) emitWireScopes([channelScope("a")]);
    emitWireScopes([channelScope("b")]);
    expect(seen).toHaveLength(0);

    vi.advanceTimersByTime(50);
    expect(seen).toHaveLength(1);
    expect([...seen[0]].sort()).toEqual(["c2:a", "c2:b"]);
  });

  it("starts a fresh batch after a flush", () => {
    const seen: Array<ReadonlySet<string>> = [];
    onWireScopes((scopes) => seen.push(new Set(scopes)));

    emitWireScopes([channelScope("a")]);
    vi.advanceTimersByTime(50);
    emitWireScopes([channelScope("b")]);
    vi.advanceTimersByTime(50);

    expect(seen.map((s) => [...s])).toEqual([["c2:a"], ["c2:b"]]);
  });

  it("keeps ringing the other listeners when one throws", () => {
    // A listener is a React re-read trigger. One throwing component must not
    // silence live delivery for every other channel on screen.
    const quiet = vi.fn();
    onWireScopes(() => {
      throw new Error("boom");
    });
    onWireScopes(quiet);

    emitWireScopes([channelScope("a")]);
    vi.advanceTimersByTime(50);
    expect(quiet).toHaveBeenCalledTimes(1);
  });

  it("delivers a single-scope subscription only for its own scope", () => {
    const mine = vi.fn();
    onWireScope(channelScope("mine"), mine);

    emitWireScopes([channelScope("theirs")]);
    vi.advanceTimersByTime(50);
    expect(mine).not.toHaveBeenCalled();

    emitWireScopes([channelScope("theirs"), channelScope("mine")]);
    vi.advanceTimersByTime(50);
    expect(mine).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const off = onWireScope(channelScope("a"), listener);
    off();

    emitWireScopes([channelScope("a")]);
    vi.advanceTimersByTime(50);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not arm a timer for an empty emit", () => {
    const listener = vi.fn();
    onWireScopes(listener);
    emitWireScopes([]);
    vi.advanceTimersByTime(50);
    expect(listener).not.toHaveBeenCalled();
  });
});
