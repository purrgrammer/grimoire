import { describe, it, expect, beforeEach } from "vitest";
import {
  observeNappletReadiness,
  isNappletReadyFor,
  waitForNappletReady,
  clearNappletReadiness,
  intentTopic,
  readyTopic,
} from "./napplet-readiness";

const W = "window-1";

describe("napplet readiness", () => {
  beforeEach(() => {
    clearNappletReadiness(W);
    clearNappletReadiness("other");
  });

  it("starts not ready", () => {
    expect(isNappletReadyFor(W, "profile", "open")).toBe(false);
  });

  it("counts a subscribe to the exact intent topic", () => {
    observeNappletReadiness(W, {
      type: "inc.subscribe",
      id: "1",
      topic: intentTopic("profile", "open"),
    });
    expect(isNappletReadyFor(W, "profile", "open")).toBe(true);
    // A listener for one action says nothing about another.
    expect(isNappletReadyFor(W, "profile", "edit")).toBe(false);
  });

  it("counts a ready announcement for every action of that archetype", () => {
    observeNappletReadiness(W, {
      type: "inc.emit",
      topic: readyTopic("profile"),
    });
    expect(isNappletReadyFor(W, "profile", "open")).toBe(true);
    expect(isNappletReadyFor(W, "profile", "edit")).toBe(true);
    expect(isNappletReadyFor(W, "note", "open")).toBe(false);
  });

  it("does not leak readiness between windows", () => {
    observeNappletReadiness(W, {
      type: "inc.subscribe",
      topic: "profile:open",
    });
    expect(isNappletReadyFor("other", "profile", "open")).toBe(false);
  });

  it("drops readiness on unsubscribe", () => {
    observeNappletReadiness(W, {
      type: "inc.subscribe",
      topic: "profile:open",
    });
    observeNappletReadiness(W, {
      type: "inc.unsubscribe",
      topic: "profile:open",
    });
    expect(isNappletReadyFor(W, "profile", "open")).toBe(false);
  });

  it("ignores unrelated envelopes", () => {
    observeNappletReadiness(W, { type: "shell.ready" });
    observeNappletReadiness(W, ["EVENT", "sub", {}]);
    observeNappletReadiness(W, null);
    observeNappletReadiness(W, "inc.subscribe");
    observeNappletReadiness(W, { type: "inc.emit", topic: "chatter" });
    observeNappletReadiness(W, { type: "inc.emit", topic: ":ready" });
    expect(isNappletReadyFor(W, "profile", "open")).toBe(false);
    expect(isNappletReadyFor(W, "", "open")).toBe(false);
  });

  it("resolves immediately when already ready", async () => {
    observeNappletReadiness(W, {
      type: "inc.subscribe",
      topic: "profile:open",
    });
    await expect(waitForNappletReady(W, "profile", "open", 0)).resolves.toBe(
      true,
    );
  });

  it("resolves when readiness arrives during the wait", async () => {
    const waiting = waitForNappletReady(W, "profile", "open", 5_000);
    observeNappletReadiness(W, {
      type: "inc.subscribe",
      topic: "profile:open",
    });
    await expect(waiting).resolves.toBe(true);
  });

  it("resolves false on timeout rather than hanging", async () => {
    await expect(waitForNappletReady(W, "profile", "open", 5)).resolves.toBe(
      false,
    );
  });

  it("is not woken by readiness for a different intent", async () => {
    const waiting = waitForNappletReady(W, "profile", "open", 25);
    observeNappletReadiness(W, { type: "inc.subscribe", topic: "note:open" });
    await expect(waiting).resolves.toBe(false);
  });

  it("forgets a window whose document is gone", () => {
    observeNappletReadiness(W, {
      type: "inc.subscribe",
      topic: "profile:open",
    });
    clearNappletReadiness(W);
    expect(isNappletReadyFor(W, "profile", "open")).toBe(false);
  });
});
