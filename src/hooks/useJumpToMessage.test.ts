/**
 * The decision a jump makes between pages: look again, fetch more, or admit the
 * message is out of reach.
 */

import { describe, expect, it } from "vitest";

import {
  jumpLandingId,
  MAX_JUMP_PAGES,
  nextJumpAction,
  type JumpTarget,
} from "./useJumpToMessage";
import type { Message } from "@/types/chat";

/** A timeline row, oldest first, as every adapter emits. */
function messages(...stamps: Array<[string, number]>): Message[] {
  return stamps.map(([id, timestamp]) => ({
    id,
    conversationId: "c",
    author: "aa",
    content: id,
    timestamp,
    protocol: "concord" as const,
    event: {} as Message["event"],
  }));
}

const byId = (id: string): JumpTarget => ({ kind: "id", id });
const byDate = (ts: number): JumpTarget => ({ kind: "date", ts });

const loaded = messages(["b", 200], ["c", 300], ["d", 400]);

describe("nextJumpAction", () => {
  it("lands immediately when the message is already loaded", () => {
    expect(
      nextJumpAction({ pagesUsed: 0, hasMore: true }, loaded, byId("c")),
    ).toBe("found");
  });

  it("pages when the message is older than the window", () => {
    expect(
      nextJumpAction({ pagesUsed: 0, hasMore: true }, loaded, byId("a")),
    ).toBe("page");
  });

  it("gives up once the history is exhausted", () => {
    // Not a failure: the message is sealed under an epoch this member cannot
    // read, or expired, or deeper than the relays still carry.
    expect(
      nextJumpAction({ pagesUsed: 3, hasMore: false }, loaded, byId("a")),
    ).toBe("give-up");
  });

  it("gives up at the page bound rather than walking forever", () => {
    expect(
      nextJumpAction(
        { pagesUsed: MAX_JUMP_PAGES, hasMore: true },
        loaded,
        byId("a"),
      ),
    ).toBe("give-up");
  });

  it("still pages on the last permitted page", () => {
    expect(
      nextJumpAction(
        { pagesUsed: MAX_JUMP_PAGES - 1, hasMore: true },
        loaded,
        byId("a"),
      ),
    ).toBe("page");
  });

  it("gives up on an empty timeline, which has nothing to page below", () => {
    expect(nextJumpAction({ pagesUsed: 0, hasMore: true }, [], byId("a"))).toBe(
      "give-up",
    );
  });

  it("reaches a date once the window starts at or before it", () => {
    expect(
      nextJumpAction({ pagesUsed: 0, hasMore: true }, loaded, byDate(250)),
    ).toBe("found");
    expect(
      nextJumpAction({ pagesUsed: 0, hasMore: true }, loaded, byDate(200)),
    ).toBe("found");
  });

  it("keeps paging for a date the window has not reached back to", () => {
    // The oldest loaded message is NEWER than the date asked for, so the first
    // row on or after it is not the real one — it is merely the first one
    // loaded, and landing there would silently show the wrong day.
    expect(
      nextJumpAction({ pagesUsed: 0, hasMore: true }, loaded, byDate(150)),
    ).toBe("page");
  });
});

describe("jumpLandingId", () => {
  it("lands on the message asked for", () => {
    expect(jumpLandingId(loaded, byId("c"))).toBe("c");
  });

  it("answers nothing for a message the window does not hold", () => {
    expect(jumpLandingId(loaded, byId("z"))).toBe(undefined);
  });

  it("lands on the first message of the day asked for", () => {
    expect(jumpLandingId(loaded, byDate(250))).toBe("c");
  });

  it("lands on a message dated exactly at the boundary", () => {
    expect(jumpLandingId(loaded, byDate(300))).toBe("c");
  });

  it("answers nothing for a date past the newest message", () => {
    expect(jumpLandingId(loaded, byDate(9_999))).toBe(undefined);
  });
});
