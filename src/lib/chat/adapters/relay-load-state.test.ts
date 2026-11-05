import { afterEach, describe, expect, it, vi } from "vitest";
import { Nip29Adapter } from "./nip-29-adapter";
import { Nip53Adapter } from "./nip-53-adapter";
import pool from "@/services/relay-pool";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";
import type { Conversation, Message } from "@/types/chat";
import type { RelayLoadState } from "@/lib/relay-subscription";

const relays: MockRelay[] = [];
const adapters: Array<Nip29Adapter | Nip53Adapter> = [];
afterEach(async () => {
  for (const adapter of adapters.splice(0)) adapter.cleanupAll();
  pool.close();
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
});

describe.each(["nip-29", "nip-53"] as const)("%s read outcomes", (protocol) => {
  it("exposes auth-required alongside the released message gate", async () => {
    const relay = await startMockRelay({ kind: "auth-required" });
    relays.push(relay);
    const adapter =
      protocol === "nip-29" ? new Nip29Adapter() : new Nip53Adapter();
    adapters.push(adapter);
    const conversation = {
      id: `${protocol}:${relay.url}'group`,
      protocol,
      metadata: {
        groupId: "group",
        relayUrl: relay.url,
        activityAddress: { pubkey: "a".repeat(64), identifier: "live" },
      },
    } as Conversation;
    const states: RelayLoadState[] = [];
    const messages: Message[][] = [];
    const sub = adapter
      .loadMessages(conversation, {
        onStatus: (state) => states.push(state),
      })
      .subscribe((batch) => messages.push(batch));
    try {
      await vi.waitFor(() =>
        expect(states.at(-1)).toEqual({
          status: "partial",
          relays: { [`${relay.url}/`]: "auth-required" },
        }),
      );
      expect(messages.at(-1)).toEqual([]);
    } finally {
      sub.unsubscribe();
    }
  });
});
