/**
 * The send path's two refusals: a ban, and a grave.
 *
 * The dissolution gate had no test at all, which is how the phase-6 TODO it
 * closes sat open — and it carries the one carve-out in CORD-02 §9, so getting
 * it wrong either seals a member out of erasing themselves or lets a dead
 * community keep accepting messages.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";

import { bytesToHex, channelGroupKey, random32 } from "@/lib/concord/derive";
import type { FoldedControl } from "@/lib/concord/control";
import { KIND_MESSAGE } from "@/lib/concord/kinds";
import { channelScope, emitWireScopes } from "@/lib/concord/wire-bus";
import type { Channel, Community } from "@/lib/concord/types";
import type { Conversation, Message } from "@/types/chat";

const communityId = random32();
const idHex = bytesToHex(communityId);
const channelId = random32();
const channelIdHex = bytesToHex(channelId);
const root = random32();

const SK = vi.hoisted(() => new Uint8Array(32).fill(9));
const pubkey = getPublicKey(SK);

const published = vi.hoisted(() =>
  vi.fn(async () => ({
    accepted: ["wss://x"],
    rejected: [],
  })),
);
const banned = vi.hoisted(() => new Set<string>());

const synced = vi.hoisted(() =>
  vi.fn(async (_c: unknown, _ch: unknown, opts?: { onFresh?: () => void }) => {
    opts?.onFresh?.();
  }),
);

vi.mock("@/services/concord-publish", () => ({ publishWrap: published }));
vi.mock("@/services/concord-channel-sync", () => ({ syncChannel: synced }));
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

const { ConcordAdapter } = await import("./concord-adapter");
const { writeChatRumors } = await import("@/services/concord-rumor-store");
const { default: db } = await import("@/services/db");

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

const conversation = {
  id: `${idHex}:${channelIdHex}`,
  type: "group",
  protocol: "concord",
  title: "general",
  participants: [],
  unreadCount: 0,
} as Conversation;

/** Stand in for the vault + fold reads, which are covered by their own tests. */
function adapter() {
  const a = new ConcordAdapter();
  (
    a as unknown as {
      resolve: () => Promise<{
        community: Community;
        channel: Channel;
        folded: FoldedControl;
      }>;
    }
  ).resolve = async () => ({
    community: community(),
    channel: channel(),
    folded: folded(),
  });
  return a;
}

const MINE = "11".repeat(32);

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.concordKv.clear();
  await db.concordOutbox.clear();
  published.mockClear();
  published.mockResolvedValue({ accepted: ["wss://x"], rejected: [] });
  synced.mockClear();
  banned.clear();
  const { _resetDissolutionForTests } =
    await import("@/services/concord-dissolution");
  await _resetDissolutionForTests();
  const { resetSendLimits } = await import("@/lib/concord/send-rate-limit");
  resetSendLimits();
});

/** Record the community as dissolved the way a real probe would. */
async function bury(ms: number): Promise<void> {
  await db.concordKv.put({ key: `concord-dissolved:${idHex}`, value: ms });
}

/** One of the viewer's own stored messages, so a self-delete has a target. */
async function myMessage(): Promise<string> {
  await writeChatRumors(idHex, [
    {
      rumorId: MINE,
      author: pubkey,
      kind: KIND_MESSAGE,
      content: "mine",
      tags: [],
      ms: 1000,
      createdAt: 1,
      channel: channelIdHex,
    },
  ]);
  return MINE;
}

