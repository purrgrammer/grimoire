import { findAndReplace } from "applesauce-content/nast";
import type { Root, Content } from "applesauce-content/nast";
import { nip19 } from "nostr-tools";

/**
 * Custom node type for nostr mentions
 */
export interface NostrMentionNode {
  type: "mention";
  /** The decoded nip19 entity */
  decoded?: {
    type: string;
    data: any;
  };
  /** The original encoded string (without nostr: prefix) */
  encoded?: string;
  /** The raw matched text (including nostr: prefix) */
  raw: string;
}

/**
 * Match nostr: URIs with proper word boundaries and length constraints
 *
 * Pattern explanation:
 * - \bnostr: - word boundary + nostr: prefix
 * - Two alternatives:
 *   1. (npub1|note1)[bech32]{58} - fixed-length identifiers (32-byte pubkey/event ID)
 *   2. (nprofile1|nevent1|naddr1)[bech32]{40,300} - variable-length TLV-encoded identifiers
 * - [023456789acdefghjklmnpqrstuvwxyz] - bech32 character set (excludes 1, b, i, o)
 *
 * Length constraints prevent matching too many characters when text immediately follows:
 * - "nostr:npub1...{58 chars}how" will match only the 63-char npub, not including "how"
 * - This works because npub/note are always exactly 63 chars (including prefix)
 * - Other types are TLV-encoded and vary, but typically 100-200 chars
 */
const NOSTR_MENTION_PATTERN =
  /\bnostr:((?:(?:npub1|note1)[023456789acdefghjklmnpqrstuvwxyz]{58})|(?:(?:nprofile1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]{40,300}))/gi;

/**
 * Transformer that finds nostr: mentions and converts them to mention nodes.
 * Compatible with applesauce-content's transformer pipeline.
 *
 * This transformer runs BEFORE the default textNoteTransformers to handle
 * edge cases where mentions are immediately followed by text without whitespace.
 */
export function nostrMentionReferences() {
  return (tree: Root) => {
    findAndReplace(tree, [
      [
        NOSTR_MENTION_PATTERN,
        (full, encoded) => {
          try {
            // Decode the nip19 identifier
            const decoded = nip19.decode(encoded);

            // Return a mention node with decoded data
            return {
              type: "mention",
              decoded: {
                type: decoded.type,
                data: decoded.data,
              },
              encoded,
              raw: full,
            } as unknown as Content;
          } catch (error) {
            // If decode fails, return as plain text
            console.warn(
              `[nostr-mention-transformer] Failed to decode ${encoded}:`,
              error,
            );
            return {
              type: "text",
              value: full,
            } as unknown as Content;
          }
        },
      ],
    ]);
  };
}
