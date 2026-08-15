/**
 * Outgoing chat-plane wraps.
 *
 * These are the tags every other Concord client reads. Getting one wrong does
 * not throw here — it renders wrong, or not at all, in Armada.
 */

import { describe, expect, it, vi } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools";

import { channelGroupKey, random32, bytesToHex } from "./derive";
import {
  KIND_COMMENT,
  KIND_DELETE,
  KIND_MESSAGE,
  KIND_REACTION,
  KIND_SEAL_ENCRYPTED,
  KIND_TIMER_NOTICE,
  KIND_WRAP,
} from "./kinds";
import {
  buildChatSend,
  buildConcordCommentTags,
  SIGNER_TIMEOUT_MS,
  SignerUnresponsiveError,
} from "./send";
import { openWrap } from "./stream";
import type { Channel } from "./types";

const root = random32();
const channelId = random32();
const CHANNEL = bytesToHex(channelId);
const group = channelGroupKey(root, channelId, 3n);

const channel: Channel = {
  id: channelId,
  idHex: CHANNEL,
  name: "#general",
  isPrivate: false,
  streams: [{ epoch: 3n, group }],
  current: { epoch: 3n, group },
};

const authorSk = generateSecretKey();
const AUTHOR = getPublicKey(authorSk);
const signer = {
  signEvent: async (template: EventTemplate): Promise<NostrEvent> =>
    finalizeEvent(template, authorSk),
};

const tagValue = (tags: string[][], name: string) =>
  tags.find((t) => t[0] === name)?.[1];

describe("buildConcordCommentTags", () => {
  it("makes the parent the root when the parent is not itself a comment", () => {
    const tags = buildConcordCommentTags({
      id: "aa".repeat(32),
      kind: KIND_MESSAGE,
      pubkey: AUTHOR,
      tags: [],
    });

    expect(tagValue(tags, "K")).toBe(String(KIND_MESSAGE));
    expect(tagValue(tags, "E")).toBe("aa".repeat(32));
    expect(tagValue(tags, "P")).toBe(AUTHOR);
    // Lowercase is the IMMEDIATE parent, which at depth 1 is the same event.
    expect(tagValue(tags, "e")).toBe("aa".repeat(32));
  });

  it("inherits the root verbatim when replying to a reply", () => {
    // Without this the "root" walks one level deeper per reply, and a thread
    // silently splits into a chain of two-message threads.
    const rootId = "bb".repeat(32);
    const parentId = "cc".repeat(32);
    const grandparentAuthor = "dd".repeat(32);

    const tags = buildConcordCommentTags({
      id: parentId,
      kind: KIND_COMMENT,
      pubkey: AUTHOR,
      tags: [
        ["K", String(KIND_MESSAGE)],
        ["E", rootId, "", grandparentAuthor],
        ["P", grandparentAuthor],
      ],
    });

    expect(tagValue(tags, "E")).toBe(rootId);
    expect(tagValue(tags, "P")).toBe(grandparentAuthor);
    expect(tagValue(tags, "e")).toBe(parentId);
    expect(tagValue(tags, "p")).toBe(AUTHOR);
  });
});

