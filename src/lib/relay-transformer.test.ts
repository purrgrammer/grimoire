import { describe, it, expect } from "vitest";
import { relayReferences, RelayNode } from "./relay-transformer";
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

describe("relayReferences transformer", () => {
  describe("basic relay patterns", () => {
    it("should parse wss:// relay URL", () => {
      const tree = createTree("Check out wss://relay.example.com for events");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.example.com");
      expect(relays[0].raw).toBe("wss://relay.example.com");
    });

    it("should parse ws:// relay URL", () => {
      const tree = createTree("Local relay at ws://localhost:7777");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("ws://localhost:7777");
    });

    it("should parse relay URL with trailing slash", () => {
      const tree = createTree("Connect to wss://relay.damus.io/");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.damus.io/");
    });

    it("should parse relay URL with path", () => {
      const tree = createTree("Try wss://relay.example.com/some/path");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.example.com/some/path");
    });

    it("should parse relay URL with query params", () => {
      const tree = createTree("wss://relay.example.com?param=value");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.example.com?param=value");
    });
  });

  describe("relay URL formats", () => {
    it("should parse relay with subdomain", () => {
      const tree = createTree("wss://nostr.relay.example.com");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://nostr.relay.example.com");
    });

    it("should parse relay with port", () => {
      const tree = createTree("wss://relay.example.com:443");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.example.com:443");
    });

    it("should parse relay with non-standard port", () => {
      const tree = createTree("ws://localhost:8080");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("ws://localhost:8080");
    });

    it("should parse relay with IP address", () => {
      const tree = createTree("wss://192.168.1.100");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://192.168.1.100");
    });

    it("should parse relay with IP and port", () => {
      const tree = createTree("ws://127.0.0.1:7777");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("ws://127.0.0.1:7777");
    });
  });

  describe("multiple relays in content", () => {
    it("should parse multiple relay URLs", () => {
      const tree = createTree(
        "wss://relay.damus.io and wss://nos.lol are good relays",
      );
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(2);
      expect(relays[0].url).toBe("wss://relay.damus.io");
      expect(relays[1].url).toBe("wss://nos.lol");
    });

    it("should preserve text between relay URLs", () => {
      const tree = createTree("Try wss://relay.damus.io or wss://nos.lol");
      const transformer = relayReferences();
      transformer(tree);

      const texts = getNodesOfType<Text>(tree, "text");
      const relays = getNodesOfType<RelayNode>(tree, "relay");

      expect(relays).toHaveLength(2);
      expect(texts.some((t) => t.value.includes("Try "))).toBe(true);
      expect(texts.some((t) => t.value.includes(" or "))).toBe(true);
    });

    it("should parse relay list with commas", () => {
      const tree = createTree(
        "wss://relay.damus.io, wss://nos.lol, wss://relay.snort.social",
      );
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(3);
      expect(relays[0].url).toBe("wss://relay.damus.io");
      expect(relays[1].url).toBe("wss://nos.lol");
      expect(relays[2].url).toBe("wss://relay.snort.social");
    });
  });

  describe("edge cases", () => {
    it("should handle relay at start of content", () => {
      const tree = createTree("wss://relay.damus.io is a great relay");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.damus.io");
    });

    it("should handle relay at end of content", () => {
      const tree = createTree("Connect to wss://relay.damus.io");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.damus.io");
    });

    it("should handle content with no relays", () => {
      const tree = createTree("Just some regular text");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(0);

      const texts = getNodesOfType<Text>(tree, "text");
      expect(texts).toHaveLength(1);
      expect(texts[0].value).toBe("Just some regular text");
    });

    it("should handle relay in parentheses", () => {
      const tree = createTree("Try this relay (wss://relay.damus.io)");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.damus.io");
    });

    it("should handle relay in quotes", () => {
      const tree = createTree('Use "wss://relay.damus.io" for events');
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.damus.io");
    });

    it("should not match incomplete protocol", () => {
      const tree = createTree("wss:// is not complete");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(0);
    });

    it("should not match http:// URLs", () => {
      const tree = createTree("http://example.com is not a relay");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(0);
    });

    it("should not match https:// URLs", () => {
      const tree = createTree("https://example.com is not a relay");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(0);
    });
  });

  describe("special relay formats", () => {
    it("should parse relay with dashes in domain", () => {
      const tree = createTree("wss://nostr-relay.example.com");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://nostr-relay.example.com");
    });

    it("should parse relay with complex path", () => {
      const tree = createTree("wss://relay.example.com/nostr/v1/ws");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.example.com/nostr/v1/ws");
    });

    it("should parse relay with hash fragment", () => {
      const tree = createTree("wss://relay.example.com#main");
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(1);
      expect(relays[0].url).toBe("wss://relay.example.com");
    });

    it("should handle mixed ws:// and wss:// in same content", () => {
      const tree = createTree(
        "Use wss://relay.damus.io for production and ws://localhost:7777 for testing",
      );
      const transformer = relayReferences();
      transformer(tree);

      const relays = getNodesOfType<RelayNode>(tree, "relay");
      expect(relays).toHaveLength(2);
      expect(relays[0].url).toBe("wss://relay.damus.io");
      expect(relays[1].url).toBe("ws://localhost:7777");
    });
  });

  describe("real-world relay URLs", () => {
    it("should parse popular relay URLs", () => {
      const relayUrls = [
        "wss://relay.damus.io",
        "wss://nos.lol",
        "wss://relay.snort.social",
        "wss://relay.primal.net",
        "wss://nostr.wine",
      ];

      for (const url of relayUrls) {
        const tree = createTree(`Connect to ${url}`);
        const transformer = relayReferences();
        transformer(tree);

        const relays = getNodesOfType<RelayNode>(tree, "relay");
        expect(relays).toHaveLength(1);
        expect(relays[0].url).toBe(url);
      }
    });
  });
});