describe("the dissolution gate on sending", () => {
  it("sends normally while the community is alive", async () => {
    const a = adapter();
    await a.sendMessage(conversation, "hello");
    await a._settleSends();
    expect(published).toHaveBeenCalledTimes(1);
  });

  it("refuses a message once the community is dissolved", async () => {
    await bury(5_000);
    await expect(adapter().sendMessage(conversation, "hello")).rejects.toThrow(
      /dissolved/i,
    );
    expect(published).not.toHaveBeenCalled();
  });

  it("still honors a member's delete of THEIR OWN message post-seal", async () => {
    // CORD-02 §9's one carve-out: a self-scrub cannot inject content, and a
    // departing member deserves to erase themselves.
    const id = await myMessage();
    await bury(5_000);
    await adapter().deleteMessage(conversation, id);
    expect(published).toHaveBeenCalledTimes(1);
  });

  it("does not let the carve-out reach someone ELSE's message", async () => {
    await writeChatRumors(idHex, [
      {
        rumorId: "22".repeat(32),
        author: "ff".repeat(32),
        kind: KIND_MESSAGE,
        content: "theirs",
        tags: [],
        ms: 1000,
        createdAt: 1,
        channel: channelIdHex,
      },
    ]);
    await bury(5_000);
    await expect(
      adapter().deleteMessage(conversation, "22".repeat(32)),
    ).rejects.toThrow(/your own/i);
    expect(published).not.toHaveBeenCalled();
  });

  it("refuses a banned author before anything is signed", async () => {
    banned.add(pubkey);
    await expect(adapter().sendMessage(conversation, "hello")).rejects.toThrow(
      /banned/i,
    );
    expect(published).not.toHaveBeenCalled();
  });
});

describe("mention p tags on an outgoing message", () => {
  const FRIEND = "ab".repeat(32);
  const npub = nip19.npubEncode(FRIEND);

  /** Every `p` tag on the rumor the send stored. */
  async function sentPTags(): Promise<string[]> {
    const rows = await db.concordRumors.toArray();
    const sent = rows.find((r) => r.pubkey === pubkey);
    return (sent?.tags ?? [])
      .filter((t) => t[0] === "p")
      .map((t) => t[1] ?? "");
  }

  it("names the person the message mentions", async () => {
    // The interop point: this is the tag an armada reader's mention badge and
    // notifier match on. It rides the sealed rumor, so no relay sees it.
    const a = adapter();
    await a.sendMessage(conversation, `hey nostr:${npub} look at this`);
    await a._settleSends();
    expect(await sentPTags()).toEqual([FRIEND]);
  });

  it("does not tag the sender for mentioning themselves", async () => {
    const mine = nip19.npubEncode(pubkey);
    const a = adapter();
    await a.sendMessage(conversation, `nostr:${mine} talking to myself`);
    await a._settleSends();
    expect(await sentPTags()).toEqual([]);
  });

  it("tags a replied-to author once, even when the reply also @-mentions them", async () => {
    // `buildConcordCommentTags` already p-tags the parent, so an unexcluded
    // extraction would double it — one tag, one person.
    const parent = "cd".repeat(32);
    await writeChatRumors(idHex, [
      {
        rumorId: parent,
        author: FRIEND,
        kind: KIND_MESSAGE,
        content: "theirs",
        tags: [],
        ms: 1000,
        createdAt: 1,
        channel: channelIdHex,
      },
    ]);
    const a = adapter();
    await a.sendMessage(conversation, `yes nostr:${npub}`, {
      replyTo: parent,
    });
    await a._settleSends();
    expect(await sentPTags()).toEqual([FRIEND]);
  });
});

