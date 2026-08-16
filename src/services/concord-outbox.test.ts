/**
 * The outbox, drained.
 *
 * The cases that matter are the ones where "just try again" is wrong: a wrap
 * that was already accepted before the app died, a refusal no retry can fix,
 * and a rate limit that must stop the pass rather than burn every queued
 * message's budget against a closed door.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import { bytesToHex, channelGroupKey, random32 } from "@/lib/concord/derive";
import type { FoldedControl } from "@/lib/concord/control";
import { KIND_MESSAGE } from "@/lib/concord/kinds";
import type { Channel, Community } from "@/lib/concord/types";

const communityId = random32();
const idHex = bytesToHex(communityId);
const channelId = random32();
const channelIdHex = bytesToHex(channelId);
const root = random32();

const SK = vi.hoisted(() => new Uint8Array(32).fill(7));
const pubkey = getPublicKey(SK);

const published = vi.hoisted(() =>
  vi.fn(async () => ({ accepted: ["wss://x"], rejected: [] })),
);
const banned = vi.hoisted(() => new Set<string>());

vi.mock("@/services/concord-publish", () => ({ publishWrap: published }));
vi.mock("@/services/accounts", () => ({
  default: {
    active$: {
      value: {
        pubkey: getPublicKey(SK),
        signer: {
          signEvent: async (t: unknown) =>
            finalizeEvent(t as never, SK) as never,
        },
      },
    },
  },
}));

function community(): Community {
  return {
    id: communityId,
    idHex,
    owner: "aa".repeat(32),
    ownerSalt: random32(),
    root,
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays: ["wss://x"],
    name: "Test",
  };
}

function channel(): Channel {
  const group = channelGroupKey(root, channelId, 0n);
  return {
    id: channelId,
    idHex: channelIdHex,
    name: "general",
    isPrivate: false,
    streams: [{ epoch: 0n, group }],
    current: { epoch: 0n, group },
  };
}

function folded(): FoldedControl {
  return {
    roster: { roles: [], grants: [] },
    ownerHex: "aa".repeat(32),
    channels: new Map(),
    banned: new Set(banned),
    bannedAt: new Map(),
    heads: new Map(),
    incomplete: [],
  };
}

vi.mock("@/services/concord-channel-resolve", () => ({
  resolveChannel: async () => ({
    community: community(),
    channel: channel(),
    folded: folded(),
  }),
}));

const { drainOutbox, dueOutbox, enqueueOutbox, outboxForChannel, retryOutbox } =
  await import("./concord-outbox");
const { ConcordAdapter } = await import("@/lib/chat/adapters/concord-adapter");
const { writeChatRumors } = await import("@/services/concord-rumor-store");
const { default: db, OUTBOX_NEVER } = await import("@/services/db");

const { channelScope, onWireScopes } = await import("@/lib/concord/wire-bus");
const { SEND_BURST } = await import("@/lib/concord/send-rate-limit");

const NOW = 1_800_000_000;

/** Long enough for the bus's coalescing window to flush. */
const FLUSH_WAIT_MS = 80;

/** One queued message, as `sendMessage` would leave it behind. */
async function queue(over: Partial<Parameters<typeof enqueueOutbox>[0]> = {}) {
  return enqueueOutbox({
    pubkey,
    communityId: idHex,
    channel: channelIdHex,
    kind: KIND_MESSAGE,
    content: "hello",
    createdAt: NOW,
    ...over,
  });
}

beforeEach(async () => {
  await db.concordOutbox.clear();
  await db.concordRumors.clear();
  await db.concordKv.clear();
  published.mockClear();
  published.mockResolvedValue({ accepted: ["wss://x"], rejected: [] });
  banned.clear();
  const { _resetDissolutionForTests } =
    await import("@/services/concord-dissolution");
  await _resetDissolutionForTests();
  const { resetSendLimits } = await import("@/lib/concord/send-rate-limit");
  resetSendLimits();
});

