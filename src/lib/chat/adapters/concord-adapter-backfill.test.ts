/**
 * Paging backwards over the WIRE, with a real relay in the path.
 *
 * The sibling file stubs `syncChannel`, which is enough to pin the window
 * arithmetic and nothing else: with the whole history pre-seeded into the store,
 * deleting the relay fetch from `loadMoreMessages` outright leaves every one of
 * those tests green. So the half that actually goes to a relay — the `until`
 * page, and the progressive repaint as each relay lands — is tested here
 * instead, against `startMockRelay`'s `paged` behaviour with nothing seeded
 * locally. Every row these tests see had to arrive over the wire.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import { bytesToHex, channelGroupKey, random32 } from "@/lib/concord/derive";
import type { FoldedControl } from "@/lib/concord/control";
import { KIND_MESSAGE, KIND_SEAL_ENCRYPTED } from "@/lib/concord/kinds";
import {
  buildRumor,
  channelBindingTags,
  sealRumor,
  wrapSeal,
} from "@/lib/concord/stream";
import type { Channel, Community } from "@/lib/concord/types";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";
import type { Conversation, Message } from "@/types/chat";

// The adapter's backfill passes no pool, so plane reads go to Concord's own
// singleton. Swapping it for a live pool is what puts the mock relay in the path.
vi.mock("@/services/concord-relay-pool", async () => {
  const { RelayPool } = await import("applesauce-relay");
  return { default: new RelayPool() };
});
vi.mock("@/services/accounts", () => ({
  default: { active$: { value: { pubkey: "aa".repeat(32) } } },
}));

const communityId = random32();
const idHex = bytesToHex(communityId);
const channelId = random32();
const channelIdHex = bytesToHex(channelId);
const root = random32();
const group = channelGroupKey(root, channelId, 0n);

const { ConcordAdapter } = await import("./concord-adapter");
const { _resetChatDecodeForTests } = await import("@/lib/concord/chat");
const { default: db } = await import("@/services/db");
const { default: pool } = await import("@/services/concord-relay-pool");

function community(relays: string[]): Community {
  return {
    id: communityId,
    idHex,
    owner: "aa".repeat(32),
    ownerSalt: random32(),
    root,
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays,
    name: "Test",
  };
}

function channel(): Channel {
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
    banned: new Set(),
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
function adapter(relays: string[]) {
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
    community: community(relays),
    channel: channel(),
    folded: folded(),
  });
  return a;
}

/**
 * A real chat wrap on the wire: an encrypted seal under the channel's group key,
 * wrapped and signed by it. Anything less is refused by the decode gate.
 *
 * `wrapSeal` stamps the wrap from the clock, and the relay's `until` pages on
 * exactly that field — so the wrap is re-signed at the second the test wants it,
 * matching the rumor inside it.
 */
async function chatWrap(second: number): Promise<NostrEvent> {
  const authorSk = generateSecretKey();
  const rumor = buildRumor({
    kind: KIND_MESSAGE,
    content: `m${second}`,
    tags: channelBindingTags(channelIdHex, 0n),
    pubkey: getPublicKey(authorSk),
    ms: second * 1000,
  });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, group, {
    signEvent: async (template) => finalizeEvent(template, authorSk),
  });
  const wrapped = wrapSeal(seal, group);
  return finalizeEvent(
    {
      kind: wrapped.kind,
      content: wrapped.content,
      tags: wrapped.tags,
      created_at: second,
    },
    group.sk,
  );
}

async function wraps(seconds: number[]): Promise<NostrEvent[]> {
  const out: NostrEvent[] = [];
  for (const second of seconds) out.push(await chatWrap(second));
  return out;
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

const relays: MockRelay[] = [];

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.concordKv.clear();
  // The decode memo is module-level and keyed by wrap id; a previous test's
  // opens would otherwise be served without the wire ever being asked.
  _resetChatDecodeForTests();
});

afterEach(async () => {
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

afterAll(() => {
  pool.close();
});

describe("loading older messages off the wire", () => {
  it("fetches the older page from the relay and renders it", async () => {
    // Nothing is seeded locally and the relay's page cap is below its history,
    // so the only way older rows can appear is a second, `until`-bounded read.
    const relay = await startMockRelay({
      kind: "paged",
      events: await wraps(Array.from({ length: 60 }, (_, i) => i + 1)),
      pageLimit: 20,
    });
    relays.push(relay);

    const a = adapter([relay.url]);
    const feed = watch(a);
    // The relay caps at 20, so the open shows seconds 41–60 and no more.
    await vi.waitFor(() => expect(feed.last()).toHaveLength(20), {
      timeout: 5_000,
    });
    expect(feed.last()[0].timestamp).toBe(41);

    const page = await a.loadMoreMessages(conversation, 41);
    // `until` is inclusive on the wire, so the 20-row answer re-serves the
    // boundary and reveals seconds 22–40.
    expect(page).toHaveLength(19);
    expect(page.every((m) => m.timestamp < 41)).toBe(true);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(39), {
      timeout: 5_000,
    });

    feed.stop();
    a.cleanup(conversation.id);
  });

  it("repaints as each relay's page lands, not once at the end", async () => {
    // The reader waits on the FIRST relay to answer, not the slowest. Two
    // relays holding disjoint halves of the history make the difference
    // observable: without the progressive repaint the timeline jumps straight
    // from 20 rows to 39 and never shows anything in between.
    const odd = await startMockRelay({
      kind: "paged",
      events: await wraps(Array.from({ length: 30 }, (_, i) => i * 2 + 1)),
      pageLimit: 10,
    });
    const even = await startMockRelay({
      kind: "paged",
      events: await wraps(Array.from({ length: 30 }, (_, i) => i * 2 + 2)),
      pageLimit: 10,
      delayMs: 250,
    });
    relays.push(odd, even);

    const a = adapter([odd.url, even.url]);
    const feed = watch(a);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(20), {
      timeout: 5_000,
    });
    const opened = feed.seen.length;

    const page = await a.loadMoreMessages(conversation, 41);
    expect(page).toHaveLength(19);
    await vi.waitFor(() => expect(feed.last()).toHaveLength(39), {
      timeout: 5_000,
    });

    // The fast relay's nine older rows are painted while the slow one is still
    // in flight; the emitter's log is append-only, so the intermediate is still
    // there to find after the fact.
    const paging = feed.seen.slice(opened);
    expect(paging.some((t) => t.length > 20 && t.length < 39)).toBe(true);

    feed.stop();
    a.cleanup(conversation.id);
  });
});