describe("paging backwards", () => {
  /** One stored message per given second, authored by someone else. */
  async function seed(seconds: number[]): Promise<void> {
    await writeChatRumors(
      idHex,
      seconds.map((createdAt, i) => ({
        rumorId: (i + 1).toString(16).padStart(64, "0"),
        author: "ff".repeat(32),
        kind: KIND_MESSAGE,
        content: `m${i}`,
        tags: [],
        ms: createdAt * 1000,
        createdAt,
        channel: channelIdHex,
      })),
    );
  }

  /** Watch the standing emitter the way ChatViewer does. */
  function watch(a: ReturnType<typeof adapter>) {
    const seen: Message[][] = [];
    const sub = a.loadMessages(conversation).subscribe((m) => seen.push(m));
    return {
      seen,
      last: () => seen[seen.length - 1],
      stop: () => sub.unsubscribe(),
    };
  }

  it("widens the rendered window instead of re-reading the newest page", async () => {
    // The defect this covers: the store gained the history and the reader never
    // saw it, because every repaint re-read the newest 200 rows over the top.
    const seconds = Array.from({ length: 250 }, (_, i) => i + 1);
    await seed(seconds);
    const a = adapter();
    const feed = watch(a);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(200));

    const page = await a.loadMoreMessages(
      conversation,
      feed.last()[0].timestamp,
    );
    expect(page).toHaveLength(50);
    expect(page.every((m) => m.timestamp < 51)).toBe(true);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(250));
    // The page the caller wants may only exist on the wire, so the click has to
    // reach for it BELOW the oldest row on screen and repaint as it lands. What
    // that fetch actually returns is covered against a real relay in
    // `concord-adapter-backfill.test.ts`; this is the contract, not the effect.
    expect(synced).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ until: 51, onFresh: expect.any(Function) }),
    );
    feed.stop();
  });

  it("reports the end of the history once nothing older is left", async () => {
    // ChatViewer reads a short page as "stop offering the button", so the
    // second click has to come back short rather than repeat the first page.
    await seed(Array.from({ length: 250 }, (_, i) => i + 1));
    const a = adapter();
    const feed = watch(a);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(200));

    await a.loadMoreMessages(conversation, feed.last()[0].timestamp);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(250));
    const second = await a.loadMoreMessages(
      conversation,
      feed.last()[0].timestamp,
    );
    expect(second).toEqual([]);
    feed.stop();
  });

  it("counts the page strictly older than the boundary, and renders the ties anyway", async () => {
    // Inclusive here would hand back the row the caller already has and make
    // "is this the end" off by one. The same-second sibling it costs us is
    // absent from the COUNT only — the emitter still paints it.
    await seed([10, 10, 20]);
    const a = adapter();
    const feed = watch(a);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(3));

    expect(await a.loadMoreMessages(conversation, 10)).toEqual([]);
    expect(feed.last().filter((m) => m.timestamp === 10)).toHaveLength(2);
    feed.stop();
  });

  it("forgets the widened window when the conversation is torn down", async () => {
    await seed(Array.from({ length: 250 }, (_, i) => i + 1));
    const a = adapter();
    const feed = watch(a);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(200));
    await a.loadMoreMessages(conversation, feed.last()[0].timestamp);
    feed.stop();
    a.cleanup(conversation.id);

    const reopened = watch(a);
    await vi.waitFor(() => expect(reopened.last()).toHaveLength(200));
    reopened.stop();
  });

  it("never shrinks a timeline the opener asked to be wider than a page", async () => {
    // The repaints behind a click read with no options at all, so a window that
    // ignored the opener's own `limit` would answer the first "load older" with
    // FEWER messages than were already on screen.
    await seed(Array.from({ length: 600 }, (_, i) => i + 1));
    const a = adapter();
    const seen: Message[][] = [];
    const sub = a
      .loadMessages(conversation, { limit: 500 })
      .subscribe((m) => seen.push(m));
    // The deepest seed in this file — 600 rows read and folded twice. The
    // default one-second wait loses to it whenever the whole suite is running,
    // and the failure reads as `seen` being empty rather than as a timeout.
    const settle = { timeout: 15_000 };
    await vi.waitFor(
      () => expect(seen[seen.length - 1]).toHaveLength(500),
      settle,
    );

    await a.loadMoreMessages(conversation, seen[seen.length - 1][0].timestamp);
    await vi.waitFor(
      () => expect(seen[seen.length - 1]).toHaveLength(600),
      settle,
    );
    expect(seen.every((t) => t.length >= 500)).toBe(true);
    sub.unsubscribe();
    // The generous `settle` above raised the wrong dial: `vi.waitFor` can wait
    // 15s, but the TEST still ended at vitest's 5s default, which is what
    // actually fired under full-suite load. This is the binding one.
  }, 30_000);

  it("does not leave the window widened by a click that failed", async () => {
    // A failed click paints nothing, so a window left wide is pure cost: every
    // later doorbell ring re-reads and re-folds a page more than the reader can
    // see, for the rest of the session.
    await seed(Array.from({ length: 700 }, (_, i) => i + 1));
    const a = adapter();
    const feed = watch(a);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(200));

    synced.mockRejectedValueOnce(new Error("vault is locked"));
    await expect(
      a.loadMoreMessages(conversation, feed.last()[0].timestamp),
    ).rejects.toThrow(/vault/);
    expect(feed.last()).toHaveLength(200);

    // The retry is the FIRST page, not the second: one click, one page.
    await a.loadMoreMessages(conversation, feed.last()[0].timestamp);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(400));
    feed.stop();
  });
});

