import { describe, expect, it } from "vitest";

import type { Message } from "@/types/chat";
import { findDividerId } from "./unread-divider";

const ME = "11".repeat(32);
const THEM = "22".repeat(32);

function message(
  id: string,
  timestamp: number,
  author = THEM,
  type: Message["type"] = "user",
): Message {
  return {
    id,
    conversationId: "c",
    author,
    content: id,
    timestamp,
    type,
    protocol: "concord",
    event: {} as Message["event"],
  };
}

describe("findDividerId", () => {
  it("shows nothing in a channel the reader has never opened", () => {
    // Flagging the whole history of a channel someone just joined is noise.
    const messages = [message("a", 10), message("b", 20)];
    expect(findDividerId(messages, 0, ME)).toBe(undefined);
  });

  it("points at the first message after the stamp", () => {
    const messages = [message("a", 10), message("b", 20), message("c", 30)];
    expect(findDividerId(messages, 15, ME)).toBe("b");
  });

  it("treats a message dated exactly at the stamp as read", () => {
    const messages = [message("a", 20), message("b", 21)];
    expect(findDividerId(messages, 20, ME)).toBe("b");
  });

  it("skips past the reader's own messages", () => {
    const messages = [message("a", 20, ME), message("b", 21, THEM)];
    expect(findDividerId(messages, 10, ME)).toBe("b");
  });

  it("skips a system message", () => {
    const messages = [message("a", 20, THEM, "system"), message("b", 21, THEM)];
    expect(findDividerId(messages, 10, ME)).toBe("b");
  });

  it("shows nothing when everything loaded is already read", () => {
    const messages = [message("a", 10), message("b", 20)];
    expect(findDividerId(messages, 30, ME)).toBe(undefined);
  });

  it("shows nothing when the only unread messages are the reader's own", () => {
    const messages = [message("a", 30, ME)];
    expect(findDividerId(messages, 10, ME)).toBe(undefined);
  });
});
