import { nip19 } from "nostr-tools";
import {
  isValidHexEventId,
  isValidHexPubkey,
  normalizeHex,
} from "./nostr-validation";
import { normalizeRelayURL } from "./relay-url";

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
  pointer?: EventPointer | AddressPointer;
  rawEvent?: unknown; // Raw event JSON for unsigned events (e.g., NIP-17 rumors)
}

/**
 * Parse OPEN command arguments into an event pointer
 * Supports:
 * - note1... (bech32 note)
 * - nevent1... (bech32 nevent with relay hints)
 * - naddr1... (bech32 naddr for addressable events)
 * - abc123... (64-char hex event ID)
 * - kind:pubkey:d-tag (address pointer format)
 * - --json <raw-event> (raw JSON event object for unsigned events)
 */
export function parseOpenCommand(args: string[]): ParsedOpenCommand {
  // Check for --json flag
  const jsonIndex = args.indexOf("--json");
  if (jsonIndex !== -1) {
    const jsonString = args[jsonIndex + 1];
    if (!jsonString) {
      throw new Error("--json flag requires a JSON event string");
    }

    try {
      const rawEvent = JSON.parse(jsonString);
      // Basic validation that it looks like a Nostr event
      if (
        typeof rawEvent !== "object" ||
        !rawEvent ||
        typeof rawEvent.kind !== "number" ||
        typeof rawEvent.content !== "string"
      ) {
        throw new Error(
          "Invalid event JSON: must be an object with kind and content",
        );
      }
      return { rawEvent };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
      throw error;
    }
  }

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
          pointer: {
            ...decoded.data,
            relays: decoded.data.relays
              ?.map((url) => {
                try {
                  return normalizeRelayURL(url);
                } catch (error) {
                  console.warn(
                    `Skipping invalid relay hint in nevent: ${url}`,
                    error,
                  );
                  return null;
                }
              })
              .filter((url): url is string => url !== null),
          },
        };
      }

      if (decoded.type === "naddr") {
        // naddr1... -> AddressPointer (already has kind, pubkey, identifier)
        return {
          pointer: {
            ...decoded.data,
            relays: decoded.data.relays
              ?.map((url) => {
                try {
                  return normalizeRelayURL(url);
                } catch (error) {
                  console.warn(
                    `Skipping invalid relay hint in naddr: ${url}`,
                    error,
                  );
                  return null;
                }
              })
              .filter((url): url is string => url !== null),
          },
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