describe("the imeta tag for an attachment", () => {
  const base = {
    url: "https://blossom.example/abc",
    sha256: "cc".repeat(32),
    mimeType: "application/octet-stream",
    size: 1234,
  };

  it("publishes the AES-GCM params for an encrypted blob", async () => {
    // These are the ONLY copy: the blob on the host is ciphertext, and a
    // message that omits them is permanently unreadable by everyone including
    // its author.
    const { imetaTag } = await import("@/lib/chat/adapters/concord-adapter");
    const tag = imetaTag({
      ...base,
      originalMime: "image/png",
      encryption: {
        algorithm: "aes-gcm",
        key: "aa".repeat(32),
        nonce: "bb".repeat(16),
        ox: "dd".repeat(32),
      },
    });
    expect(tag[0]).toBe("imeta");
    expect(tag).toContain(`encryption-algorithm aes-gcm`);
    expect(tag).toContain(`decryption-key ${"aa".repeat(32)}`);
    expect(tag).toContain(`decryption-nonce ${"bb".repeat(16)}`);
    expect(tag).toContain(`ox ${"dd".repeat(32)}`);
    // The server's `m` describes the CIPHERTEXT; the plaintext's own type is
    // what tells a reader what it is about to render.
    expect(tag).toContain("m image/png");
  });

  it("says nothing about encryption for a plain blob", async () => {
    const { imetaTag } = await import("@/lib/chat/adapters/concord-adapter");
    const tag = imetaTag({ ...base, mimeType: "image/png" });
    expect(tag.some((f) => f.startsWith("decryption-"))).toBe(false);
    expect(tag).toContain("m image/png");
  });
});

