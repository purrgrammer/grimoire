// @vitest-environment happy-dom
/**
 * The bug this file exists for: a REQ window re-issued EVERY relay's REQ each
 * time relay selection was revised.
 *
 * Selection is revised repeatedly after mount — `$contacts` watches hundreds of
 * pubkeys whose kind:10002s trickle in over several seconds, and the kind-10006
 * blocked list lands after startup too. The subscribe effect was keyed on the
 * whole relay array, so one relay joining or leaving tore down and re-opened
 * every per-relay subscription. Measured on a real `$contacts` load: three full
 * re-subscribes, which relays see as REQ churn and the user sees as a feed that
 * will not settle.
 *
 * The invariant: a relay already subscribed keeps its in-flight REQ when the
 * relay SET changes. Only the delta is opened or closed. Nothing about that is
 * visible to the compiler, and no other test counts REQ frames.
 */

import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { EventStore } from "applesauce-core";
import { EventStoreProvider } from "applesauce-react/providers";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { useReqTimelineEnhanced } from "./useReqTimelineEnhanced";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";
import { setBlockedRelays } from "@/services/blocked-relays";

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

function wrapper(eventStore: EventStore) {
  return ({ children }: PropsWithChildren) =>
    createElement(EventStoreProvider, { eventStore }, children);
}

describe("useReqTimelineEnhanced relay-set changes", () => {
  it("keeps an existing relay's REQ when another relay joins", async () => {
    const a = await relay({ kind: "normal" });
    const b = await relay({ kind: "normal" });
    const eventStore = new EventStore();

    const { rerender } = renderHook(
      ({ urls }: { urls: string[] }) =>
        useReqTimelineEnhanced("test-req", { kinds: [1] }, urls, {
          stream: true,
        }),
      { initialProps: { urls: [a.url] }, wrapper: wrapper(eventStore) },
    );

    await waitFor(() => expect(a.reqCount()).toBe(1));

    // Relay selection revises: b joins, a stays.
    await act(async () => {
      rerender({ urls: [a.url, b.url] });
      await new Promise((res) => setTimeout(res, 300));
    });

    await waitFor(() => expect(b.reqCount()).toBe(1));

    // The point of the test: `a` was not torn down and re-issued.
    expect(a.reqCount()).toBe(1);
  });

  it("closes only the relay that left the set", async () => {
    const a = await relay({ kind: "normal" });
    const b = await relay({ kind: "normal" });
    const eventStore = new EventStore();

    const { rerender } = renderHook(
      ({ urls }: { urls: string[] }) =>
        useReqTimelineEnhanced("test-req-2", { kinds: [1] }, urls, {
          stream: true,
        }),
      {
        initialProps: { urls: [a.url, b.url] },
        wrapper: wrapper(eventStore),
      },
    );

    await waitFor(() => {
      expect(a.reqCount()).toBe(1);
      expect(b.reqCount()).toBe(1);
    });

    await act(async () => {
      rerender({ urls: [a.url] });
      await new Promise((res) => setTimeout(res, 300));
    });

    // `a` survived untouched; `b` was not re-issued on its way out.
    expect(a.reqCount()).toBe(1);
    expect(b.reqCount()).toBe(1);
  });

  it("re-issues every REQ when the FILTER changes", async () => {
    // The other half of the invariant: a different query is a different
    // question, and every relay has to be asked again.
    const a = await relay({ kind: "normal" });
    const eventStore = new EventStore();

    const { rerender } = renderHook(
      ({ kinds }: { kinds: number[] }) =>
        useReqTimelineEnhanced("test-req-3", { kinds }, [a.url], {
          stream: true,
        }),
      { initialProps: { kinds: [1] }, wrapper: wrapper(eventStore) },
    );

    await waitFor(() => expect(a.reqCount()).toBe(1));

    await act(async () => {
      rerender({ kinds: [7] });
      await new Promise((res) => setTimeout(res, 300));
    });

    await waitFor(() => expect(a.reqCount()).toBe(2));
  });
  it("stays EOSE'd when the relay set only SHRINKS", async () => {
    // The regression this guards, and the feature itself triggers it: blocking
    // a relay shrinks `activeRelays` in every mounted hook. The effect re-runs,
    // opens no new subscription, and an already-EOSE'd relay never re-emits
    // EOSE — so resetting `eoseReceived` unconditionally left every open window
    // reporting PARTIAL (or FAILED with no events) until the 15s deadline.
    const a = await relay({ kind: "normal" });
    const b = await relay({ kind: "normal" });
    const eventStore = new EventStore();

    const { result, rerender } = renderHook(
      ({ urls }: { urls: string[] }) =>
        useReqTimelineEnhanced("test-req-shrink", { kinds: [1] }, urls, {
          stream: true,
        }),
      {
        initialProps: { urls: [a.url, b.url] },
        wrapper: wrapper(eventStore),
      },
    );

    await waitFor(() => expect(result.current.eoseReceived).toBe(true));

    await act(async () => {
      rerender({ urls: [a.url] });
      await new Promise((res) => setTimeout(res, 500));
    });

    // Well inside the 15s deadline: nothing new was asked, so nothing is
    // outstanding, and the window must not claim to be waiting.
    expect(result.current.eoseReceived).toBe(true);
    expect(result.current.overallState.status).not.toBe("partial");
    expect(result.current.overallState.status).not.toBe("failed");
  });
});
