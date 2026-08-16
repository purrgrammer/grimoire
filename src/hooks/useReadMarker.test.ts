/**
 * The read-before-write sequencing, driven through `renderHook`.
 *
 * The bug this exists for is invisible from calling the pieces directly: if the
 * mark ever lands before the pre-visit stamp has been captured, the divider is
 * measured against a stamp the visit itself just moved, and the reader is told
 * nothing is new. That is effect ORDER, and only a render can show it — the
 * same reason `useConcordDissolved.test.ts` exists.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation, Message } from "@/types/chat";
import { useReadMarker } from "./useReadMarker";

const ME = "11".repeat(32);
const THEM = "22".repeat(32);

function conversation(id: string): Conversation {
  return {
    id,
    type: "group",
    protocol: "concord",
    title: id,
    participants: [],
    unreadCount: 0,
  } as Conversation;
}

function message(id: string, timestamp: number, author = THEM): Message {
  return {
    id,
    conversationId: "c",
    author,
    content: id,
    timestamp,
    type: "user",
    protocol: "concord",
    event: {} as Message["event"],
  };
}

/** An adapter that records the order its read-state methods were called in. */
function stub(lastReads: Record<string, number> = {}) {
  const calls: string[] = [];
  const marks: Array<{ id: string; at: number }> = [];
  const adapter = {
    getLastRead: vi.fn(async (c: Conversation) => {
      calls.push("read");
      // A real Dexie read is not synchronous; a same-tick resolve would hide
      // exactly the race this file is about.
      await new Promise((r) => setTimeout(r, 5));
      return lastReads[c.id] ?? 0;
    }),
    markRead: vi.fn(async (c: Conversation, at: number) => {
      calls.push("mark");
      marks.push({ id: c.id, at });
    }),
  } as unknown as ChatProtocolAdapter;
  return { adapter, calls, marks };
}

function visibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  visibility("visible");
});

describe("useReadMarker", () => {
  it("captures the stamp before it moves it", async () => {
    const { adapter, calls } = stub({ c: 20 });
    renderHook(() =>
      useReadMarker(adapter, conversation("c"), [message("a", 30)], ME),
    );
    await waitFor(() => expect(calls).toContain("mark"));
    expect(calls[0]).toBe("read");
  });

  it("puts the divider at the first message the reader has not seen", async () => {
    const { adapter } = stub({ c: 20 });
    const { result } = renderHook(() =>
      useReadMarker(
        adapter,
        conversation("c"),
        [message("a", 10), message("b", 30), message("c", 40)],
        ME,
      ),
    );
    await waitFor(() => expect(result.current).toBe("b"));
  });

  it("keeps the divider after the stamp has been moved past it", async () => {
    // The divider is measured against the stamp as it was on ARRIVAL. Re-reading
    // it after the mark would erase the line the reader is looking for.
    const { adapter, marks } = stub({ c: 20 });
    const { result } = renderHook(() =>
      useReadMarker(adapter, conversation("c"), [message("b", 30)], ME),
    );
    await waitFor(() => expect(marks.length).toBeGreaterThan(0));
    expect(marks[0].at).toBe(30);
    expect(result.current).toBe("b");
  });

  it("still finds a divider when the first emission had no candidate", async () => {
    // Concord paints from the local store and backfills afterwards, so an
    // emission that predates the unread window is ordinary rather than final.
    const { adapter } = stub({ c: 20 });
    const { result, rerender } = renderHook(
      ({ messages }: { messages: Message[] }) =>
        useReadMarker(adapter, conversation("c"), messages, ME),
      { initialProps: { messages: [message("a", 10)] } },
    );
    await waitFor(() => expect(adapter.getLastRead).toHaveBeenCalled());
    expect(result.current).toBe(undefined);

    rerender({ messages: [message("a", 10), message("b", 30)] });
    await waitFor(() => expect(result.current).toBe("b"));
  });

  it("does not wear one conversation's divider over another's messages", async () => {
    const { adapter } = stub({ first: 20, second: 0 });
    const { result, rerender } = renderHook(
      ({ id, messages }: { id: string; messages: Message[] }) =>
        useReadMarker(adapter, conversation(id), messages, ME),
      { initialProps: { id: "first", messages: [message("b", 30)] } },
    );
    await waitFor(() => expect(result.current).toBe("b"));

    // The second channel has never been read, so it gets no divider at all —
    // and must not inherit the first one's while its own stamp is in flight.
    rerender({ id: "second", messages: [message("z", 30)] });
    expect(result.current).toBe(undefined);
    await waitFor(() => expect(adapter.getLastRead).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(undefined);
  });

  it("does not mark a channel read in a hidden window", async () => {
    visibility("hidden");
    const { adapter, calls } = stub({ c: 20 });
    renderHook(() =>
      useReadMarker(adapter, conversation("c"), [message("a", 30)], ME),
    );
    await waitFor(() => expect(calls).toContain("read"));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).not.toContain("mark");
  });

  it("marks it the moment the window becomes visible again", async () => {
    visibility("hidden");
    const { adapter, calls } = stub({ c: 20 });
    renderHook(() =>
      useReadMarker(adapter, conversation("c"), [message("a", 30)], ME),
    );
    await waitFor(() => expect(calls).toContain("read"));

    visibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(calls).toContain("mark"));
  });

  it("does nothing for an adapter with no read state", async () => {
    const bare = {} as ChatProtocolAdapter;
    const { result } = renderHook(() =>
      useReadMarker(bare, conversation("c"), [message("a", 30)], ME),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(undefined);
  });
});