describe("unread state", () => {
  const THEM = "ff".repeat(32);
  const BANNED = "ee".repeat(32);
  const NOW = () => Math.floor(Date.now() / 1000);

  let seq = 0;
  /** Stored messages, from whoever, at whenever — one write per call. */
  async function post(
    rows: Array<{ at: number; author?: string; tags?: string[][] }>,
  ): Promise<void> {
    await writeChatRumors(
      idHex,
      rows.map((row) => {
        seq += 1;
        return {
          rumorId: (seq + 0x1000).toString(16).padStart(64, "0"),
          author: row.author ?? THEM,
          kind: KIND_MESSAGE,
          content: `m${seq}`,
          tags: row.tags ?? [],
          ms: row.at * 1000,
          createdAt: row.at,
          channel: channelIdHex,
        };
      }),
    );
  }

  const countFor = async (a: ReturnType<typeof adapter>) =>
    (await a.resolveConversation(identifier())).unreadCount;

  const identifier = () =>
    ({
      type: "concord",
      communityId: idHex,
      channelId: channelIdHex,
    }) as never;

  beforeEach(async () => {
    await db.chatReads.clear();
    seq = 0;
  });

  it("reports what has arrived since the last visit, and nothing after a mark", async () => {
    const a = adapter();
    await post([{ at: NOW() - 300 }, { at: NOW() - 200 }]);
    expect(await countFor(a)).toBe(2);

    await a.markRead(conversation, NOW() - 200);
    expect(await countFor(a)).toBe(0);
    expect(await a.getLastRead(conversation)).toBe(NOW() - 200);
  });

  it("never counts the reader's own messages", async () => {
    const a = adapter();
    await post([
      { at: NOW() - 300, author: pubkey },
      { at: NOW() - 200, author: pubkey },
    ]);
    expect(await countFor(a)).toBe(0);
  });

  it("clears a badge whose newest rows the timeline never showed", async () => {
    // The stuck badge. A member is banned after posting; the fold drops their
    // messages, so the newest row ChatViewer can offer is OLDER than the newest
    // row in Dexie. Stamping what the reader saw would leave the count lit with
    // nothing to click.
    const a = adapter();
    banned.add(BANNED);
    await post([{ at: NOW() - 300 }, { at: NOW() - 100, author: BANNED }]);
    // The snapshot has the fold in hand, so the hidden row does not badge…
    expect(await countFor(a)).toBe(1);

    // …and the stamp still has to cover it, because `markRead` scans WITHOUT a
    // banlist. What ChatViewer hands over is the newest FOLD-VISIBLE message.
    await a.markRead(conversation, NOW() - 300);
    expect(await a.getLastRead(conversation)).toBe(NOW() - 100);
    expect(await countFor(a)).toBe(0);
  });

  it("clears it even when the hidden rows sit above the scan cap", async () => {
    // The same bug, in the shape that survives an ascending scan: with more
    // unread than the cap, `latest` must still be the NEWEST counted row.
    const a = adapter();
    banned.add(BANNED);
    const base = NOW() - 5000;
    await post([
      ...Array.from({ length: 150 }, (_, i) => ({ at: base + i })),
      { at: NOW() - 10, author: BANNED },
    ]);

    await a.markRead(conversation, base + 149);
    expect(await countFor(a)).toBe(0);
  });

  it("is not pinned or blanked by a message dated in the far future", async () => {
    // `created_at` is whatever its author wrote and ingest has no clock check.
    const a = adapter();
    await post([{ at: NOW() - 100 }, { at: NOW() + 7200 }]);

    // The future row is invisible to the count…
    expect(await countFor(a)).toBe(1);
    // …and cannot be stamped, so it does not mark the channel read for hours.
    await a.markRead(conversation, NOW() + 7200);
    expect(await a.getLastRead(conversation)).toBeLessThanOrEqual(NOW() + 3600);
  });

  it("stamps nothing for a channel with nothing loaded", async () => {
    const a = adapter();
    await post([{ at: NOW() - 100 }]);
    await a.markRead(conversation, 0);
    expect(await a.getLastRead(conversation)).toBe(0);
    expect(await countFor(a)).toBe(1);
  });
});

