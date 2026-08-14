import { describe, expect, it } from "vitest";

import {
  chatExpiresAt,
  communityTimerNotice,
  expirationOf,
  formatCommunityTimer,
  isExpired,
  messageExpirationOf,
  NEVER_EXPIRING_CHAT_KINDS,
  timerNoticeSeconds,
} from "./disappearing";
import {
  KIND_DELETE,
  KIND_MESSAGE,
  KIND_REACTION,
  KIND_TIMER_NOTICE,
} from "./kinds";

const DAY = 86_400;

describe("the community timer (CORD-08 §1)", () => {
  it("reads a set timer", () => {
    expect(
      messageExpirationOf({
        name: "c",
        relays: [],
        message_expiration: 30 * DAY,
      }),
    ).toBe(30 * DAY);
  });

  it("treats absent, zero and garbage alike as OFF", () => {
    // "A reader MUST NOT guess a default from garbage."
    expect(messageExpirationOf(undefined)).toBe(0);
    expect(messageExpirationOf({ name: "c", relays: [] })).toBe(0);
    expect(
      messageExpirationOf({ name: "c", relays: [], message_expiration: 0 }),
    ).toBe(0);
    expect(
      messageExpirationOf({
        name: "c",
        relays: [],
        message_expiration: -5,
      }),
    ).toBe(0);
    expect(
      messageExpirationOf({
        name: "c",
        relays: [],
        message_expiration: NaN,
      }),
    ).toBe(0);
    expect(
      messageExpirationOf({
        name: "c",
        relays: [],
        message_expiration: "30" as unknown as number,
      }),
    ).toBe(0);
  });
});

describe("reading a rumor's own deadline (CORD-08 §3)", () => {
  it("returns undefined when there is no tag", () => {
    expect(expirationOf({ tags: [] })).toBeUndefined();
    expect(isExpired({ tags: [] }, 1_000_000)).toBe(false);
  });

  it("reads a well-formed deadline and compares inclusively", () => {
    const rumor = { tags: [["expiration", "1000"]] };
    expect(expirationOf(rumor)).toBe(1000);
    expect(isExpired(rumor, 999)).toBe(false);
    // At the boundary the message is gone, not still showing.
    expect(isExpired(rumor, 1000)).toBe(true);
    expect(isExpired(rumor, 1001)).toBe(true);
  });

  it("treats an UNREADABLE deadline as already past", () => {
    // The deliberate asymmetry with the community field, where malformed means
    // off. An author who wrote an expiration tag meant the message to
    // disappear; we cannot tell when, so we must not keep showing it.
    for (const bad of ["", "soon", "1e9", "-1", "10.5", " 100 ", "0x64"]) {
      const rumor = { tags: [["expiration", bad]] };
      expect(expirationOf(rumor)).toBe(0);
      expect(isExpired(rumor, 1)).toBe(true);
    }
  });
});

describe("stamping an outgoing rumor (CORD-08 §2)", () => {
  it("computes the deadline from the SEND time plus the timer", () => {
    expect(chatExpiresAt(KIND_MESSAGE, 1_719_800_000_417, 30 * DAY)).toBe(
      1_719_800_000 + 30 * DAY,
    );
  });

  it("stamps nothing when the timer is off", () => {
    expect(chatExpiresAt(KIND_MESSAGE, 1_719_800_000_000, 0)).toBeUndefined();
    expect(chatExpiresAt(KIND_MESSAGE, 1_719_800_000_000, -1)).toBeUndefined();
  });

  it("never stamps a delete or a timer notice", () => {
    // An expiring delete would let the message it erased come back; an expiring
    // notice would erase the record of why the history is missing.
    expect(chatExpiresAt(KIND_DELETE, 1_719_800_000_000, DAY)).toBeUndefined();
    expect(
      chatExpiresAt(KIND_TIMER_NOTICE, 1_719_800_000_000, DAY),
    ).toBeUndefined();
    expect(NEVER_EXPIRING_CHAT_KINDS.has(KIND_DELETE)).toBe(true);
    expect(NEVER_EXPIRING_CHAT_KINDS.has(KIND_TIMER_NOTICE)).toBe(true);
    // Everything else durable does expire.
    expect(NEVER_EXPIRING_CHAT_KINDS.has(KIND_MESSAGE)).toBe(false);
    expect(chatExpiresAt(KIND_REACTION, 1_719_800_000_000, DAY)).toBe(
      1_719_800_000 + DAY,
    );
  });
});

describe("the timer notice (CORD-08 §4)", () => {
  it("reads the announced value, including an explicit off", () => {
    expect(timerNoticeSeconds({ tags: [["timer", "2592000"]] })).toBe(2592000);
    expect(timerNoticeSeconds({ tags: [["timer", "0"]] })).toBe(0);
  });

  it("returns undefined for a missing or malformed tag", () => {
    // An unreadable notice must not be mistaken for "turned it off".
    expect(timerNoticeSeconds({ tags: [] })).toBeUndefined();
    expect(timerNoticeSeconds({ tags: [["timer", "off"]] })).toBeUndefined();
    expect(timerNoticeSeconds({ tags: [["timer", ""]] })).toBeUndefined();
  });

  it("renders the presets the way they were chosen", () => {
    expect(formatCommunityTimer(30 * DAY)).toBe("30 days");
    expect(formatCommunityTimer(7 * DAY)).toBe("1 week");
    expect(formatCommunityTimer(365 * DAY)).toBe("1 year");
    // A value another client set still renders sensibly.
    expect(formatCommunityTimer(3 * DAY)).toBe("3 days");
    expect(formatCommunityTimer(3600)).toBe("1 hour");
    expect(formatCommunityTimer(90)).toBe("1 minute");
  });

  it("phrases the notice from the viewer's side", () => {
    expect(communityTimerNotice(30 * DAY, true, "Alice")).toBe(
      "You set disappearing messages to 30 days.",
    );
    expect(communityTimerNotice(30 * DAY, false, "Alice")).toBe(
      "Alice set disappearing messages to 30 days.",
    );
    expect(communityTimerNotice(0, false, "Alice")).toBe(
      "Alice turned off disappearing messages.",
    );
  });
});
