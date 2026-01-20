import { nip19 } from "nostr-tools";
import { isNip05, resolveNip05 } from "./nip05";
import { isValidHexPubkey, normalizeHex } from "./nostr-validation";

export interface ParsedCommunityCommand {
  /** The community's pubkey (also serves as unique identifier) */
  pubkey: string;
  /** Relay hints for fetching the community's kind 10222 event */
  relays?: string[];
}

/**
 * Parse the ncommunity:// format
 * Format: ncommunity://<pubkey>?relay=<url-encoded-relay-1>&relay=<url-encoded-relay-2>
 *
 * @param identifier ncommunity:// string
 * @returns Parsed pubkey and relays or null if not valid
 */
function parseNcommunityFormat(
  identifier: string,
): { pubkey: string; relays: string[] } | null {
  if (!identifier.startsWith("ncommunity://")) {
    return null;
  }

  try {
    // Remove the ncommunity:// prefix
    const rest = identifier.slice("ncommunity://".length);

    // Split pubkey from query params
    const [pubkey, queryString] = rest.split("?");

    if (!pubkey || !isValidHexPubkey(pubkey)) {
      return null;
    }

    // Parse relay query params
    const relays: string[] = [];
    if (queryString) {
      const params = new URLSearchParams(queryString);
      const relayParams = params.getAll("relay");
      for (const relay of relayParams) {
        try {
          relays.push(decodeURIComponent(relay));
        } catch {
          // Skip invalid URL-encoded relay
        }
      }
    }

    return {
      pubkey: normalizeHex(pubkey),
      relays,
    };
  } catch {
    return null;
  }
}

/**
 * Parse COMMUNITY command arguments into a community identifier
 *
 * Supports:
 * - npub1... (bech32 npub - community pubkey)
 * - nprofile1... (bech32 nprofile with relay hints)
 * - ncommunity://<pubkey>?relay=... (Communikeys format)
 * - abc123... (64-char hex pubkey)
 * - user@domain.com (NIP-05 identifier - resolves to pubkey)
 * - domain.com (bare domain, resolved as _@domain.com)
 * - $me (active account alias)
 *
 * @param args Command arguments
 * @param activeAccountPubkey Active account pubkey for $me alias
 * @returns Parsed community command with pubkey and optional relay hints
 */
export async function parseCommunityCommand(
  args: string[],
  activeAccountPubkey?: string,
): Promise<ParsedCommunityCommand> {
  const identifier = args[0];

  if (!identifier) {
    throw new Error("Community identifier required");
  }

  // Handle $me alias (view own community if it exists)
  if (identifier.toLowerCase() === "$me") {
    if (!activeAccountPubkey) {
      throw new Error("No active account. Log in to use $me alias.");
    }
    return {
      pubkey: activeAccountPubkey,
    };
  }

  // Try ncommunity:// format first
  const ncommunityResult = parseNcommunityFormat(identifier);
  if (ncommunityResult) {
    return {
      pubkey: ncommunityResult.pubkey,
      relays:
        ncommunityResult.relays.length > 0
          ? ncommunityResult.relays
          : undefined,
    };
  }

  // Try bech32 decode (npub, nprofile)
  if (identifier.startsWith("npub") || identifier.startsWith("nprofile")) {
    try {
      const decoded = nip19.decode(identifier);

      if (decoded.type === "npub") {
        return {
          pubkey: decoded.data,
        };
      }

      if (decoded.type === "nprofile") {
        return {
          pubkey: decoded.data.pubkey,
          relays: decoded.data.relays,
        };
      }
    } catch (error) {
      throw new Error(`Invalid bech32 identifier: ${error}`);
    }
  }

  // Check if it's a hex pubkey
  if (isValidHexPubkey(identifier)) {
    return {
      pubkey: normalizeHex(identifier),
    };
  }

  // Check if it's a NIP-05 identifier (user@domain.com or domain.com)
  if (isNip05(identifier)) {
    const pubkey = await resolveNip05(identifier);
    if (!pubkey) {
      throw new Error(
        `Failed to resolve NIP-05 identifier: ${identifier}. Please check the identifier and try again.`,
      );
    }
    return { pubkey };
  }

  throw new Error(
    "Invalid community identifier. Supported formats: npub1..., nprofile1..., ncommunity://..., hex pubkey, user@domain.com, or domain.com",
  );
}

/**
 * Encode a community identifier to ncommunity format
 *
 * @param pubkey Community pubkey
 * @param relays Optional relay hints
 * @returns ncommunity:// formatted string
 */
export function encodeNcommunity(pubkey: string, relays?: string[]): string {
  let result = `ncommunity://${pubkey}`;

  if (relays && relays.length > 0) {
    const params = new URLSearchParams();
    for (const relay of relays) {
      params.append("relay", relay);
    }
    result += `?${params.toString()}`;
  }

  return result;
}