describe("draining the outbox", () => {
  it("publishes a queued message, stores it, and drops the row", async () => {
    await queue();
    await drainOutbox(NOW);

    expect(published).toHaveBeenCalledTimes(1);
    expect(await db.concordOutbox.count()).toBe(0);
    const stored = await db.concordRumors.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe("hello");
  });

  it("keeps a refused message, with what the relay said and a backoff", async () => {
    published.mockRejectedValueOnce(
      new Error("No relay accepted the message."),
    );
    const row = await queue();
    await drainOutbox(NOW);

    const after = await db.concordOutbox.get(row.id);
    expect(after?.status).toBe("failed");
    expect(after?.lastError).toMatch(/no relay accepted/i);
    // Backed off rather than retried on the next ring, which on a dead relay
    // would be a publish loop for as long as the window stays open.
    expect(after?.nextAttemptAt).toBeGreaterThan(NOW);
    expect(await dueOutbox(pubkey, NOW)).toEqual([]);
    // And nothing reached the store: publish-first is intact.
    expect(await db.concordRumors.count()).toBe(0);
  });

  it("does not republish a wrap a previous attempt already landed", async () => {
    // The app died between the relay's OK and the row being dropped. The
    // accepted wrap came back round through the wire, so the rumor is in the
    // store — rebuilding would post a visible duplicate nothing can undo.
    const rumorId = "ab".repeat(32);
    await writeChatRumors(idHex, [
      {
        rumorId,
        author: pubkey,
        kind: KIND_MESSAGE,
        content: "hello",
        tags: [],
        ms: NOW * 1000,
        createdAt: NOW,
        channel: channelIdHex,
      },
    ]);
    const row = await queue();
    await db.concordOutbox.update(row.id, { lastAttemptRumorId: rumorId });

    await drainOutbox(NOW);

    expect(published).not.toHaveBeenCalled();
    expect(await db.concordOutbox.count()).toBe(0);
  });

  it("fails a reply for good once its parent is gone", async () => {
    // Grimoire re-resolves the parent at every attempt rather than preserving
    // armada's thread tags, so a parent deleted while the message waited is a
    // sentence rather than a reply pointing at nothing.
    const row = await queue({ replyToId: "cd".repeat(32) });
    await drainOutbox(NOW);

    const after = await db.concordOutbox.get(row.id);
    expect(after?.status).toBe("failed");
    expect(after?.lastError).toMatch(/replying to is gone/i);
    expect(after?.nextAttemptAt).toBe(OUTBOX_NEVER);
    expect(published).not.toHaveBeenCalled();
  });

  it("fails for good once the community has been dissolved", async () => {
    await db.concordKv.put({ key: `concord-dissolved:${idHex}`, value: 5_000 });
    const row = await queue();
    await drainOutbox(NOW);

    const after = await db.concordOutbox.get(row.id);
    expect(after?.lastError).toMatch(/dissolved/i);
    expect(after?.nextAttemptAt).toBe(OUTBOX_NEVER);
    expect(published).not.toHaveBeenCalled();
  });

  it("fails for good once the sender has been banned", async () => {
    banned.add(pubkey);
    const row = await queue();
    await drainOutbox(NOW);

    const after = await db.concordOutbox.get(row.id);
    expect(after?.lastError).toMatch(/banned/i);
    expect(after?.nextAttemptAt).toBe(OUTBOX_NEVER);
    expect(published).not.toHaveBeenCalled();
  });

  it("stops the whole pass when the rate limit refuses one", async () => {
    // The next row would be refused a millisecond later for the same reason,
    // and each refusal escalates the lockout — so a pass that kept going would
    // punish the queue for being long.
    const { consumeSend } = await import("@/lib/concord/send-rate-limit");
    for (let i = 0; i < 10; i++) consumeSend(idHex);

    const first = await queue({ createdAt: NOW - 2 });
    const second = await queue({ createdAt: NOW - 1 });
    await drainOutbox(NOW);

    expect(published).not.toHaveBeenCalled();
    expect(
      (await db.concordOutbox.get(first.id))?.nextAttemptAt,
    ).toBeGreaterThan(NOW);
    // Untouched: never attempted, so never marked.
    expect((await db.concordOutbox.get(second.id))?.status).toBe("sending");
  });

  it("does not spend the send budget on a row that is already dead", async () => {
    // Five gone-parent replies exhaust the burst if they pay on their way out,
    // and the sixth — a live message — is then refused and stops the pass. A
    // failing row must not be able to rate-limit a good one.
    for (let i = 0; i < SEND_BURST; i++) {
      await queue({ replyToId: "cd".repeat(32), createdAt: NOW - 10 + i });
    }
    await queue({ content: "still sendable", createdAt: NOW });

    await drainOutbox(NOW);
    expect(published).toHaveBeenCalledTimes(1);
    expect((await db.concordRumors.toArray())[0]?.content).toBe(
      "still sendable",
    );
  });

  it("rings the channel when a row dies, so the badge does not stay 'Sending'", async () => {
    // The row is on screen as pending. Nothing re-reads the outbox until the
    // doorbell rings, so without this the reader watches a message that has
    // already failed keep claiming to be on its way.
    banned.add(pubkey);
    // The bus coalesces globally, so let any earlier test's ring flush before
    // listening — otherwise it arrives here and the assertion passes for free.
    await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));
    const heard: string[] = [];
    const off = onWireScopes((scopes) => heard.push(...scopes));

    await queue();
    await drainOutbox(NOW);
    await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));
    off();

    expect(heard).toContain(channelScope(channelIdHex));
  });

  it("leaves a backed-off row alone until its time comes", async () => {
    const row = await queue();
    await db.concordOutbox.update(row.id, {
      status: "failed",
      nextAttemptAt: NOW + 60,
    });

    await drainOutbox(NOW);
    expect(published).not.toHaveBeenCalled();

    await drainOutbox(NOW + 61);
    expect(published).toHaveBeenCalledTimes(1);
  });

  it("takes a reader's Retry as permission to try a dead row again", async () => {
    const row = await queue();
    await db.concordOutbox.update(row.id, {
      status: "failed",
      nextAttemptAt: OUTBOX_NEVER,
    });
    expect(await dueOutbox(pubkey, NOW)).toEqual([]);

    await retryOutbox(row.id);
    await drainOutbox(NOW);
    expect(published).toHaveBeenCalledTimes(1);
  });
});

