import { nip19 } from "nostr-tools";
import { isNip05, resolveNip05 } from "./nip05";
import {
  isValidHexPubkey,
  isValidHexEventId,
  normalizeHex,
} from "./nostr-validation";
import { normalizeRelayURL } from "./relay-url";
import type { EventPointer, AddressPointer } from "./open-parser";

export interface ParsedZapCommand {
  /** Recipient pubkey (who receives the zap) */
  recipientPubkey: string;
  /** Optional event being zapped (adds context to the zap) */
  eventPointer?: EventPointer | AddressPointer;
}

/**
 * Parse ZAP command arguments
 *
 * Supports:
 * - `zap <profile>` - Zap a person
 * - `zap <event>` - Zap an event (recipient derived from event author)
 * - `zap <profile> <event>` - Zap a specific person for a specific event
 *
 * Profile formats: npub, nprofile, hex pubkey, user@domain.com, $me
 * Event formats: note, nevent, naddr, hex event ID
 */
export async function parseZapCommand(
  args: string[],
  activeAccountPubkey?: string,
): Promise<ParsedZapCommand> {
  if (args.length === 0) {
    throw new Error(
      "Recipient or event required. Usage: zap <profile> or zap <event> or zap <profile> <event>",
    );
  }

  const firstArg = args[0];
  const secondArg = args[1];

  // Case 1: Two arguments - zap <profile> <event>
  if (secondArg) {
    const recipientPubkey = await parseProfile(firstArg, activeAccountPubkey);
    const eventPointer = parseEventPointer(secondArg);
    return { recipientPubkey, eventPointer };
  }

  // Case 2: One argument - try event first, then profile
  // Events have more specific patterns (nevent, naddr, note)
  const eventPointer = tryParseEventPointer(firstArg);
  if (eventPointer) {
    // For events, we'll need to fetch the event to get the author
    // For now, we'll return a placeholder and let the component fetch it
    return {
      recipientPubkey: "", // Will be filled in by component from event author
      eventPointer,
    };
  }

  // Must be a profile
  const recipientPubkey = await parseProfile(firstArg, activeAccountPubkey);
  return { recipientPubkey };
}

/**
 * Parse a profile identifier into a pubkey
 */
async function parseProfile(
  identifier: string,
  activeAccountPubkey?: string,
): Promise<string> {
  // Handle $me alias
  if (identifier.toLowerCase() === "$me") {
    if (!activeAccountPubkey) {
      throw new Error("No active account. Please log in to use $me alias.");
    }
    return activeAccountPubkey;
  }

  // Try bech32 decode (npub, nprofile)
  if (identifier.startsWith("npub") || identifier.startsWith("nprofile")) {
    try {
      const decoded = nip19.decode(identifier);
      if (decoded.type === "npub") {
        return decoded.data;
      }
      if (decoded.type === "nprofile") {
        return decoded.data.pubkey;
      }
    } catch (error) {
      throw new Error(`Invalid npub/nprofile: ${error}`);
    }
  }

  // Check if it's a hex pubkey
  if (isValidHexPubkey(identifier)) {
    return normalizeHex(identifier);
  }

  // Check if it's a NIP-05 identifier
  if (isNip05(identifier)) {
    const pubkey = await resolveNip05(identifier);
    if (!pubkey) {
      throw new Error(`Failed to resolve NIP-05 identifier: ${identifier}`);
    }
    return pubkey;
  }

  throw new Error(
    `Invalid profile identifier: ${identifier}. Supported: npub, nprofile, hex pubkey, user@domain.com`,
  );
}

/**
 * Parse an event identifier into a pointer
 */
function parseEventPointer(identifier: string): EventPointer | AddressPointer {
  const result = tryParseEventPointer(identifier);
  if (!result) {
    throw new Error(
      `Invalid event identifier: ${identifier}. Supported: note, nevent, naddr, hex ID`,
    );
  }
  return result;
}

/**
 * Try to parse an event identifier, returning null if it doesn't match event patterns
 */
function tryParseEventPointer(
  identifier: string,
): EventPointer | AddressPointer | null {
  // Try bech32 decode (note, nevent, naddr)
  if (
    identifier.startsWith("note") ||
    identifier.startsWith("nevent") ||
    identifier.startsWith("naddr")
  ) {
    try {
      const decoded = nip19.decode(identifier);

      if (decoded.type === "note") {
        return { id: decoded.data };
      }

      if (decoded.type === "nevent") {
        return {
          ...decoded.data,
          relays: decoded.data.relays
            ?.map((url) => {
              try {
                return normalizeRelayURL(url);
              } catch {
                return null;
              }
            })
            .filter((url): url is string => url !== null),
        };
      }

      if (decoded.type === "naddr") {
        return {
          ...decoded.data,
          relays: decoded.data.relays
            ?.map((url) => {
              try {
                return normalizeRelayURL(url);
              } catch {
                return null;
              }
            })
            .filter((url): url is string => url !== null),
        };
      }
    } catch {
      return null;
    }
  }

  // Check if it's a hex event ID
  if (isValidHexEventId(identifier)) {
    return { id: normalizeHex(identifier) };
  }

  return null;
}
