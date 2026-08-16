/**
 * The timeline fold, and specifically what it says about a message that is gone.
 *
 * Two erasures look identical on disk — the kind-5 and its target both survive
 * `writeChatRumors` either way — and the fold is the only place that tells them
 * apart. A moderator's removal is announced; an author's own scrub is not. That
 * asymmetry is the CORD-02 §9 carve-out, so it gets tested rather than assumed.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetChatDecodeForTests,
  foldTimeline,
  type ChatModeration,
  type OpenedChat,
} from "@/lib/concord/chat";
import { KIND_DELETE, KIND_EDIT, KIND_MESSAGE } from "@/lib/concord/kinds";

const ALICE = "a".repeat(64);
const MOD = "b".repeat(64);
const OTHER_MOD = "c".repeat(64);
const BANNED = "d".repeat(64);
const CHANNEL = "e".repeat(64);

let seq = 0;
function opened(over: Partial<OpenedChat> & { author: string }): OpenedChat {
  seq += 1;
  const createdAt = over.createdAt ?? 1_000 + seq;
  return {
    rumorId: `${seq}`.padStart(64, "0"),
    kind: KIND_MESSAGE,
    content: "",
    tags: [],
    createdAt,
    ms: createdAt * 1000,
    channelIdHex: CHANNEL,
    epoch: 0n,
    ...over,
  };
}

/** A delete of `targetId` by `author`. */
function deleteOf(author: string, targetId: string, at?: number): OpenedChat {
  return opened({
    author,
    kind: KIND_DELETE,
    tags: [["e", targetId]],
    ...(at !== undefined ? { createdAt: at } : {}),
  });
}

/** Moderation where `allowed` may delete anyone else's message. */
function moderation(allowed: string[], banned: string[] = []): ChatModeration {
  return {
    banned: new Set(banned),
    canDelete: (deleter, author) =>
      deleter !== author && allowed.includes(deleter),
  };
}

beforeEach(() => {
  _resetChatDecodeForTests();
  seq = 0;
});

describe("foldTimeline — moderator removals", () => {
  it("removes a self-deleted message and records nothing", () => {
    const msg = opened({ author: ALICE, content: "mine" });
    const timeline = foldTimeline(
      [msg, deleteOf(ALICE, msg.rumorId)],
      moderation([MOD]),
    );
    expect(timeline.messages).toEqual([]);
    expect(timeline.removed).toEqual([]);
  });

  it("records an authorized moderator delete with the deleter", () => {
    const msg = opened({ author: ALICE, content: "gone" });
    const timeline = foldTimeline(
      [msg, deleteOf(MOD, msg.rumorId)],
      moderation([MOD]),
    );
    expect(timeline.messages).toEqual([]);
    expect(timeline.removed).toHaveLength(1);
    expect(timeline.removed[0].deleter).toBe(MOD);
    expect(timeline.removed[0].target.rumorId).toBe(msg.rumorId);
    // The target's own time, not the delete's — the tombstone sits where the
    // message sat, not where the moderation happened.
    expect(timeline.removed[0].ms).toBe(msg.ms);
  });

  it("leaves an unauthorized delete inert — the message stays", () => {
    const msg = opened({ author: ALICE, content: "still here" });
    const timeline = foldTimeline(
      [msg, deleteOf(OTHER_MOD, msg.rumorId)],
      moderation([MOD]),
    );
    expect(timeline.messages.map((m) => m.rumorId)).toEqual([msg.rumorId]);
    expect(timeline.removed).toEqual([]);
  });

  it("drops a banned moderator's delete before the delete pass", () => {
    const msg = opened({ author: ALICE, content: "still here" });
    // BANNED would be authorized if it were folded at all — the ban is what
    // stops it (CORD-04 §4), and no tombstone may ever cite a banned actor.
    const timeline = foldTimeline(
      [msg, deleteOf(BANNED, msg.rumorId)],
      moderation([BANNED, MOD], [BANNED]),
    );
    expect(timeline.messages.map((m) => m.rumorId)).toEqual([msg.rumorId]);
    expect(timeline.removed).toEqual([]);
  });

  it("lets a self-delete win over a moderator's, leaving no tombstone", () => {
    const msg = opened({ author: ALICE, content: "mine" });
    const timeline = foldTimeline(
      [msg, deleteOf(MOD, msg.rumorId), deleteOf(ALICE, msg.rumorId)],
      moderation([MOD]),
    );
    expect(timeline.messages).toEqual([]);
    expect(timeline.removed).toEqual([]);
  });

  it("credits the earliest authorized deleter when two moderators act", () => {
    const msg = opened({ author: ALICE, content: "gone" });
    const late = deleteOf(OTHER_MOD, msg.rumorId, 9_000);
    const early = deleteOf(MOD, msg.rumorId, 5_000);
    const timeline = foldTimeline(
      [msg, late, early],
      moderation([MOD, OTHER_MOD]),
    );
    expect(timeline.removed.map((r) => r.deleter)).toEqual([MOD]);
  });

  it("never records an expired message, deleted or not", () => {
    const expired = opened({
      author: ALICE,
      content: "poof",
      tags: [["expiration", String(Math.floor(Date.now() / 1000) - 60)]],
    });
    const timeline = foldTimeline(
      [expired, deleteOf(MOD, expired.rumorId)],
      moderation([MOD]),
    );
    expect(timeline.messages).toEqual([]);
    expect(timeline.removed).toEqual([]);
  });

  it("sorts removals by the removed message's own time", () => {
    const first = opened({ author: ALICE, content: "one", createdAt: 100 });
    const second = opened({ author: ALICE, content: "two", createdAt: 200 });
    const timeline = foldTimeline(
      [
        second,
        first,
        deleteOf(MOD, second.rumorId, 300),
        deleteOf(MOD, first.rumorId, 400),
      ],
      moderation([MOD]),
    );
    expect(timeline.removed.map((r) => r.target.content)).toEqual([
      "one",
      "two",
    ]);
  });

  it("records nothing without moderation wiring", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([msg, deleteOf(MOD, msg.rumorId)]);
    expect(timeline.messages.map((m) => m.rumorId)).toEqual([msg.rumorId]);
    expect(timeline.removed).toEqual([]);
  });

  it("keeps the edited text of a message that survives", () => {
    const msg = opened({ author: ALICE, content: "typo" });
    const edit = opened({
      author: ALICE,
      kind: KIND_EDIT,
      content: "fixed",
      tags: [["e", msg.rumorId]],
    });
    const timeline = foldTimeline([msg, edit], moderation([MOD]));
    expect(timeline.messages.map((m) => m.content)).toEqual(["fixed"]);
  });
});
