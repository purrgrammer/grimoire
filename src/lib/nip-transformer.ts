import { findAndReplace } from "applesauce-content/nast";
import type { Root, Content } from "applesauce-content/nast";

/**
 * Custom node type for NIP references
 */
export interface NipNode {
  type: "nip";
  /** The NIP number/identifier (e.g., "01", "19", "C7") */
  number: string;
  /** The raw matched text (e.g., "NIP-01", "nip-19", "NIP-C7") */
  raw: string;
}

// Match NIP-xx patterns (case insensitive)
// Supports both decimal (NIP-01, NIP-19, NIP-100) and hex (NIP-C7, NIP-C0, NIP-A0)
// Pattern: 1-3 hex characters (which includes pure decimal)
const NIP_PATTERN = /\bNIP-([0-9A-Fa-f]{1,3})\b/gi;

/**
 * Check if a NIP identifier is purely decimal
 */
function isDecimalNip(nip: string): boolean {
  return /^\d+$/.test(nip);
}

/**
 * Normalize a NIP identifier:
 * - Decimal NIPs: pad to 2 digits (1 -> 01, 19 -> 19)
 * - Hex NIPs: uppercase (c7 -> C7)
 */
function normalizeNip(nip: string): string {
  if (isDecimalNip(nip)) {
    return nip.padStart(2, "0");
  }
  // Hex NIP - uppercase it
  return nip.toUpperCase();
}

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
          const normalized = normalizeNip(number);
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
