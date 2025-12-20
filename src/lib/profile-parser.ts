import { nip19 } from "nostr-tools";
import { isNip05, resolveNip05 } from "./nip05";
import { isValidHexPubkey, normalizeHex } from "./nostr-validation";

export interface ParsedProfileCommand {
  pubkey: string;
}

/**
 * Parse PROFILE command arguments into a pubkey
 * Supports:
 * - npub1... (bech32 npub)
 * - nprofile1... (bech32 nprofile with relay hints)
 * - abc123... (64-char hex pubkey)
 * - user@domain.com (NIP-05 identifier)
 * - domain.com (bare domain, resolved as _@domain.com)
 * - $me (active account alias)
 */
export async function parseProfileCommand(
  args: string[],
  activeAccountPubkey?: string,
): Promise<ParsedProfileCommand> {
  const identifier = args[0];

  if (!identifier) {
    throw new Error("User identifier required");
  }

  // Handle $me alias
  if (identifier.toLowerCase() === "$me") {
    return {
      pubkey: activeAccountPubkey || "$me",
    };
  }

  // Try bech32 decode first (npub, nprofile)
  if (identifier.startsWith("npub") || identifier.startsWith("nprofile")) {
    try {
      const decoded = nip19.decode(identifier);

      if (decoded.type === "npub") {
        // npub1... -> pubkey
        return {
          pubkey: decoded.data,
        };
      }

      if (decoded.type === "nprofile") {
        // nprofile1... -> pubkey (ignore relays for now)
        return {
          pubkey: decoded.data.pubkey,
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

  // Check if it's a NIP-05 identifier (user@domain.com)
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
    "Invalid user identifier. Supported formats: npub1..., nprofile1..., hex pubkey, user@domain.com, or domain.com",
  );
}