describe("delivery state", () => {
  /** Watch the standing emitter the way ChatViewer does. */
  function watch(a: ReturnType<typeof adapter>) {
    const seen: Message[][] = [];
    const sub = a.loadMessages(conversation).subscribe((m) => seen.push(m));
    return {
      last: () => seen[seen.length - 1],
      count: () => seen.length,
      stop: () => sub.unsubscribe(),
    };
  }

  const settle = () => new Promise((r) => setTimeout(r, 120));

  it("resolves the send and shows the message queued, not lost", async () => {
    published.mockRejectedValue(new Error("No relay accepted the message."));
    const a = adapter();
    const view = watch(a);

    // The point of the whole change: this does NOT throw, so the composer
    // clears and the text lives in the timeline instead of in a toast.
    await expect(
      a.sendMessage(conversation, "into the void"),
    ).resolves.toBeUndefined();
    await a._settleSends();
    await settle();

    const rows = view.last() ?? [];
    expect(rows.map((m) => m.content)).toContain("into the void");
    expect(rows.find((m) => m.content === "into the void")?.delivery).toBe(
      "failed",
    );
    // And publish-first holds: nothing a relay refused reached the store.
    expect(await db.concordRumors.count()).toBe(0);
    view.stop();
  });

  it("leaves nothing queued once a relay took it", async () => {
    const a = adapter();
    const view = watch(a);
    await a.sendMessage(conversation, "delivered");
    await a._settleSends();
    await settle();

    expect(await db.concordOutbox.count()).toBe(0);
    expect(await db.concordRumors.count()).toBe(1);
    expect((view.last() ?? []).every((m) => !m.delivery)).toBe(true);
    view.stop();
  });

  it("shows the message once, not twice, while the row is being dropped", async () => {
    // The echo race: the store row is written and the doorbell rung BEFORE the
    // outbox row is deleted, so a re-read in that window sees both halves of
    // the same message.
    const a = adapter();
    await a.sendMessage(conversation, "echo");
    await a._settleSends();
    const stored = (await db.concordRumors.toArray())[0];
    // Put the row back exactly as it stood mid-flight.
    await db.concordOutbox.put({
      id: "queued",
      pubkey,
      communityId: idHex,
      channel: channelIdHex,
      kind: KIND_MESSAGE,
      content: "echo",
      createdAt: stored.created_at,
      status: "sending",
      attempts: 1,
      lastAttemptRumorId: stored.id,
    });

    const view = watch(a);
    await settle();
    expect(
      (view.last() ?? []).filter((m) => m.content === "echo"),
    ).toHaveLength(1);
    view.stop();
  });

  it("repaints when a queued message flips from sending to failed", async () => {
    // The emission is suppressed unless the timeline actually changed, and a
    // status flip changes no id at all — an id-only signature would swallow
    // exactly the repaint that tells the reader their message did not go.
    const a = adapter();
    const view = watch(a);
    await db.concordOutbox.put({
      id: "queued",
      pubkey,
      communityId: idHex,
      channel: channelIdHex,
      kind: KIND_MESSAGE,
      content: "pending",
      createdAt: 100,
      status: "sending",
      attempts: 1,
    });
    await settle();
    const before = view.count();
    expect(view.last()?.find((m) => m.id === "queued")?.delivery).toBe(
      "sending",
    );

    await db.concordOutbox.update("queued", { status: "failed" });
    const { emitWireScopes, channelScope } =
      await import("@/lib/concord/wire-bus");
    emitWireScopes([channelScope(channelIdHex)]);
    await settle();

    expect(view.count()).toBeGreaterThan(before);
    expect(view.last()?.find((m) => m.id === "queued")?.delivery).toBe(
      "failed",
    );
    view.stop();
  });

  it("forgets a discarded message and nothing else", async () => {
    published.mockRejectedValue(new Error("nope"));
    const a = adapter();
    await a.sendMessage(conversation, "give up on me");
    await a._settleSends();
    const row = (await db.concordOutbox.toArray())[0];

    await a.discardSend(conversation, row.id);
    expect(await db.concordOutbox.count()).toBe(0);
  });

  it("keeps a refused reaction throwing, with nothing queued", async () => {
    // A queued reaction would need a UI of its own and an answer to "react to a
    // message deleted while you were offline". It stays publish-first.
    published.mockRejectedValue(new Error("nope"));
    const id = await myMessage();
    await expect(
      adapter().sendReaction(conversation, id, "🔥"),
    ).rejects.toThrow();
    expect(await db.concordOutbox.count()).toBe(0);
  });

  it("keeps a refused self-delete throwing, with nothing queued", async () => {
    // The context menu says "Message deleted" when this resolves, so resolving
    // early would say it about a message that is still there.
    published.mockRejectedValue(new Error("nope"));
    const id = await myMessage();
    await expect(adapter().deleteMessage(conversation, id)).rejects.toThrow();
    expect(await db.concordOutbox.count()).toBe(0);
  });
});

