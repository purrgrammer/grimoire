import { nip19 } from "nostr-tools";
import {
  isValidHexEventId,
  isValidHexPubkey,
  normalizeHex,
} from "./nostr-validation";

// Define pointer types locally since they're not exported from nostr-tools
export interface EventPointer {
  id: string;
  relays?: string[];
  author?: string;
}

export interface AddressPointer {
  kind: number;
  pubkey: string;
  identifier: string;
  relays?: string[];
}

export interface ParsedOpenCommand {
  pointer: EventPointer | AddressPointer;
}

/**
 * Parse OPEN command arguments into an event pointer
 * Supports:
 * - note1... (bech32 note)
 * - nevent1... (bech32 nevent with relay hints)
 * - naddr1... (bech32 naddr for addressable events)
 * - abc123... (64-char hex event ID)
 * - kind:pubkey:d-tag (address pointer format)
 */
export function parseOpenCommand(args: string[]): ParsedOpenCommand {
  const identifier = args[0];

  if (!identifier) {
    throw new Error("Event identifier required");
  }

  // Try bech32 decode first (note, nevent, naddr)
  if (
    identifier.startsWith("note") ||
    identifier.startsWith("nevent") ||
    identifier.startsWith("naddr")
  ) {
    try {
      const decoded = nip19.decode(identifier);

      if (decoded.type === "note") {
        // note1... -> EventPointer with just ID
        return {
          pointer: {
            id: decoded.data,
          },
        };
      }

      if (decoded.type === "nevent") {
        // nevent1... -> EventPointer (already has id and optional relays)
        return {
          pointer: decoded.data,
        };
      }

      if (decoded.type === "naddr") {
        // naddr1... -> AddressPointer (already has kind, pubkey, identifier)
        return {
          pointer: decoded.data,
        };
      }
    } catch (error) {
      throw new Error(`Invalid bech32 identifier: ${error}`);
    }
  }

  // Check if it's a hex event ID
  if (isValidHexEventId(identifier)) {
    return {
      pointer: {
        id: normalizeHex(identifier),
      },
    };
  }

  // Check if it's an address format (kind:pubkey:d-tag)
  if (identifier.includes(":")) {
    const parts = identifier.split(":");

    if (parts.length >= 2) {
      const kind = parseInt(parts[0], 10);
      const pubkey = parts[1];
      const dTag = parts[2] || "";

      if (isNaN(kind)) {
        throw new Error("Invalid address format: kind must be a number");
      }

      if (!isValidHexPubkey(pubkey)) {
        throw new Error("Invalid address format: pubkey must be 64 hex chars");
      }

      return {
        pointer: {
          kind,
          pubkey: normalizeHex(pubkey),
          identifier: dTag,
        },
      };
    }
  }

  throw new Error(
    "Invalid event identifier. Supported formats: note1..., nevent1..., naddr1..., hex ID, or kind:pubkey:d-tag",
  );
}
