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

import { bytesToHex, channelGroupKey, random32 } from "@/lib/concord/derive";
import type { FoldedControl } from "@/lib/concord/control";
import { KIND_MESSAGE } from "@/lib/concord/kinds";
import type { Channel, Community } from "@/lib/concord/types";
import type { Conversation } from "@/types/chat";

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
  published.mockClear();
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
    await adapter().sendMessage(conversation, "hello");
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
