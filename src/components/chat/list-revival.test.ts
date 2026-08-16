import { describe, expect, it } from "vitest";

import { MAX_REVIVALS, shouldRevive } from "./list-revival";

describe("shouldRevive", () => {
  it("revives a list holding messages while rendering nothing", () => {
    expect(shouldRevive(0, 120, 0)).toBe(true);
  });

  it("leaves a list that is rendering alone", () => {
    expect(shouldRevive(14, 120, 0)).toBe(false);
  });

  it("leaves an empty conversation alone", () => {
    // No data is not a stuck list — it is a channel nobody has written in, and
    // remounting it would repaint the "No messages yet" pane forever.
    expect(shouldRevive(0, 0, 0)).toBe(false);
  });

  it("gives up rather than remounting forever", () => {
    expect(shouldRevive(0, 120, MAX_REVIVALS - 1)).toBe(true);
    expect(shouldRevive(0, 120, MAX_REVIVALS)).toBe(false);
  });
});
