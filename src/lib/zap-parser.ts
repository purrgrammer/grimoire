import { nip19 } from "nostr-tools";
import { isNip05, resolveNip05 } from "./nip05";
import { isValidHexPubkey, normalizeHex } from "./nostr-validation";

/**
 * Parse coordinate string (kind:pubkey:identifier)
 */
function parseCoordinate(coordinate: string): {
  kind: number;
  pubkey: string;
  identifier: string;
} | null {
  const parts = coordinate.split(":");
  if (parts.length !== 3) return null;

  const kind = parseInt(parts[0]);
  if (isNaN(kind)) return null;

  return {
    kind,
    pubkey: parts[1],
    identifier: parts[2],
  };
}

export interface ParsedZapCommand {
  pubkey: string;
  eventId?: string;
  address?: {
    kind: number;
    pubkey: string;
    identifier: string;
  };
}

/**
 * Parse ZAP command arguments
 *
 * Supports:
 * - zap npub1... (zap a user)
 * - zap alice@domain.com (zap via NIP-05)
 * - zap npub1... note1... (zap an event)
 * - zap npub1... naddr1... (zap a replaceable event)
 * - zap note1... (extract pubkey from event)
 * - zap naddr1... (extract pubkey from address)
 * - zap $me (active account)
 *
 * @param args Command arguments
 * @param activeAccountPubkey Active account pubkey for $me alias
 */
export async function parseZapCommand(
  args: string[],
  activeAccountPubkey?: string,
): Promise<ParsedZapCommand> {
  if (args.length === 0) {
    throw new Error(
      "Recipient required. Usage: zap <pubkey|nip05> [event|address]",
    );
  }

  let pubkey: string | undefined;
  let eventId: string | undefined;
  let address: ParsedZapCommand["address"] | undefined;

  // Process each argument
  for (const arg of args) {
    // Handle $me alias
    if (arg.toLowerCase() === "$me") {
      if (!activeAccountPubkey) {
        throw new Error("No active account. Login first or provide a pubkey.");
      }
      pubkey = activeAccountPubkey;
      continue;
    }

    // Try bech32 decode
    if (
      arg.startsWith("npub") ||
      arg.startsWith("nprofile") ||
      arg.startsWith("note") ||
      arg.startsWith("nevent") ||
      arg.startsWith("naddr")
    ) {
      try {
        const decoded = nip19.decode(arg);

        if (decoded.type === "npub") {
          pubkey = decoded.data;
        } else if (decoded.type === "nprofile") {
          pubkey = decoded.data.pubkey;
        } else if (decoded.type === "note") {
          eventId = decoded.data;
        } else if (decoded.type === "nevent") {
          eventId = decoded.data.id;
          // If pubkey not set yet, use author from nevent
          if (!pubkey && decoded.data.author) {
            pubkey = decoded.data.author;
          }
        } else if (decoded.type === "naddr") {
          address = {
            kind: decoded.data.kind,
            pubkey: decoded.data.pubkey,
            identifier: decoded.data.identifier,
          };
          // If pubkey not set yet, use pubkey from naddr
          if (!pubkey) {
            pubkey = decoded.data.pubkey;
          }
        }
        continue;
      } catch (error) {
        throw new Error(`Invalid bech32 identifier: ${arg}`);
      }
    }

    // Check if it's a hex pubkey
    if (isValidHexPubkey(arg)) {
      if (!pubkey) {
        pubkey = normalizeHex(arg);
      } else {
        // Might be an event ID
        eventId = normalizeHex(arg);
      }
      continue;
    }

    // Check if it's a NIP-05 identifier
    if (isNip05(arg)) {
      const resolvedPubkey = await resolveNip05(arg);
      if (!resolvedPubkey) {
        throw new Error(`Failed to resolve NIP-05: ${arg}`);
      }
      pubkey = resolvedPubkey;
      continue;
    }

    // Check if it's a coordinate string (kind:pubkey:identifier)
    if (arg.includes(":")) {
      try {
        const coord = parseCoordinate(arg);
        if (coord) {
          address = {
            kind: coord.kind,
            pubkey: coord.pubkey,
            identifier: coord.identifier,
          };
          if (!pubkey) {
            pubkey = coord.pubkey;
          }
          continue;
        }
      } catch (_error) {
        // Not a coordinate, continue to error
      }
    }

    throw new Error(
      `Invalid argument: ${arg}. Expected pubkey, event, address, or NIP-05 identifier.`,
    );
  }

  if (!pubkey) {
    throw new Error("Recipient pubkey required");
  }

  return {
    pubkey,
    eventId,
    address,
  };
}
