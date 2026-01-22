import { describe, it, expect } from "vitest";
import {
  groupSystemMessages,
  isGroupedSystemMessage,
  type GroupedSystemMessage,
} from "./group-system-messages";
import type { Message } from "@/types/chat";

// Helper to create test messages
function createMessage(
  id: string,
  type: Message["type"],
  content: string,
  author: string,
  timestamp: number,
): Message {
  return {
    id,
    conversationId: "test-conversation",
    author,
    content,
    timestamp,
    type,
    protocol: "nip-10",
    event: {} as any, // Mock event
  };
}

describe("groupSystemMessages", () => {
  describe("basic grouping", () => {
    it("should group consecutive system messages with same content", () => {
      const messages: Message[] = [
        createMessage("1", "system", "reposted", "alice", 1000),
        createMessage("2", "system", "reposted", "bob", 1001),
        createMessage("3", "system", "reposted", "charlie", 1002),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(1);
      expect(isGroupedSystemMessage(result[0])).toBe(true);

      const group = result[0] as GroupedSystemMessage;
      expect(group.authors).toEqual(["alice", "bob", "charlie"]);
      expect(group.content).toBe("reposted");
      expect(group.timestamp).toBe(1000);
      expect(group.messageIds).toEqual(["1", "2", "3"]);
    });

    it("should not group non-consecutive system messages", () => {
      const messages: Message[] = [
        createMessage("1", "system", "reposted", "alice", 1000),
        createMessage("2", "user", "hello", "bob", 1001),
        createMessage("3", "system", "reposted", "charlie", 1002),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(3);

      // First group (alice)
      expect(isGroupedSystemMessage(result[0])).toBe(true);
      const group1 = result[0] as GroupedSystemMessage;
      expect(group1.authors).toEqual(["alice"]);

      // User message (bob)
      expect(isGroupedSystemMessage(result[1])).toBe(false);
      expect((result[1] as Message).id).toBe("2");

      // Second group (charlie)
      expect(isGroupedSystemMessage(result[2])).toBe(true);
      const group2 = result[2] as GroupedSystemMessage;
      expect(group2.authors).toEqual(["charlie"]);
    });

    it("should not group system messages with different content", () => {
      const messages: Message[] = [
        createMessage("1", "system", "reposted", "alice", 1000),
        createMessage("2", "system", "joined", "bob", 1001),
        createMessage("3", "system", "reposted", "charlie", 1002),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(3);

      // Each should be its own group
      expect(isGroupedSystemMessage(result[0])).toBe(true);
      expect((result[0] as GroupedSystemMessage).content).toBe("reposted");
      expect((result[0] as GroupedSystemMessage).authors).toEqual(["alice"]);

      expect(isGroupedSystemMessage(result[1])).toBe(true);
      expect((result[1] as GroupedSystemMessage).content).toBe("joined");
      expect((result[1] as GroupedSystemMessage).authors).toEqual(["bob"]);

      expect(isGroupedSystemMessage(result[2])).toBe(true);
      expect((result[2] as GroupedSystemMessage).content).toBe("reposted");
      expect((result[2] as GroupedSystemMessage).authors).toEqual(["charlie"]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty array", () => {
      const result = groupSystemMessages([]);
      expect(result).toEqual([]);
    });

    it("should handle single system message", () => {
      const messages: Message[] = [
        createMessage("1", "system", "reposted", "alice", 1000),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(1);
      expect(isGroupedSystemMessage(result[0])).toBe(true);

      const group = result[0] as GroupedSystemMessage;
      expect(group.authors).toEqual(["alice"]);
      expect(group.messageIds).toEqual(["1"]);
    });

    it("should handle single user message", () => {
      const messages: Message[] = [
        createMessage("1", "user", "hello", "alice", 1000),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(1);
      expect(isGroupedSystemMessage(result[0])).toBe(false);
      expect((result[0] as Message).id).toBe("1");
    });

    it("should handle only user messages", () => {
      const messages: Message[] = [
        createMessage("1", "user", "hello", "alice", 1000),
        createMessage("2", "user", "world", "bob", 1001),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(2);
      expect(isGroupedSystemMessage(result[0])).toBe(false);
      expect(isGroupedSystemMessage(result[1])).toBe(false);
    });

    it("should handle only system messages", () => {
      const messages: Message[] = [
        createMessage("1", "system", "joined", "alice", 1000),
        createMessage("2", "system", "joined", "bob", 1001),
        createMessage("3", "system", "joined", "charlie", 1002),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(1);
      expect(isGroupedSystemMessage(result[0])).toBe(true);

      const group = result[0] as GroupedSystemMessage;
      expect(group.authors).toEqual(["alice", "bob", "charlie"]);
    });
  });

  describe("mixed message types", () => {
    it("should not group system messages separated by user messages", () => {
      const messages: Message[] = [
        createMessage("1", "system", "reposted", "alice", 1000),
        createMessage("2", "system", "reposted", "bob", 1001),
        createMessage("3", "user", "hello", "charlie", 1002),
        createMessage("4", "system", "reposted", "dave", 1003),
        createMessage("5", "system", "reposted", "eve", 1004),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(3);

      // First group (alice, bob)
      expect(isGroupedSystemMessage(result[0])).toBe(true);
      expect((result[0] as GroupedSystemMessage).authors).toEqual([
        "alice",
        "bob",
      ]);

      // User message (charlie)
      expect(isGroupedSystemMessage(result[1])).toBe(false);
      expect((result[1] as Message).id).toBe("3");

      // Second group (dave, eve)
      expect(isGroupedSystemMessage(result[2])).toBe(true);
      expect((result[2] as GroupedSystemMessage).authors).toEqual([
        "dave",
        "eve",
      ]);
    });

    it("should not group system messages separated by zap messages", () => {
      const messages: Message[] = [
        createMessage("1", "system", "reposted", "alice", 1000),
        createMessage("2", "zap", "zapped 1000 sats", "bob", 1001),
        createMessage("3", "system", "reposted", "charlie", 1002),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(3);

      expect(isGroupedSystemMessage(result[0])).toBe(true);
      expect((result[0] as GroupedSystemMessage).authors).toEqual(["alice"]);

      expect(isGroupedSystemMessage(result[1])).toBe(false);
      expect((result[1] as Message).type).toBe("zap");

      expect(isGroupedSystemMessage(result[2])).toBe(true);
      expect((result[2] as GroupedSystemMessage).authors).toEqual(["charlie"]);
    });

    it("should handle complex alternating pattern", () => {
      const messages: Message[] = [
        createMessage("1", "system", "joined", "alice", 1000),
        createMessage("2", "system", "joined", "bob", 1001),
        createMessage("3", "user", "hello", "alice", 1002),
        createMessage("4", "system", "reposted", "charlie", 1003),
        createMessage("5", "user", "world", "bob", 1004),
        createMessage("6", "system", "left", "dave", 1005),
        createMessage("7", "system", "left", "eve", 1006),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(5);

      // joined group
      expect(isGroupedSystemMessage(result[0])).toBe(true);
      expect((result[0] as GroupedSystemMessage).content).toBe("joined");
      expect((result[0] as GroupedSystemMessage).authors).toEqual([
        "alice",
        "bob",
      ]);

      // user message
      expect(isGroupedSystemMessage(result[1])).toBe(false);

      // reposted group (single)
      expect(isGroupedSystemMessage(result[2])).toBe(true);
      expect((result[2] as GroupedSystemMessage).content).toBe("reposted");
      expect((result[2] as GroupedSystemMessage).authors).toEqual(["charlie"]);

      // user message
      expect(isGroupedSystemMessage(result[3])).toBe(false);

      // left group
      expect(isGroupedSystemMessage(result[4])).toBe(true);
      expect((result[4] as GroupedSystemMessage).content).toBe("left");
      expect((result[4] as GroupedSystemMessage).authors).toEqual([
        "dave",
        "eve",
      ]);
    });
  });

  describe("timestamp preservation", () => {
    it("should use first message timestamp in group", () => {
      const messages: Message[] = [
        createMessage("1", "system", "reposted", "alice", 1000),
        createMessage("2", "system", "reposted", "bob", 2000),
        createMessage("3", "system", "reposted", "charlie", 3000),
      ];

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(1);
      const group = result[0] as GroupedSystemMessage;
      expect(group.timestamp).toBe(1000); // Should be first message timestamp
    });
  });

  describe("large groups", () => {
    it("should handle large groups efficiently", () => {
      const messages: Message[] = [];
      for (let i = 0; i < 100; i++) {
        messages.push(
          createMessage(`${i}`, "system", "reposted", `user${i}`, 1000 + i),
        );
      }

      const result = groupSystemMessages(messages);

      expect(result).toHaveLength(1);
      const group = result[0] as GroupedSystemMessage;
      expect(group.authors).toHaveLength(100);
      expect(group.messageIds).toHaveLength(100);
    });
  });
});

describe("isGroupedSystemMessage", () => {
  it("should return true for valid grouped system message", () => {
    const group: GroupedSystemMessage = {
      authors: ["alice", "bob"],
      content: "reposted",
      timestamp: 1000,
      messageIds: ["1", "2"],
    };

    expect(isGroupedSystemMessage(group)).toBe(true);
  });

  it("should return false for regular message", () => {
    const message: Message = createMessage("1", "user", "hello", "alice", 1000);

    expect(isGroupedSystemMessage(message)).toBe(false);
  });

  it("should return false for null", () => {
    expect(isGroupedSystemMessage(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isGroupedSystemMessage(undefined)).toBe(false);
  });

  it("should return false for non-object types", () => {
    expect(isGroupedSystemMessage("string")).toBe(false);
    expect(isGroupedSystemMessage(123)).toBe(false);
    expect(isGroupedSystemMessage(true)).toBe(false);
  });

  it("should return false for objects missing required fields", () => {
    expect(isGroupedSystemMessage({})).toBe(false);
    expect(isGroupedSystemMessage({ authors: [] })).toBe(false);
    expect(isGroupedSystemMessage({ authors: [], content: "test" })).toBe(
      false,
    );
  });

  it("should return false if authors is not an array", () => {
    expect(
      isGroupedSystemMessage({
        authors: "alice",
        content: "reposted",
        timestamp: 1000,
        messageIds: ["1"],
      }),
    ).toBe(false);
  });

  it("should return false if authors array is empty", () => {
    expect(
      isGroupedSystemMessage({
        authors: [],
        content: "reposted",
        timestamp: 1000,
        messageIds: [],
      }),
    ).toBe(false);
  });

  it("should return false if messageIds is not an array", () => {
    expect(
      isGroupedSystemMessage({
        authors: ["alice"],
        content: "reposted",
        timestamp: 1000,
        messageIds: "1",
      }),
    ).toBe(false);
  });

  it("should return false if messageIds array is empty", () => {
    expect(
      isGroupedSystemMessage({
        authors: ["alice"],
        content: "reposted",
        timestamp: 1000,
        messageIds: [],
      }),
    ).toBe(false);
  });

  it("should return false if authors and messageIds length mismatch", () => {
    expect(
      isGroupedSystemMessage({
        authors: ["alice", "bob"],
        content: "reposted",
        timestamp: 1000,
        messageIds: ["1"], // Only 1 ID for 2 authors
      }),
    ).toBe(false);
  });

  it("should return false if content is not a string", () => {
    expect(
      isGroupedSystemMessage({
        authors: ["alice"],
        content: 123,
        timestamp: 1000,
        messageIds: ["1"],
      }),
    ).toBe(false);
  });

  it("should return false if timestamp is not a number", () => {
    expect(
      isGroupedSystemMessage({
        authors: ["alice"],
        content: "reposted",
        timestamp: "1000",
        messageIds: ["1"],
      }),
    ).toBe(false);
  });
});
