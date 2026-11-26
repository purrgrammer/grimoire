// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import eventStore from "@/services/event-store";
import { useQuoteAuthors } from "./useQuoteAuthors";

const loads = vi.hoisted(
  () => new Map<string, { complete: () => void; pointer: unknown }>(),
);
vi.mock("@/services/loaders", async () => {
  const { Subject } = await import("rxjs");
  return {
    eventLoader: (pointer: { id: string }) => {
      const subject = new Subject<never>();
      loads.set(pointer.id, { complete: () => subject.complete(), pointer });
      return subject.asObservable();
    },
  };
});

const note = (sk: Uint8Array) =>
  finalizeEvent(
    { kind: 1, created_at: 1, tags: [], content: String(Math.random()) },
    sk,
  );

describe("useQuoteAuthors", () => {
  it("reports the signed author, and keeps it when the loader then finishes empty", async () => {
    const sk = generateSecretKey();
    const event = note(sk);
    const quotes = [{ id: event.id, relays: ["wss://hint.example.com/"] }];
    const { result } = renderHook(() => useQuoteAuthors(quotes));
    expect(result.current.get(event.id)).toEqual({ status: "pending" });
    // The hint is only where the loader looks.
    expect(loads.get(event.id)?.pointer).toEqual({
      id: event.id,
      relays: ["wss://hint.example.com/"],
      author: undefined,
    });

    await act(async () => {
      eventStore.add(event);
    });
    expect(result.current.get(event.id)).toEqual({
      status: "resolved",
      author: getPublicKey(sk),
    });
    await act(async () => loads.get(event.id)?.complete());
    expect(result.current.get(event.id).status).toBe("resolved");
  });

  it("never accepts an event whose signature does not verify", async () => {
    const forged = { ...note(generateSecretKey()), pubkey: "e".repeat(64) };
    const { result } = renderHook(() =>
      useQuoteAuthors([{ id: forged.id, relays: [] }]),
    );
    await act(async () => {
      eventStore.add(forged);
    });
    expect(result.current.get(forged.id)).toEqual({ status: "pending" });
    await act(async () => loads.get(forged.id)?.complete());
    expect(result.current.get(forged.id)).toEqual({ status: "not-found" });
    expect(result.current.authors.size).toBe(0);
  });
});
