// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import eventStore from "@/services/event-store";
import { useRecipientInboxes } from "./useRecipientInboxes";

type R = { status: "resolved"; relays: string[]; blocked: string[] };
const calls = vi.hoisted(
  () => [] as { pubkey: string; resolve: (r: R) => void }[],
);
vi.mock("@/services/relay-selection", () => ({
  resolveInboxRelays: (pubkey: string) =>
    new Promise<R>((resolve) => calls.push({ pubkey, resolve })),
}));

const resolved = (relays: string[]): R => ({
  status: "resolved",
  relays,
  blocked: [],
});

describe("useRecipientInboxes", () => {
  it("drops an older lookup's answer that lands after a newer one", async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const { result } = renderHook(() => useRecipientInboxes([pk]));
    expect(result.current.get(pk)).toEqual({ status: "pending" });
    expect(calls).toHaveLength(1);

    // A new relay list arrives: a second lookup starts.
    await act(async () => {
      eventStore.add(
        finalizeEvent(
          {
            kind: 10002,
            created_at: 1000,
            tags: [["r", "wss://n.example.com"]],
            content: "",
          },
          sk,
        ),
      );
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(calls).toHaveLength(2);

    await act(async () =>
      calls[1].resolve(resolved(["wss://new.example.com/"])),
    );
    await act(async () =>
      calls[0].resolve(resolved(["wss://old.example.com/"])),
    );
    expect(result.current.get(pk)).toEqual(
      resolved(["wss://new.example.com/"]),
    );
  });

  it("settle() returns at the deadline with what is known", async () => {
    calls.length = 0;
    const pk = "c".repeat(64);
    const { result } = renderHook(() => useRecipientInboxes([pk]));
    let settled: Map<string, unknown> | undefined;
    await act(async () => {
      settled = await result.current.settle([pk], 50);
    });
    expect(settled?.get(pk)).toEqual({ status: "pending" });
  });
});
