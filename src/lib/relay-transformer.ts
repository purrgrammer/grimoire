import { findAndReplace } from "applesauce-content/nast";
import type { Root, Content } from "applesauce-content/nast";

/**
 * Custom node type for relay references
 */
export interface RelayNode {
  type: "relay";
  /** The relay URL (e.g., "wss://relay.example.com", "ws://localhost:7777") */
  url: string;
  /** The raw matched text */
  raw: string;
}

// Match relay URLs (wss:// or ws://)
// Pattern matches:
// - wss:// or ws:// protocol
// - hostname (domain or IP)
// - optional port
// - optional path/query/fragment
// Word boundary at start ensures we don't match mid-word
const RELAY_PATTERN =
  /\b(wss?:\/\/[a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z0-9](:[0-9]+)?(?:[/?][^\s]*)?)/gi;

/**
 * Transformer that finds relay URLs and converts them to relay nodes.
 * Compatible with applesauce-content's transformer pipeline.
 */
export function relayReferences() {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        RELAY_PATTERN,
        (full) => {
          // Cast to Content since we're extending with a custom node type
          return {
            type: "relay",
            url: full,
            raw: full,
          } as unknown as Content;
        },
      ],
    ]);
  };
}