describe("reading the outbox", () => {
  it("answers with this account's rows in this channel, oldest first", async () => {
    await queue({ content: "second", createdAt: NOW });
    await queue({ content: "first", createdAt: NOW - 10 });
    await queue({ pubkey: "ff".repeat(32), content: "someone else's" });
    await queue({ channel: "ee".repeat(32), content: "another channel" });

    const rows = await outboxForChannel(idHex, channelIdHex, pubkey);
    expect(rows.map((r) => r.content)).toEqual(["first", "second"]);
  });
});

describe("a drain that fires while the adapter's own attempt is still open", () => {
  const conversation = {
    id: `${idHex}:${channelIdHex}`,
    type: "group",
    protocol: "concord",
    title: "general",
    participants: [],
    unreadCount: 0,
  } as unknown as import("@/types/chat").Conversation;

  it("does not send the same message twice", async () => {
    // The window is real: the adapter publishes the first attempt in the
    // background for up to the publish timeout, and a drain fires whenever a
    // relay round comes back or another row is retried. The queued row is due,
    // and the dedupe pre-check cannot help — the wrap has not been accepted
    // yet — so an unclaimed row is rebuilt under a NEW rumor id and published
    // a second time. Both copies land, and nothing afterwards can tell they
    // were one message.
    let accept: (() => void) | undefined;
    published.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          accept = () => resolve({ accepted: ["wss://x"], rejected: [] });
        }),
    );

    const adapter = new ConcordAdapter();
    await adapter.sendMessage(conversation, "exactly once");
    expect(published).toHaveBeenCalledTimes(1);

    await drainOutbox(NOW);
    expect(published).toHaveBeenCalledTimes(1);

    accept?.();
    await adapter._settleSends();
    expect(await db.concordRumors.count()).toBe(1);
    expect(await db.concordOutbox.count()).toBe(0);
  });
});
