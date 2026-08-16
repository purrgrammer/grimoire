/**
 * Wire → store → badge, end to end.
 *
 * The unit tests either side of this one seed `writeChatRumors` directly, which
 * proves the scan but not that anything the WIRE delivers ever reaches it. Here
 * a real sealed, wrapped, channel-bound message goes through `ingestWireEvents`
 * and comes out as a number in the sidebar — and a mark clears it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import {
  bytesToHex,
  channelGroupKey,
  controlGroupKey,
  random32,
} from "@/lib/concord/derive";
import { KIND_MESSAGE, KIND_SEAL_ENCRYPTED } from "@/lib/concord/kinds";
import { buildRumor, sealRumor, wrapSeal } from "@/lib/concord/stream";
import type { Channel } from "@/lib/concord/types";
import { buildWireSpec } from "@/lib/concord/wire-spec";
import {
  CONCORD_READ_MAX_FUTURE_SECS,
  markChannelRead,
  readLastRead,
} from "./concord-reads";
import { channelUnreadSummary } from "./concord-rumor-store";
import { ingestWireEvents } from "./concord-wire-ingest";
import db from "./db";

const root = random32();
const communityId = random32();
const COMMUNITY = bytesToHex(communityId);
const control = controlGroupKey(root, communityId, 0n);

const channelId = random32();
const CHANNEL = bytesToHex(channelId);
const chatKey = channelGroupKey(root, channelId, 0n);

const channel: Channel = {
  id: channelId,
  idHex: CHANNEL,
  name: "#general",
  isPrivate: false,
  streams: [{ epoch: 0n, group: chatKey }],
  current: { epoch: 0n, group: chatKey },
};

const spec = buildWireSpec({
  channels: [{ relays: [], channel, communityIdHex: COMMUNITY }],
  control: [
    {
      relays: [],
      idHex: COMMUNITY,
      current: control,
      groups: [control],
      refounded: false,
    },
  ],
});

const ME = getPublicKey(new Uint8Array(32).fill(7));
const NOW = () => Math.floor(Date.now() / 1000);

/** A real chat message, as it arrives off the wire. */
async function chatWrap(
  text: string,
  createdAt: number,
  tags: string[][] = [],
): Promise<NostrEvent> {
  const author = generateSecretKey();
  const rumor = buildRumor({
    kind: KIND_MESSAGE,
    content: text,
    tags: [["channel", CHANNEL], ["epoch", "0"], ...tags],
    pubkey: getPublicKey(author),
    createdAtSecs: createdAt,
    ms: null,
  });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, chatKey, {
    signEvent: async (template) => finalizeEvent(template, author),
  });
  const wrapped = wrapSeal(seal, chatKey);
  return finalizeEvent(
    {
      kind: wrapped.kind,
      content: wrapped.content,
      tags: wrapped.tags,
      created_at: createdAt,
    },
    chatKey.sk,
  );
}

const summary = (after: number) =>
  channelUnreadSummary(COMMUNITY, CHANNEL, {
    after,
    nowSecs: NOW(),
    maxFutureSecs: CONCORD_READ_MAX_FUTURE_SECS,
    selfPubkey: ME,
  });

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.chatReads.clear();
});

describe("a message arriving on the wire", () => {
  it("shows up in the badge, and a mark clears it", async () => {
    const at = NOW() - 60;
    await ingestWireEvents(spec, [await chatWrap("hello", at)]);

    const before = await summary(0);
    expect(before.count).toBe(1);
    expect(before.latest).toBe(at);
    expect(before.mention).toBe(false);

    await markChannelRead(ME, COMMUNITY, CHANNEL, before.latest);
    expect(await readLastRead(ME, COMMUNITY, CHANNEL)).toBe(at);
    expect((await summary(at)).count).toBe(0);
  });

  it("flags a mention when the message names the reader", async () => {
    await ingestWireEvents(spec, [
      await chatWrap("oi", NOW() - 30, [["p", ME]]),
    ]);
    expect((await summary(0)).mention).toBe(true);
  });

  it("counts the next arrival after the mark, and nothing before it", async () => {
    const first = NOW() - 120;
    await ingestWireEvents(spec, [await chatWrap("one", first)]);
    await markChannelRead(ME, COMMUNITY, CHANNEL, first);

    const second = NOW() - 10;
    await ingestWireEvents(spec, [await chatWrap("two", second)]);
    const after = await summary(await readLastRead(ME, COMMUNITY, CHANNEL));
    expect(after.count).toBe(1);
    expect(after.latest).toBe(second);
  });
});
