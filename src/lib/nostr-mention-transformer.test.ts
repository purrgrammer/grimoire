import { describe, it, expect } from "vitest";
import { nostrMentionReferences } from "./nostr-mention-transformer";
import type { Root } from "applesauce-content/nast";

/**
 * Helper to create a simple text tree for testing
 */
function createTextTree(content: string): Root {
  return {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            value: content,
          },
        ],
      } as any, // Type assertion needed for test setup
    ],
  };
}

/**
 * Helper to extract text and mention nodes from a transformed tree
 */
function extractNodes(
  tree: Root,
): Array<{ type: string; value?: string; decoded?: any }> {
  const results: Array<{ type: string; value?: string; decoded?: any }> = [];

  for (const child of tree.children as any[]) {
    if (child.type === "paragraph" && "children" in child) {
      for (const node of child.children) {
        if (node.type === "text" && "value" in node) {
          results.push({ type: "text", value: node.value as string });
        } else if (node.type === "mention" && "decoded" in node) {
          results.push({ type: "mention", decoded: node.decoded });
        }
      }
    }
  }

  return results;
}

describe("nostrMentionReferences", () => {
  describe("npub mentions", () => {
    it("should parse npub mention with space after", () => {
      const tree = createTextTree(
        "Hello nostr:npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg world",
      );
      const transformer = nostrMentionReferences();
      transformer(tree);

      const nodes = extractNodes(tree);
      expect(nodes).toHaveLength(3);
      expect(nodes[0]).toEqual({ type: "text", value: "Hello " });
      expect(nodes[1].type).toBe("mention");
      expect(nodes[1].decoded?.type).toBe("npub");
      expect(nodes[2]).toEqual({ type: "text", value: " world" });
    });

    it("should parse npub mention immediately followed by text without space", () => {
      // This is the bug case from the issue - npub followed by "how" without space
      const tree = createTextTree(
        "nostr:npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxghow does the COUNT work?",
      );
      const transformer = nostrMentionReferences();
      transformer(tree);

      const nodes = extractNodes(tree);
      expect(nodes).toHaveLength(2);
      expect(nodes[0].type).toBe("mention");
      expect(nodes[0].decoded?.type).toBe("npub");
      // The "how does the COUNT work?" should remain as text
      expect(nodes[1]).toEqual({
        type: "text",
        value: "how does the COUNT work?",
      });
    });

    it("should parse npub mention followed by punctuation", () => {
      const tree = createTextTree(
        "Check out nostr:npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg!",
      );
      const transformer = nostrMentionReferences();
      transformer(tree);

      const nodes = extractNodes(tree);
      expect(nodes).toHaveLength(3);
      expect(nodes[0]).toEqual({ type: "text", value: "Check out " });
      expect(nodes[1].type).toBe("mention");
      expect(nodes[1].decoded?.type).toBe("npub");
      expect(nodes[2]).toEqual({ type: "text", value: "!" });
    });

    it("should not match nostr: without valid prefix", () => {
      const tree = createTextTree("nostr:invalid123");
      const transformer = nostrMentionReferences();
      transformer(tree);

      const nodes = extractNodes(tree);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toEqual({ type: "text", value: "nostr:invalid123" });
    });
  });

  describe("note mentions", () => {
    it("should fallback to text for invalid note mention (wrong checksum)", () => {
      // Note with invalid checksum will be matched by pattern but fail decode, falling back to text
      const tree = createTextTree(
        "See nostr:note1q9m4f9qx3p2l8zq3xz9h3whxuc2h69k2xy6x5agdchp3upynhsxqqdhcxs test",
      );
      const transformer = nostrMentionReferences();
      transformer(tree);

      const nodes = extractNodes(tree);
      // Pattern matches, but decode fails, so matched text + surrounding text remain
      expect(nodes).toHaveLength(3);
      expect(nodes[0]).toEqual({ type: "text", value: "See " });
      expect(nodes[1].type).toBe("text"); // Failed mention becomes text
      expect(nodes[1].value).toContain("nostr:note1");
      expect(nodes[2]).toEqual({ type: "text", value: " test" });
    });
  });

  describe("nevent mentions", () => {
    it("should not parse nevent that is too short", () => {
      // nevent that's less than 40 chars after prefix won't match our pattern
      const tree = createTextTree("Check nostr:nevent1short");
      const transformer = nostrMentionReferences();
      transformer(tree);

      const nodes = extractNodes(tree);
      // Should remain as text because nevent is too short
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toEqual({
        type: "text",
        value: "Check nostr:nevent1short",
      });
    });
  });

  describe("multiple mentions", () => {
    it("should parse multiple mentions in one string", () => {
      const tree = createTextTree(
        "nostr:npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg and nostr:npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg!",
      );
      const transformer = nostrMentionReferences();
      transformer(tree);

      const nodes = extractNodes(tree);
      // Should have: mention, text(" and "), mention, text("!")
      expect(nodes.length).toBe(4);
      expect(nodes[0].type).toBe("mention");
      expect(nodes[1]).toEqual({ type: "text", value: " and " });
      expect(nodes[2].type).toBe("mention");
      expect(nodes[3]).toEqual({ type: "text", value: "!" });
    });
  });

  describe("edge cases", () => {
    it("should not match nostr: in middle of word", () => {
      const tree = createTextTree(
        "testnostr:npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg",
      );
      const transformer = nostrMentionReferences();
      transformer(tree);

      const nodes = extractNodes(tree);
      // Should remain as text because no word boundary before nostr:
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toEqual({
        type: "text",
        value:
          "testnostr:npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg",
      });
    });

    it("should handle mention at start of string", () => {
      const tree = createTextTree(
        "nostr:npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg",
      );
      const transformer = nostrMentionReferences();
      transformer(tree);

      const nodes = extractNodes(tree);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("mention");
    });

    it("should handle mention at end of string", () => {
      const tree = createTextTree(
        "Check out nostr:npub107jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2quqncxg",
      );
      const transformer = nostrMentionReferences();
      transformer(tree);

      const nodes = extractNodes(tree);
      expect(nodes).toHaveLength(2);
      expect(nodes[0]).toEqual({ type: "text", value: "Check out " });
      expect(nodes[1].type).toBe("mention");
    });
  });
});
