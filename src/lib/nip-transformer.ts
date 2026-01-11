import { findAndReplace } from "applesauce-content/nast";
import type { Root, Content } from "applesauce-content/nast";

/**
 * Custom node type for NIP references
 */
export interface NipNode {
  type: "nip";
  /** The NIP number (e.g., "01", "19", "30") */
  number: string;
  /** The raw matched text (e.g., "NIP-01", "nip-19") */
  raw: string;
}

// Match NIP-xx patterns (case insensitive, 1-3 digits)
// Supports: NIP-01, NIP-1, nip-19, NIP-100, etc.
const NIP_PATTERN = /\bNIP-(\d{1,3})\b/gi;

/**
 * Transformer that finds NIP-xx references and converts them to nip nodes.
 * Compatible with applesauce-content's transformer pipeline.
 */
export function nipReferences() {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        NIP_PATTERN,
        (full, number) => {
          // Normalize to 2 digits with leading zero for consistency
          const normalized = number.padStart(2, "0");
          // Cast to Content since we're extending with a custom node type
          return {
            type: "nip",
            number: normalized,
            raw: full,
          } as unknown as Content;
        },
      ],
    ]);
  };
}
