import { nip19 } from "nostr-tools";
import { isValidHexEventId, isValidHexPubkey } from "./nostr-validation";
import { normalizeRelayURL } from "./relay-url";

export type EncodeType = "npub" | "note" | "nevent" | "nprofile" | "naddr";

export interface ParsedEncodeCommand {
  type: EncodeType;
  value: string; // hex pubkey, event id, or "kind:pubkey:d-tag"
  relays?: string[];
  author?: string; // for nevent
}

/**
 * Parse ENCODE command arguments
 *
 * Examples:
 *   encode npub <pubkey-hex>
 *   encode nprofile <pubkey-hex> --relay <url>
 *   encode note <event-id>
 *   encode nevent <event-id> --relay <url> --author <pubkey>
 *   encode naddr <kind>:<pubkey>:<d-tag> --relay <url>
 */
export function parseEncodeCommand(args: string[]): ParsedEncodeCommand {
  if (args.length < 2) {
    throw new Error(
      "Usage: ENCODE <type> <value> [--relay <url>] [--author <pubkey>]",
    );
  }

  const type = args[0].toLowerCase() as EncodeType;
  const validTypes: EncodeType[] = [
    "npub",
    "note",
    "nevent",
    "nprofile",
    "naddr",
  ];

  if (!validTypes.includes(type)) {
    throw new Error(
      `Invalid type: ${type}. Must be one of: ${validTypes.join(", ")}`,
    );
  }

  const value = args[1];
  const relays: string[] = [];
  let author: string | undefined;

  // Parse flags
  let i = 2;
  while (i < args.length) {
    const flag = args[i];

    if (flag === "--relay" || flag === "-r") {
      if (i + 1 >= args.length) {
        throw new Error(`${flag} requires a relay URL`);
      }
      relays.push(normalizeRelayURL(args[i + 1]));
      i += 2;
      continue;
    }

    if (flag === "--author" || flag === "-a") {
      if (i + 1 >= args.length) {
        throw new Error(`${flag} requires a pubkey`);
      }
      author = args[i + 1];
      i += 2;
      continue;
    }

    throw new Error(`Unknown flag: ${flag}`);
  }

  // Validate based on type
  validateEncodeInput(type, value, relays, author);

  return {
    type,
    value,
    relays: relays.length > 0 ? relays : undefined,
    author,
  };
}

function validateEncodeInput(
  type: EncodeType,
  value: string,
  relays: string[],
  author?: string,
) {
  // Validate hex strings
  if (type === "npub" || type === "nprofile") {
    if (!isValidHexPubkey(value)) {
      throw new Error("Pubkey must be 64-character hex string");
    }
  }

  if (type === "note") {
    if (!isValidHexEventId(value)) {
      throw new Error("Event ID must be 64-character hex string");
    }
  }

  if (type === "nevent") {
    if (!isValidHexEventId(value)) {
      throw new Error("Event ID must be 64-character hex string");
    }
    if (author && !isValidHexPubkey(author)) {
      throw new Error("Author pubkey must be 64-character hex string");
    }
  }

  if (type === "naddr") {
    // Format: kind:pubkey:d-tag
    const parts = value.split(":");
    if (parts.length !== 3) {
      throw new Error("naddr value must be in format: kind:pubkey:d-tag");
    }
    const [kindStr, pubkey, _identifier] = parts;
    const kind = parseInt(kindStr, 10);
    if (isNaN(kind)) {
      throw new Error("Kind must be a number");
    }
    if (!isValidHexPubkey(pubkey)) {
      throw new Error("Pubkey must be 64-character hex string");
    }
  }

  // Validate relay URLs
  for (const relay of relays) {
    try {
      const url = new URL(relay);
      if (!url.protocol.startsWith("ws")) {
        throw new Error("Relay must be a WebSocket URL (ws:// or wss://)");
      }
    } catch {
      throw new Error(`Invalid relay URL: ${relay}`);
    }
  }
}

/**
 * Encode the parsed command to bech32
 */
export function encodeToNostr(cmd: ParsedEncodeCommand): string {
  switch (cmd.type) {
    case "npub":
      return nip19.npubEncode(cmd.value);

    case "note":
      return nip19.noteEncode(cmd.value);

    case "nprofile":
      return nip19.nprofileEncode({
        pubkey: cmd.value,
        relays: cmd.relays || [],
      });

    case "nevent":
      return nip19.neventEncode({
        id: cmd.value,
        relays: cmd.relays || [],
        author: cmd.author,
      });

    case "naddr": {
      const [kindStr, pubkey, identifier] = cmd.value.split(":");
      return nip19.naddrEncode({
        kind: parseInt(kindStr, 10),
        pubkey,
        identifier: identifier || "",
        relays: cmd.relays || [],
      });
    }

    default:
      throw new Error(`Unsupported encode type: ${cmd.type}`);
  }
}