describe("buildChatSend", () => {
  it("round-trips through openWrap as the author signed it", async () => {
    const built = await buildChatSend(
      { channel, pubkey: AUTHOR, content: "hello" },
      signer,
    );

    expect(built.wrap.kind).toBe(KIND_WRAP);
    // The wrap is signed by the STREAM, so it says nothing about the author.
    expect(built.wrap.pubkey).toBe(group.pk);

    const opened = openWrap(built.wrap, group);
    expect(opened.author).toBe(AUTHOR);
    expect(opened.content).toBe("hello");
    expect(opened.kind).toBe(KIND_MESSAGE);
    expect(opened.sealKind).toBe(KIND_SEAL_ENCRYPTED);
  });

  it("commits the channel and epoch binding on every rumor", async () => {
    // The binding is checked against the coordinate whose key opened the wrap.
    // A rumor without it is not "untagged" — it is undecodable.
    for (const kind of [KIND_MESSAGE, KIND_REACTION, KIND_DELETE]) {
      const built = await buildChatSend(
        {
          channel,
          pubkey: AUTHOR,
          content: "x",
          kind,
          target: "ee".repeat(32),
        },
        signer,
      );
      expect(tagValue(built.rumor.tags, "channel")).toBe(CHANNEL);
      expect(tagValue(built.rumor.tags, "epoch")).toBe("3");
    }
  });

  it("sends a reply as a kind-1111 comment, never a kind-9 with a `q`", async () => {
    // NIP-C7 reserves `q` for inline quote-replies. Conflating the two is a
    // rendering bug in every other client.
    const built = await buildChatSend(
      {
        channel,
        pubkey: AUTHOR,
        content: "replying",
        replyTo: {
          id: "aa".repeat(32),
          kind: KIND_MESSAGE,
          pubkey: AUTHOR,
          tags: [],
        },
      },
      signer,
    );

    expect(built.rumor.kind).toBe(KIND_COMMENT);
    expect(tagValue(built.rumor.tags, "q")).toBeUndefined();
    expect(tagValue(built.rumor.tags, "E")).toBe("aa".repeat(32));
  });

  it("overrides an explicit kind when replying", async () => {
    const built = await buildChatSend(
      {
        channel,
        pubkey: AUTHOR,
        content: "replying",
        kind: KIND_MESSAGE,
        replyTo: {
          id: "aa".repeat(32),
          kind: KIND_MESSAGE,
          pubkey: AUTHOR,
          tags: [],
        },
      },
      signer,
    );
    expect(built.rumor.kind).toBe(KIND_COMMENT);
  });

  it("names the reacted-to author on a reaction, and its kind on a delete", async () => {
    // Armada's split, and the plan had it wrong: `p` is a reaction's (NIP-25),
    // `k` is a delete's (NIP-09). Neither gets both.
    const target = "ee".repeat(32);
    const targetAuthor = "ff".repeat(32);

    const reaction = await buildChatSend(
      {
        channel,
        pubkey: AUTHOR,
        content: "+",
        kind: KIND_REACTION,
        target,
        targetPubkey: targetAuthor,
      },
      signer,
    );
    expect(tagValue(reaction.rumor.tags, "e")).toBe(target);
    expect(tagValue(reaction.rumor.tags, "p")).toBe(targetAuthor);
    expect(tagValue(reaction.rumor.tags, "k")).toBeUndefined();

    const del = await buildChatSend(
      {
        channel,
        pubkey: AUTHOR,
        content: "",
        kind: KIND_DELETE,
        target,
        targetKind: KIND_MESSAGE,
      },
      signer,
    );
    expect(tagValue(del.rumor.tags, "e")).toBe(target);
    expect(tagValue(del.rumor.tags, "k")).toBe(String(KIND_MESSAGE));
    expect(tagValue(del.rumor.tags, "p")).toBeUndefined();
  });

  it("puts the expiry on BOTH the rumor and the wrap", async () => {
    // CORD-08 §2. The rumor's copy is what readers enforce; the wrap's is what
    // makes the relay delete the ciphertext. One without the other leaves
    // either a message that outlives its timer or one nobody hides.
    const ms = 1_700_000_000_000;
    const built = await buildChatSend(
      { channel, pubkey: AUTHOR, content: "poof", timerSecs: 3600, ms },
      signer,
    );

    const expected = String(Math.floor(ms / 1000) + 3600);
    expect(tagValue(built.rumor.tags, "expiration")).toBe(expected);
    expect(tagValue(built.wrap.tags, "expiration")).toBe(expected);
  });

  it("never expires a delete or a timer notice", async () => {
    // A tombstone that expired before what it deletes would resurrect the
    // message; a notice that expired would make turning the timer off
    // unannounceable.
    for (const kind of [KIND_DELETE, KIND_TIMER_NOTICE]) {
      const built = await buildChatSend(
        {
          channel,
          pubkey: AUTHOR,
          content: "",
          kind,
          target: "ee".repeat(32),
          timerSecs: 3600,
        },
        signer,
      );
      expect(tagValue(built.rumor.tags, "expiration")).toBeUndefined();
      expect(tagValue(built.wrap.tags, "expiration")).toBeUndefined();
    }
  });

  it("carries sub-second ordering", async () => {
    // Two messages in the same second must still order. `ms` is what the
    // timeline sorts on; without the tag they collapse to the second.
    const built = await buildChatSend(
      { channel, pubkey: AUTHOR, content: "x", ms: 1_700_000_000_123 },
      signer,
    );
    expect(tagValue(built.rumor.tags, "ms")).toBe("123");
    expect(openWrap(built.wrap, group).ms).toBe(1_700_000_000_123);
  });

  it("appends caller tags verbatim", async () => {
    const built = await buildChatSend(
      {
        channel,
        pubkey: AUTHOR,
        content: "look :cat:",
        extraTags: [["emoji", "cat", "https://example.com/cat.png"]],
      },
      signer,
    );
    expect(built.rumor.tags).toContainEqual([
      "emoji",
      "cat",
      "https://example.com/cat.png",
    ]);
  });

  it("refuses a message past the NIP-44 plaintext cap", async () => {
    // Libraries are lenient here, and a lenient publisher mints events a strict
    // reader cannot decrypt.
    await expect(
      buildChatSend(
        { channel, pubkey: AUTHOR, content: "a".repeat(70_000) },
        signer,
      ),
    ).rejects.toThrow(/65,535/);
  });
});

describe("the signer deadline", () => {
  it("gives up on a signer that never answers, instead of hanging forever", async () => {
    // The state a dead browser extension is actually in: `signEvent` returns a
    // promise that never settles, for every kind, with no prompt and no
    // rejection. Unbounded, that is worse than a slow send — the composer has
    // already cleared, so the text is gone, and `isSending` never resets, which
    // makes the viewer swallow every later send in silence.
    vi.useFakeTimers();
    try {
      const dead = { signEvent: () => new Promise<NostrEvent>(() => {}) };
      const build = buildChatSend(
        { channel, pubkey: AUTHOR, content: "hello" },
        dead,
      );
      const settled = vi.fn();
      void build.then(settled, settled);

      await vi.advanceTimersByTimeAsync(SIGNER_TIMEOUT_MS - 1_000);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);
      await expect(build).rejects.toBeInstanceOf(SignerUnresponsiveError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a slow-but-alive signer through", async () => {
    // A NIP-46 bunker is a remote call and a human may approve it on a phone,
    // so the deadline has to be generous enough not to punish that.
    vi.useFakeTimers();
    try {
      const slow = {
        signEvent: (template: EventTemplate): Promise<NostrEvent> =>
          new Promise((resolve) => {
            setTimeout(
              () => void signer.signEvent(template).then(resolve),
              30_000,
            );
          }),
      };
      const build = buildChatSend(
        { channel, pubkey: AUTHOR, content: "hello" },
        slow,
      );
      await vi.advanceTimersByTimeAsync(31_000);
      expect((await build).rumor.content).toBe("hello");
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes a genuine signer refusal through unchanged", async () => {
    const refusing = {
      signEvent: () => Promise.reject(new Error("user rejected")),
    };
    await expect(
      buildChatSend({ channel, pubkey: AUTHOR, content: "hello" }, refusing),
    ).rejects.toThrow(/user rejected/);
  });
});
