import { describe, it, expect } from "vitest";
import { timelineState } from "./timeline-state";

const state = (
  messages: unknown[] | undefined,
  rows: number,
  painted: boolean,
) => timelineState({ messages, rows, painted });

describe("timelineState", () => {
  it("shows the list once there are rows and the pane has been measured", () => {
    expect(state([{}], 2, true)).toBe("list");
  });

  it("waits, rather than claiming empty, while the gate is still shut", () => {
    // The bug this exists for. A conversation with months of history read as
    // "No messages yet. Start the conversation!" whenever the container could
    // not be measured — a workspace off screen, a tile mid-split, a tab the
    // browser had stopped painting — with a live composer under it.
    expect(state([{}], 2, false)).toBe("waiting");
  });

  it("waits before the adapter has emitted at all", () => {
    // Adapters do not emit until EOSE, so undefined is "not yet", not "none".
    expect(state(undefined, 0, true)).toBe("waiting");
    expect(state(undefined, 0, false)).toBe("waiting");
  });

  it("says empty only for a timeline that arrived with nothing in it", () => {
    expect(state([], 0, true)).toBe("empty");
  });

  it("says empty even unpainted once the answer is known to be nothing", () => {
    // Nothing is being held back — there is no list to mount — so a spinner
    // here would never resolve.
    expect(state([], 0, false)).toBe("empty");
  });
});

it("does not call an auth-gated or timed-out empty read an empty conversation", () => {
  expect(
    timelineState({ messages: [], rows: 0, painted: true, incomplete: true }),
  ).toBe("incomplete");
  // Available history must still be rendered alongside the warning.
  expect(
    timelineState({ messages: [{}], rows: 1, painted: true, incomplete: true }),
  ).toBe("list");
});
