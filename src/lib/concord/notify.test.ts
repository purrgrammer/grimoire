/**
 * Every gate, one at a time.
 *
 * These are the decisions nobody can inspect once they ship — a notification
 * that should not have fired is an interruption, and one that silently did not
 * is a message someone never saw. Each test moves exactly one field of an
 * otherwise-passing candidate.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetNotifyForTests,
  isChannelActive,
  notificationBody,
  registerActiveChannel,
  resetAnnouncedMemory,
  shouldNotify,
  unregisterActiveChannel,
  type NotifyCandidate,
  type NotifyContext,
} from "@/lib/concord/notify";

const ME = "11".repeat(32);
const THEM = "22".repeat(32);
const CHANNEL = "c1".repeat(32);

const candidate = (over: Partial<NotifyCandidate> = {}): NotifyCandidate => ({
  rumorId: `r${Math.random()}`,
  author: THEM,
  createdAt: 2000,
  isMention: false,
  channelIdHex: CHANNEL,
  ...over,
});

const context = (over: Partial<NotifyContext> = {}): NotifyContext => ({
  enabled: true,
  permissionGranted: true,
  sessionFloor: 1000,
  selfPubkey: ME,
  level: "all",
  lastRead: 0,
  visible: true,
  ...over,
});

beforeEach(() => {
  _resetNotifyForTests();
});

describe("shouldNotify", () => {
  it("fires for a fresh message from someone else", () => {
    expect(shouldNotify(candidate(), context())).toBe(true);
  });

  it("says nothing when the user never asked for notifications", () => {
    expect(shouldNotify(candidate(), context({ enabled: false }))).toBe(false);
  });

  it("says nothing without the browser's permission", () => {
    expect(
      shouldNotify(candidate(), context({ permissionGranted: false })),
    ).toBe(false);
  });

  it("ignores history — a backfill is not news", () => {
    // The guard that matters most: a week's catch-up is ingested exactly like a
    // live message and would otherwise fire a week of alerts at once.
    expect(shouldNotify(candidate({ createdAt: 900 }), context())).toBe(false);
    expect(shouldNotify(candidate({ createdAt: 1000 }), context())).toBe(false);
    expect(shouldNotify(candidate({ createdAt: 1001 }), context())).toBe(true);
  });

  it("never announces the reader's own message", () => {
    expect(shouldNotify(candidate({ author: ME }), context())).toBe(false);
  });

  it("at 'mentions', keeps quiet unless the message names you", () => {
    expect(
      shouldNotify(
        candidate({ isMention: false }),
        context({ level: "mentions" }),
      ),
    ).toBe(false);
    expect(
      shouldNotify(
        candidate({ isMention: true }),
        context({ level: "mentions" }),
      ),
    ).toBe(true);
  });

  it("at 'nothing', keeps quiet even about a mention", () => {
    expect(
      shouldNotify(
        candidate({ isMention: true }),
        context({ level: "nothing" }),
      ),
    ).toBe(false);
  });

  it("skips what the reader has already read past", () => {
    expect(
      shouldNotify(candidate({ createdAt: 2000 }), context({ lastRead: 2000 })),
    ).toBe(false);
    expect(
      shouldNotify(candidate({ createdAt: 2001 }), context({ lastRead: 2000 })),
    ).toBe(true);
  });

  it("stays quiet about the channel on screen in a visible window", () => {
    registerActiveChannel(CHANNEL);
    expect(shouldNotify(candidate(), context({ visible: true }))).toBe(false);
    // Hidden tab: the reader is not actually watching it arrive.
    expect(shouldNotify(candidate(), context({ visible: false }))).toBe(true);
  });

  it("announces a different channel while one is open", () => {
    registerActiveChannel(CHANNEL);
    expect(
      shouldNotify(candidate({ channelIdHex: "c2".repeat(32) }), context()),
    ).toBe(true);
  });

  it("announces one rumor once, however many times it is offered", () => {
    const once = candidate({ rumorId: "same" });
    expect(shouldNotify(once, context())).toBe(true);
    expect(shouldNotify(once, context())).toBe(false);
    // A re-ingest builds a fresh candidate object for the same rumor.
    expect(shouldNotify(candidate({ rumorId: "same" }), context())).toBe(false);
  });

  it("does not remember a candidate it refused", () => {
    // Refusing must not burn the id: a message suppressed because its channel
    // was on screen has to be announceable once the reader looks away.
    registerActiveChannel(CHANNEL);
    const message = candidate({ rumorId: "later" });
    expect(shouldNotify(message, context())).toBe(false);
    unregisterActiveChannel(CHANNEL);
    expect(shouldNotify(message, context())).toBe(true);
  });
});

describe("the active-channel registry", () => {
  it("is refcounted, so one window closing does not un-silence the other", () => {
    registerActiveChannel(CHANNEL);
    registerActiveChannel(CHANNEL);
    unregisterActiveChannel(CHANNEL);
    expect(isChannelActive(CHANNEL)).toBe(true);
    unregisterActiveChannel(CHANNEL);
    expect(isChannelActive(CHANNEL)).toBe(false);
  });

  it("ignores an unregister for a channel nobody opened", () => {
    unregisterActiveChannel(CHANNEL);
    expect(isChannelActive(CHANNEL)).toBe(false);
  });

  it("matches ids case-insensitively", () => {
    registerActiveChannel(CHANNEL.toUpperCase());
    expect(isChannelActive(CHANNEL)).toBe(true);
  });
});

describe("the logout door", () => {
  it("forgets what it announced, so the next account can be told", () => {
    const message = candidate({ rumorId: "shared" });
    expect(shouldNotify(message, context())).toBe(true);
    resetAnnouncedMemory();
    expect(shouldNotify(message, context())).toBe(true);
  });

  it("leaves the open windows registered", () => {
    // The registry says which channels are ON SCREEN, not who is signed in.
    // Clearing it here would tell the next ring nobody is looking at the
    // channel still in front of the reader — the one case this file suppresses.
    registerActiveChannel(CHANNEL);
    resetAnnouncedMemory();
    expect(isChannelActive(CHANNEL)).toBe(true);
  });
});

describe("notificationBody", () => {
  const npub =
    "nostr:npub1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0sjvzsu6";

  it("names a mention as a person rather than sixty characters of bech32", () => {
    expect(notificationBody(`hey ${npub} look`, 140)).toBe("hey @someone look");
  });

  it("stands a quoted note in for its pointer", () => {
    expect(notificationBody("see nostr:note1qqqsyqcyq5rq wow", 140)).toBe(
      "see [note] wow",
    );
  });

  it("shows a custom emoji's name instead of its colons", () => {
    expect(notificationBody("ship it :rocket:", 140)).toBe("ship it rocket");
  });

  it("leaves a clock time alone — 10:30:45 is not two emoji", () => {
    expect(notificationBody("standup at 10:30:45 sharp", 140)).toBe(
      "standup at 10:30:45 sharp",
    );
  });

  it("flattens the newlines an OS would swallow anyway", () => {
    expect(notificationBody("one\n\n  two   three", 140)).toBe("one two three");
  });

  it("trims after substituting, so prose is what gets cut", () => {
    // Trimming first would spend the whole budget on a URI that was about to
    // become eight characters.
    const body = notificationBody(`${npub} and then some more words`, 20);
    expect(body.startsWith("@someone and then")).toBe(true);
    expect(body.endsWith("…")).toBe(true);
  });

  it("adds no ellipsis to a message that fits", () => {
    expect(notificationBody("short", 140)).toBe("short");
  });
});
