/**
 * Local search, and the one invariant it lives or dies by: a hit is something
 * the timeline would render.
 *
 * Every case below is a way that could stop being true — a banned author, an
 * expired rumor, a moderator's delete, an edit — and each is checked against the
 * FOLD rather than against a re-derivation, because a second set of rules is
 * exactly how a search starts showing what a channel refuses to.
 *
 * Store-only: no relay is in this path at all.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { bytesToHex, channelGroupKey, random32 } from "@/lib/concord/derive";
import {
  chatModerationOf,
  filterEpochCutoff,
  foldTimeline,
  type OpenedChat,
} from "@/lib/concord/chat";
import type { FoldedControl } from "@/lib/concord/control";
import {
  KIND_COMMENT,
  KIND_DELETE,
  KIND_EDIT,
  KIND_MESSAGE,
  KIND_REACTION,
} from "@/lib/concord/kinds";
import { SEARCH_RESULT_LIMIT } from "@/lib/concord/search";
import type { Channel, Community } from "@/lib/concord/types";
import db from "@/services/db";
import {
  queryChannelRumors,
  writeChatRumors,
} from "@/services/concord-rumor-store";

import { searchConcordMessages } from "./concord-search";

const communityId = random32();
const idHex = bytesToHex(communityId);
const root = random32();
const OWNER = "aa".repeat(32);
const ALICE = "bb".repeat(32);
const BANNED = "cc".repeat(32);

const generalId = random32();
const randomId = random32();

function channel(id: Uint8Array, name: string, isPrivate = false): Channel {
  const group = channelGroupKey(root, id, 0n);
  return {
    id,
    idHex: bytesToHex(id),
    name,
    isPrivate,
    streams: [{ epoch: 0n, group }],
    current: { epoch: 0n, group },
  };
}

const general = channel(generalId, "general");
const random = channel(randomId, "random");

function community(): Community {
  return {
    id: communityId,
    idHex,
    owner: OWNER,
    ownerSalt: random32(),
    root,
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays: ["wss://x"],
    name: "Test",
  };
}

function folded(banned: string[] = []): FoldedControl {
  return {
    roster: { roles: [], grants: [] },
    ownerHex: OWNER,
    channels: new Map(),
    banned: new Set(banned),
    bannedAt: new Map(),
    heads: new Map(),
    incomplete: [],
  };
}

let seq = 0;
interface SeedRow {
  author?: string;
  kind?: number;
  content?: string;
  tags?: string[][];
  createdAt?: number;
  rumorId?: string;
}

async function seed(ch: Channel, rows: SeedRow[]): Promise<string[]> {
  const ids: string[] = [];
  await writeChatRumors(
    idHex,
    rows.map((row) => {
      seq += 1;
      const rumorId = row.rumorId ?? seq.toString(16).padStart(64, "0");
      ids.push(rumorId);
      const createdAt = row.createdAt ?? 1_000 + seq;
      return {
        rumorId,
        author: row.author ?? ALICE,
        kind: row.kind ?? KIND_MESSAGE,
        content: row.content ?? "",
        tags: row.tags ?? [],
        createdAt,
        ms: createdAt * 1000,
        channel: ch.idHex,
      };
    }),
  );
  return ids;
}

/** What the timeline would render for one channel — the subset's superset. */
async function renderedIds(ch: Channel): Promise<Set<string>> {
  const rows = await queryChannelRumors(idHex, ch.idHex, { limit: 5000 });
  const opened: OpenedChat[] = rows.map((row) => ({
    ...row,
    channelIdHex: ch.idHex,
    epoch: ch.current.epoch,
  }));
  const timeline = foldTimeline(
    filterEpochCutoff(opened, ch),
    chatModerationOf(folded(), communityId),
  );
  return new Set(timeline.messages.map((m) => m.rumorId));
}

function search(
  query: string,
  opts: {
    channelIds?: string[];
    banned?: string[];
    channels?: Channel[];
    signal?: AbortSignal;
  } = {},
) {
  return searchConcordMessages(
    community(),
    folded(opts.banned),
    opts.channels ?? [general, random],
    { query, channelIds: opts.channelIds ?? [] },
    opts.signal ? { signal: opts.signal } : undefined,
  );
}

beforeEach(async () => {
  await db.concordRumors.clear();
  seq = 0;
});