describe("a message a moderator took down", () => {
  const OWNER = "aa".repeat(32);
  const FRIEND = "ab".repeat(32);
  const VICTIM = "cd".repeat(64).slice(0, 64);

  /** Their message, and optionally a kind-5 naming it. */
  async function seed(deleter?: string): Promise<string> {
    await writeChatRumors(idHex, [
      {
        rumorId: VICTIM,
        author: FRIEND,
        kind: KIND_MESSAGE,
        content: "the words that were removed",
        tags: [],
        ms: 1000,
        createdAt: 1,
        channel: channelIdHex,
      },
      ...(deleter
        ? [
            {
              rumorId: "ef".repeat(32),
              author: deleter,
              kind: 5,
              content: "",
              tags: [["e", VICTIM]],
              ms: 2000,
              createdAt: 2,
              channel: channelIdHex,
            },
          ]
        : []),
    ]);
    return VICTIM;
  }

  /** Watch the standing emitter the way ChatViewer does. */
  function watch(a: ReturnType<typeof adapter>) {
    const seen: Message[][] = [];
    const sub = a.loadMessages(conversation).subscribe((m) => seen.push(m));
    return {
      seen,
      last: () => seen[seen.length - 1],
      stop: () => sub.unsubscribe(),
    };
  }

  it("renders a tombstone naming the moderator, with the words gone", async () => {
    // The owner outranks everyone by the community_id itself, so their delete
    // needs no citation — this is the authorized case.
    await seed(OWNER);
    const a = adapter();
    const feed = watch(a);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(1));

    const [row] = feed.last();
    expect(row.id).toBe(VICTIM);
    expect(row.author).toBe(FRIEND);
    expect(row.metadata?.deleted).toBe(true);
    expect(row.metadata?.deletedBy).toBe(OWNER);
    expect(row.content).toBe("");
    expect(row.event.content).toBe("");
    expect(row.event.tags).toEqual([]);
    // Nowhere in the emission — not in content, not in a tag, not in the event.
    expect(JSON.stringify(feed.last())).not.toContain("the words that were");
    feed.stop();
  });

  it("leaves a self-deleted message as a silent gap", async () => {
    await seed(FRIEND);
    const a = adapter();
    const feed = watch(a);
    // Nothing to wait FOR, so wait for the read to have happened at all: the
    // backfill's final publish emits the empty timeline.
    await vi.waitFor(() => expect(feed.last()).toEqual([]));
    feed.stop();
  });

  it("replaces the message live when the delete lands mid-session", async () => {
    // The repaint the dedupe signature nearly suppressed: the tombstone carries
    // the same id, the same timestamp and no delivery state, so an id-only
    // signature leaves the removed words on screen until something else moves.
    await seed();
    const a = adapter();
    const feed = watch(a);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(1));
    expect(feed.last()[0].metadata?.deleted).toBeUndefined();

    await writeChatRumors(idHex, [
      {
        rumorId: "ef".repeat(32),
        author: OWNER,
        kind: 5,
        content: "",
        tags: [["e", VICTIM]],
        ms: 2000,
        createdAt: 2,
        channel: channelIdHex,
      },
    ]);
    emitWireScopes([channelScope(channelIdHex)]);

    await vi.waitFor(() => expect(feed.last()[0].metadata?.deleted).toBe(true));
    feed.stop();
  });

  it("ignores a delete from someone with no authority over it", async () => {
    await seed("dd".repeat(32));
    const a = adapter();
    const feed = watch(a);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(1));
    expect(feed.last()[0].metadata?.deleted).toBeUndefined();
    expect(feed.last()[0].content).toBe("the words that were removed");
    feed.stop();
  });
});
