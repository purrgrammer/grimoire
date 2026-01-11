import { describe, it, expect } from "vitest";
import { nipReferences, NipNode } from "./nip-transformer";
import type { Root, Text } from "applesauce-content/nast";

// Helper to create a basic tree with text content
function createTree(content: string): Root {
  return {
    type: "root",
    children: [{ type: "text", value: content }],
  };
}

// Helper to get all nodes of a specific type from the tree
function getNodesOfType<T>(tree: Root, type: string): T[] {
  return tree.children.filter((node) => node.type === type) as T[];
}

describe("nipReferences transformer", () => {
  describe("basic NIP patterns", () => {
    it("should parse NIP-01 format", () => {
      const tree = createTree("Check out NIP-01 for the basics");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(1);
      expect(nips[0].number).toBe("01");
      expect(nips[0].raw).toBe("NIP-01");
    });

    it("should parse lowercase nip-01 format", () => {
      const tree = createTree("See nip-01 for details");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(1);
      expect(nips[0].number).toBe("01");
      expect(nips[0].raw).toBe("nip-01");
    });

    it("should parse single digit NIP-1", () => {
      const tree = createTree("NIP-1 is important");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(1);
      expect(nips[0].number).toBe("01"); // Normalized to 2 digits
      expect(nips[0].raw).toBe("NIP-1");
    });

    it("should parse three digit NIP-100", () => {
      const tree = createTree("Future NIP-100 might exist");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(1);
      expect(nips[0].number).toBe("100");
      expect(nips[0].raw).toBe("NIP-100");
    });
  });

  describe("multiple NIPs in content", () => {
    it("should parse multiple NIP references", () => {
      const tree = createTree("NIP-01, NIP-19, and NIP-30 are related");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(3);
      expect(nips[0].number).toBe("01");
      expect(nips[1].number).toBe("19");
      expect(nips[2].number).toBe("30");
    });

    it("should preserve text between NIP references", () => {
      const tree = createTree("See NIP-01 and NIP-02");
      const transformer = nipReferences();
      transformer(tree);

      const texts = getNodesOfType<Text>(tree, "text");
      const nips = getNodesOfType<NipNode>(tree, "nip");

      expect(nips).toHaveLength(2);
      expect(texts.some((t) => t.value.includes("See "))).toBe(true);
      expect(texts.some((t) => t.value.includes(" and "))).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should not match NIP without number", () => {
      const tree = createTree("NIP- is not valid");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(0);
    });

    it("should not match partial word like SNIP-01", () => {
      const tree = createTree("SNIP-01 is not a NIP");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(0);
    });

    it("should handle NIP at start of content", () => {
      const tree = createTree("NIP-01 defines the protocol");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(1);
      expect(nips[0].number).toBe("01");
    });

    it("should handle NIP at end of content", () => {
      const tree = createTree("Check NIP-01");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(1);
      expect(nips[0].number).toBe("01");
    });

    it("should handle content with no NIPs", () => {
      const tree = createTree("Just some regular text");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(0);

      const texts = getNodesOfType<Text>(tree, "text");
      expect(texts).toHaveLength(1);
      expect(texts[0].value).toBe("Just some regular text");
    });
  });

  describe("number normalization", () => {
    it("should normalize single digit to 2 digits", () => {
      const tree = createTree("NIP-1 NIP-2 NIP-9");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips[0].number).toBe("01");
      expect(nips[1].number).toBe("02");
      expect(nips[2].number).toBe("09");
    });

    it("should preserve two digit numbers", () => {
      const tree = createTree("NIP-19 NIP-50");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips[0].number).toBe("19");
      expect(nips[1].number).toBe("50");
    });

    it("should preserve three digit numbers", () => {
      const tree = createTree("NIP-100 NIP-999");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips[0].number).toBe("100");
      expect(nips[1].number).toBe("999");
    });
  });

  describe("hex NIP support", () => {
    it("should parse hex NIP-C7", () => {
      const tree = createTree("Code snippets are defined in NIP-C7");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(1);
      expect(nips[0].number).toBe("C7");
      expect(nips[0].raw).toBe("NIP-C7");
    });

    it("should parse lowercase hex nip-c7", () => {
      const tree = createTree("See nip-c7 for code snippets");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(1);
      expect(nips[0].number).toBe("C7"); // Normalized to uppercase
      expect(nips[0].raw).toBe("nip-c7");
    });

    it("should parse NIP-C0", () => {
      const tree = createTree("NIP-C0 defines something");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(1);
      expect(nips[0].number).toBe("C0");
    });

    it("should parse NIP-A0", () => {
      const tree = createTree("Check NIP-A0");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(1);
      expect(nips[0].number).toBe("A0");
    });

    it("should handle mixed decimal and hex NIPs", () => {
      const tree = createTree("NIP-01, NIP-C7, and NIP-19 together");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(3);
      expect(nips[0].number).toBe("01");
      expect(nips[1].number).toBe("C7");
      expect(nips[2].number).toBe("19");
    });

    it("should normalize mixed case hex to uppercase", () => {
      const tree = createTree("nip-c7 NIP-C7 nip-C7 NIP-c7");
      const transformer = nipReferences();
      transformer(tree);

      const nips = getNodesOfType<NipNode>(tree, "nip");
      expect(nips).toHaveLength(4);
      expect(nips.every((n) => n.number === "C7")).toBe(true);
    });
  });
});