describe("what search finds", () => {
  it("matches a substring, ignoring case", async () => {
    await seed(general, [{ content: "The Otter Went Fishing" }]);
    const hits = await search("otter");
    expect(hits.map((h) => h.message.content)).toEqual([
      "The Otter Went Fishing",
    ]);
  });

  it("names the channel a hit was found in", async () => {
    await seed(random, [{ content: "otters again" }]);
    const [hit] = await search("otters");
    expect(hit.channelIdHex).toBe(random.idHex);
    expect(hit.channelName).toBe("random");
    expect(hit.channelPrivate).toBe(false);
  });

  it("finds a threaded reply, not just a top-level message", async () => {
    await seed(general, [{ kind: KIND_COMMENT, content: "otter reply" }]);
    expect(await search("otter")).toHaveLength(1);
  });

  it("matches the EDITED text, not the text that was replaced", async () => {
    // The fold applies the edit before the predicate runs, which is the whole
    // reason search folds instead of querying rows.
    const [target] = await seed(general, [{ content: "otter" }]);
    await seed(general, [
      {
        kind: KIND_EDIT,
        content: "badger",
        tags: [["e", target]],
        createdAt: 2_000,
      },
    ]);
    expect(await search("badger")).toHaveLength(1);
    expect(await search("otter")).toEqual([]);
  });

  it("returns results newest first across channels", async () => {
    await seed(general, [{ content: "otter one", createdAt: 100 }]);
    await seed(random, [{ content: "otter two", createdAt: 200 }]);
    expect((await search("otter")).map((h) => h.message.content)).toEqual([
      "otter two",
      "otter one",
    ]);
  });

  it("ignores a reaction whose content happens to match", async () => {
    // A reaction is not a timeline row; the fold never puts one in `messages`.
    await seed(general, [{ kind: KIND_REACTION, content: "otter" }]);
    expect(await search("otter")).toEqual([]);
  });
});

describe("what search must never surface", () => {
  it("never returns a message a moderator removed", async () => {
    const [target] = await seed(general, [{ content: "otter secret" }]);
    await seed(general, [
      {
        author: OWNER,
        kind: KIND_DELETE,
        tags: [["e", target]],
        createdAt: 2_000,
      },
    ]);
    expect(await search("otter")).toEqual([]);
  });

  it("never returns a banned author's message", async () => {
    await seed(general, [{ author: BANNED, content: "otter from a ban" }]);
    expect(await search("otter", { banned: [BANNED] })).toEqual([]);
    // …and the timeline agrees, which is the invariant rather than the effect.
    expect(await search("otter")).toHaveLength(1);
  });

  it("never returns an expired rumor", async () => {
    // Refused at ingest, so it is written straight to the table to reach the
    // read-side rule the way a row stored before its deadline passed does.
    await db.concordRumors.put({
      id: "dd".repeat(32),
      communityId: idHex,
      channel: general.idHex.toLowerCase(),
      pubkey: ALICE,
      kind: KIND_MESSAGE,
      content: "otter expiring",
      tags: [["expiration", String(Math.floor(Date.now() / 1000) - 60)]],
      created_at: 1_500,
    });
    expect(await search("otter")).toEqual([]);
  });

  it("returns only ids the timeline itself would render", async () => {
    const [kept] = await seed(general, [{ content: "otter kept" }]);
    const [removed] = await seed(general, [{ content: "otter removed" }]);
    await seed(general, [
      {
        author: OWNER,
        kind: KIND_DELETE,
        tags: [["e", removed]],
        createdAt: 3_000,
      },
    ]);
    const rendered = await renderedIds(general);
    const hits = await search("otter");
    expect(hits.map((h) => h.message.rumorId)).toEqual([kept]);
    for (const hit of hits)
      expect(rendered.has(hit.message.rumorId)).toBe(true);
  });
});

describe("scope and bounds", () => {
  it("searches only the channels named in the allow-list", async () => {
    await seed(general, [{ content: "otter here" }]);
    await seed(random, [{ content: "otter there" }]);
    const hits = await search("otter", { channelIds: [general.idHex] });
    expect(hits.map((h) => h.message.content)).toEqual(["otter here"]);
  });

  it("accepts the allow-list in any case", async () => {
    await seed(general, [{ content: "otter here" }]);
    const hits = await search("otter", {
      channelIds: [general.idHex.toUpperCase()],
    });
    expect(hits).toHaveLength(1);
  });

  it("searches nothing when the allow-list names no channel in scope", async () => {
    await seed(general, [{ content: "otter here" }]);
    expect(await search("otter", { channelIds: ["ff".repeat(32)] })).toEqual(
      [],
    );
  });

  it("searches nothing when the member can open no channel", async () => {
    await seed(general, [{ content: "otter here" }]);
    expect(await search("otter", { channels: [] })).toEqual([]);
  });

  it("caps the results", async () => {
    await seed(
      general,
      Array.from({ length: SEARCH_RESULT_LIMIT + 20 }, (_, i) => ({
        content: `otter ${i}`,
        createdAt: 1_000 + i,
      })),
    );
    expect(await search("otter")).toHaveLength(SEARCH_RESULT_LIMIT);
  });

  it("does not run at all below the minimum query length", async () => {
    await seed(general, [{ content: "otter" }]);
    expect(await search("o")).toEqual([]);
  });

  it("stops between channels when the caller aborts", async () => {
    await seed(general, [{ content: "otter one" }]);
    await seed(random, [{ content: "otter two" }]);
    const controller = new AbortController();
    controller.abort();
    expect(await search("otter", { signal: controller.signal })).toEqual([]);
  });
});
