/**
 * The decision a jump makes between pages: look again, fetch more, or admit the
 * message is out of reach — and the walk that acts on it, which has a reader
 * changing channel underneath it to survive.
 */

// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VirtuosoHandle } from "react-virtuoso";

import {
  jumpLandingId,
  MAX_JUMP_PAGES,
  nextJumpAction,
  useJumpToMessage,
  type JumpTarget,
} from "./useJumpToMessage";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation, Message } from "@/types/chat";

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

  it("lands on the newest message for a date past the end of the channel", () => {
    // Picking today in a channel that last spoke yesterday is ordinary, and a
    // Go button that answers it by doing nothing reads as broken.
    expect(jumpLandingId(loaded, byDate(9_999))).toBe("d");
  });

  it("answers nothing for a date asked of an empty timeline", () => {
    expect(jumpLandingId([], byDate(9_999))).toBe(undefined);
  });
});

const PAGE = 50;

function conversation(id: string): Conversation {
  return {
    id,
    type: "group",
    protocol: "concord",
    title: id,
    participants: [],
    unreadCount: 0,
  } as unknown as Conversation;
}

/** Drive the walk with a page the test releases by hand. */
function walkHarness(page: Message[]) {
  const scrollToIndex = vi.fn();
  const virtuosoRef = {
    current: { scrollToIndex } as unknown as VirtuosoHandle,
  };
  let released = false;
  const waiting: Array<(page: Message[]) => void> = [];
  const loadMoreMessages = vi.fn(() =>
    released
      ? Promise.resolve(page)
      : new Promise<Message[]>((resolve) => waiting.push(resolve)),
  );
  const adapter = { loadMoreMessages } as unknown as ChatProtocolAdapter;
  return {
    scrollToIndex,
    virtuosoRef,
    adapter,
    loadMoreMessages,
    release: () => {
      released = true;
      for (const resolve of waiting.splice(0)) resolve(page);
    },
  };
}

describe("the walk itself", () => {
  it("stops when the reader opens another channel mid-page", async () => {
    // The walk reads the timeline through refs, which point at whatever the
    // viewer is rendering NOW. Without a scope check it would find the target
    // id in the channel the reader just opened and scroll THAT one.
    const here = messages(["b", 200], ["c", 300]);
    const elsewhere = messages(["a", 100], ["x", 150]);
    const harness = walkHarness(elsewhere);

    const { result, rerender } = renderHook(
      (props: { conv: Conversation; msgs: Message[] }) =>
        useJumpToMessage({
          adapter: harness.adapter,
          conversation: props.conv,
          messages: props.msgs,
          canPage: true,
          virtuosoRef: harness.virtuosoRef,
          indexOfMessage: (id) => props.msgs.findIndex((m) => m.id === id),
          pageSize: PAGE,
        }),
      { initialProps: { conv: conversation("A"), msgs: here } },
    );

    let walking: Promise<void> | undefined;
    act(() => {
      walking = result.current.jump({ kind: "id", id: "a" });
    });
    rerender({ conv: conversation("B"), msgs: elsewhere });
    harness.release();
    await act(async () => {
      await walking;
    });

    expect(harness.scrollToIndex).not.toHaveBeenCalled();
  });

  it("stops paging once a page stops widening the window", async () => {
    // Concord's page GROWS rather than slides, so it is never "short" — a walk
    // that only believed the page size would spend all ten pages before
    // admitting the message is out of reach.
    const here = messages(["b", 200], ["c", 300]);
    // A FULL page, so the page-size rule cannot be what stops the walk.
    const harness = walkHarness(
      messages(
        ...Array.from(
          { length: PAGE },
          (_, i) => [`z${i}`, 50] as [string, number],
        ),
      ),
    );

    const { result } = renderHook(() =>
      useJumpToMessage({
        adapter: harness.adapter,
        conversation: conversation("A"),
        // Never widens: the emitter answers with the same window.
        messages: here,
        canPage: true,
        virtuosoRef: harness.virtuosoRef,
        indexOfMessage: () => -1,
        pageSize: PAGE,
      }),
    );

    let walking: Promise<void> | undefined;
    act(() => {
      walking = result.current.jump({ kind: "id", id: "a" });
    });
    harness.release();
    await act(async () => {
      await walking;
    });

    expect(harness.loadMoreMessages).toHaveBeenCalledTimes(1);
  });
});
