/**
 * Drafts: kept per channel, per ACCOUNT, and never restored over live typing.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDraft,
  draftKey,
  draftsReady,
  readDraft,
  resetDraftCache,
  shouldRestoreDraft,
  writeDraft,
} from "./chat-drafts";
import db, { type ChatDraftRow } from "./db";

const ALICE = "aa".repeat(32);
const BOB = "bb".repeat(32);
const CHANNEL = "cc".repeat(32) + ":" + "dd".repeat(32);

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(async () => {
  await db.chatDrafts.clear();
  resetDraftCache();
  await draftsReady();
});

describe("draftKey", () => {
  it("puts the account first, so two accounts never share one", () => {
    // Armada's key has no account component at all. Grimoire switches accounts
    // in place, so that shape would show one identity what another was typing —
    // and the prefix is also the only thing the logout wipe can delete by.
    const mine = draftKey(ALICE, "concord", CHANNEL);
    const theirs = draftKey(BOB, "concord", CHANNEL);
    expect(mine).not.toBe(theirs);
    expect(mine.startsWith(`${ALICE}:`)).toBe(true);
  });

  it("separates the same conversation id across protocols", () => {
    expect(draftKey(ALICE, "concord", "x")).not.toBe(
      draftKey(ALICE, "nip-29", "x"),
    );
  });
});

describe("the cache in front of the table", () => {
  it("round-trips a draft, tiptap document and reply target intact", async () => {
    const key = draftKey(ALICE, "concord", CHANNEL);
    writeDraft(key, doc("half a thought"), "ee".repeat(32));

    expect(readDraft(key)?.content).toEqual(doc("half a thought"));
    expect(readDraft(key)?.replyToId).toBe("ee".repeat(32));

    // And it is on disk, not only in memory — the point of the whole table.
    resetDraftCache();
    await draftsReady();
    expect(readDraft(key)?.content).toEqual(doc("half a thought"));
  });

  it("answers nothing after a clear, on disk as well", async () => {
    const key = draftKey(ALICE, "concord", CHANNEL);
    writeDraft(key, doc("gone"));
    clearDraft(key);
    expect(readDraft(key)).toBeUndefined();

    resetDraftCache();
    await draftsReady();
    expect(readDraft(key)).toBeUndefined();
  });

  it("reads nothing before it is warm, and everything after", async () => {
    const key = draftKey(ALICE, "concord", CHANNEL);
    await db.chatDrafts.put({
      key,
      content: doc("written by another window"),
      updatedAt: 1,
    });
    resetDraftCache();

    // The gate exists for exactly this: a cold read answers "no draft", and a
    // composer that saved its empty self on that answer would delete the real
    // one.
    expect(readDraft(key)).toBeUndefined();
    await draftsReady();
    expect(readDraft(key)?.content).toEqual(doc("written by another window"));
  });

  it("forgets everything on demand, so a logout leaves nothing served", () => {
    const key = draftKey(ALICE, "concord", CHANNEL);
    writeDraft(key, doc("private"));
    resetDraftCache();
    expect(readDraft(key)).toBeUndefined();
  });
});

describe("shouldRestoreDraft", () => {
  const draft: ChatDraftRow = {
    key: "k",
    content: doc("saved"),
    updatedAt: 1,
  };

  it("restores into an untouched composer", () => {
    expect(shouldRestoreDraft(draft, true)).toBe(true);
  });

  it("never clobbers what is being typed right now", () => {
    // The read is async and a channel switch is not, so the reader really can
    // start typing before the draft arrives. Theirs wins.
    expect(shouldRestoreDraft(draft, false)).toBe(false);
  });

  it("does nothing when there is no draft", () => {
    expect(shouldRestoreDraft(undefined, true)).toBe(false);
  });
});
