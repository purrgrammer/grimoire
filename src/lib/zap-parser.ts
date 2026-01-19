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
  /** Optional event being zapped - regular events (e-tag) */
  eventPointer?: EventPointer;
  /** Optional addressable event being zapped - replaceable events (a-tag) */
  addressPointer?: AddressPointer;
  /**
   * Custom tags to include in the zap request
   * Used for protocol-specific tagging like NIP-53 live activity references
   */
  customTags?: string[][];
  /** Relays where the zap receipt should be published */
  relays?: string[];
}

/**
 * Parse ZAP command arguments
 *
 * Supports:
 * - `zap <profile>` - Zap a person
 * - `zap <event>` - Zap an event (recipient derived from event author)
 * - `zap <profile> <event>` - Zap a specific person for a specific event
 *
 * Options:
 * - `-T, --tag <type> <value> [relay]` - Add custom tag (can be repeated)
 * - `-r, --relay <url>` - Add relay for zap receipt publication (can be repeated)
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

  // Parse flags and positional args
  const positionalArgs: string[] = [];
  const customTags: string[][] = [];
  const relays: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-T" || arg === "--tag") {
      // Parse tag: -T <type> <value> [relay-hint]
      // Minimum 2 values after -T (type and value), optional relay hint
      const tagType = args[i + 1];
      const tagValue = args[i + 2];

      if (!tagType || !tagValue) {
        throw new Error(
          "Tag requires at least 2 arguments: -T <type> <value> [relay-hint]",
        );
      }

      // Build tag array
      const tag = [tagType, tagValue];

      // Check if next arg is a relay hint (starts with ws:// or wss://)
      const potentialRelay = args[i + 3];
      if (
        potentialRelay &&
        (potentialRelay.startsWith("ws://") ||
          potentialRelay.startsWith("wss://"))
      ) {
        try {
          tag.push(normalizeRelayURL(potentialRelay));
          i += 4;
        } catch {
          // Not a valid relay, don't include
          i += 3;
        }
      } else {
        i += 3;
      }

      customTags.push(tag);
    } else if (arg === "-r" || arg === "--relay") {
      // Parse relay: -r <url>
      const relayUrl = args[i + 1];
      if (!relayUrl) {
        throw new Error("Relay option requires a URL: -r <url>");
      }

      try {
        relays.push(normalizeRelayURL(relayUrl));
      } catch {
        throw new Error(`Invalid relay URL: ${relayUrl}`);
      }
      i += 2;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionalArgs.push(arg);
      i += 1;
    }
  }

  if (positionalArgs.length === 0) {
    throw new Error(
      "Recipient or event required. Usage: zap <profile> or zap <event> or zap <profile> <event>",
    );
  }

  const firstArg = positionalArgs[0];
  const secondArg = positionalArgs[1];

  // Build result with optional custom tags and relays
  const buildResult = (
    recipientPubkey: string,
    pointer?: EventPointer | AddressPointer,
  ): ParsedZapCommand => {
    const result: ParsedZapCommand = { recipientPubkey };
    // Separate EventPointer from AddressPointer based on presence of 'id' vs 'kind'
    if (pointer) {
      if ("id" in pointer) {
        result.eventPointer = pointer;
      } else if ("kind" in pointer) {
        result.addressPointer = pointer;
      }
    }
    if (customTags.length > 0) result.customTags = customTags;
    if (relays.length > 0) result.relays = relays;
    return result;
  };

  // Case 1: Two positional arguments - zap <profile> <event>
  if (secondArg) {
    const recipientPubkey = await parseProfile(firstArg, activeAccountPubkey);
    const pointer = parseEventPointer(secondArg);
    return buildResult(recipientPubkey, pointer);
  }

  // Case 2: One positional argument - try event first, then profile
  // Events have more specific patterns (nevent, naddr, note)
  const pointer = tryParseEventPointer(firstArg);
  if (pointer) {
    // For events, we'll need to fetch the event to get the author
    // For now, we'll return a placeholder and let the component fetch it
    return buildResult("", pointer);
  }

  // Must be a profile
  const recipientPubkey = await parseProfile(firstArg, activeAccountPubkey);
  return buildResult(recipientPubkey);
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
