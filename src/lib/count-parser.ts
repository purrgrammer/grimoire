import type { NostrFilter } from "@/types/nostr";
import { parseReqCommand, type ParsedReqCommand } from "./req-parser";

/**
 * Parsed COUNT command result
 * Reuses REQ command parsing logic since filters are identical
 */
export interface ParsedCountCommand {
  filter: NostrFilter;
  relays?: string[];
  nip05Authors?: string[]; // NIP-05 identifiers that need async resolution
  nip05PTags?: string[]; // NIP-05 identifiers for #p tags that need async resolution
  nip05PTagsUppercase?: string[]; // NIP-05 identifiers for #P tags that need async resolution
  needsAccount?: boolean; // True if filter contains $me or $contacts aliases
}

/**
 * Parse COUNT command arguments into a Nostr filter
 * Identical to REQ command parsing, but without view mode or closeOnEose options
 *
 * Supports all REQ filter flags:
 * - Filters: -k (kinds), -a (authors), -l (limit), -e (events), -p (#p), -P (#P), -t (#t), -d (#d), --tag/-T (any #tag)
 * - Time: --since, --until
 * - Search: --search
 * - Relays: wss://relay.com or relay.com (auto-adds wss://)
 *
 * @example
 * parseCountCommand(['-k', '3', '-p', 'npub1...'])  // Follower count
 * parseCountCommand(['-k', '1', '-a', '$me'])       // My notes count
 * parseCountCommand(['-k', '9735', '-p', '$me', '--since', '7d'])  // Zaps received
 */
export function parseCountCommand(args: string[]): ParsedCountCommand {
  // Reuse REQ parser - it handles all the heavy lifting
  const parsed: ParsedReqCommand = parseReqCommand(args);

  // Extract only the fields relevant to COUNT
  // (view and closeOnEose are REQ-specific, ignore them)
  return {
    filter: parsed.filter,
    relays: parsed.relays,
    nip05Authors: parsed.nip05Authors,
    nip05PTags: parsed.nip05PTags,
    nip05PTagsUppercase: parsed.nip05PTagsUppercase,
    needsAccount: parsed.needsAccount,
  };
}
