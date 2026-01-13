/**
 * Blossom Command Parser
 *
 * Parses arguments for the blossom command with subcommands:
 * - servers: Show/manage user's Blossom server list
 * - server <url>: View info about a specific Blossom server
 * - upload: Upload a file (handled by UI file picker)
 * - list [pubkey]: List blobs for a user
 * - blob <sha256> [server]: View a specific blob
 * - mirror <url> <server>: Mirror a blob to another server
 * - delete <sha256> <server>: Delete a blob from a server
 */

import { nip19 } from "nostr-tools";
import { isNip05, resolveNip05 } from "./nip05";
import { isValidHexPubkey, normalizeHex } from "./nostr-validation";

export type BlossomSubcommand =
  | "servers"
  | "server"
  | "upload"
  | "list"
  | "blob"
  | "mirror"
  | "delete";

export interface BlossomCommandResult {
  subcommand: BlossomSubcommand;
  // For 'blob' and 'delete' subcommands
  sha256?: string;
  serverUrl?: string;
  // For 'list' subcommand
  pubkey?: string;
  // For 'mirror' subcommand
  sourceUrl?: string;
  targetServer?: string;
}

/**
 * Normalize a server URL (add https:// if missing)
 */
function normalizeServerUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `https://${url}`;
}

/**
 * Resolve a pubkey from various formats (npub, nprofile, hex, NIP-05, $me)
 */
async function resolvePubkey(
  input: string,
  activeAccountPubkey?: string,
): Promise<string | undefined> {
  // Handle $me alias
  if (input === "$me") {
    return activeAccountPubkey;
  }

  // Handle hex pubkey
  if (isValidHexPubkey(input)) {
    return normalizeHex(input);
  }

  // Handle npub
  if (input.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "npub") {
        return decoded.data;
      }
    } catch {
      // Invalid npub
    }
  }

  // Handle nprofile
  if (input.startsWith("nprofile1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "nprofile") {
        return decoded.data.pubkey;
      }
    } catch {
      // Invalid nprofile
    }
  }

  // Handle NIP-05 identifier (user@domain.com or domain.com)
  if (isNip05(input)) {
    const pubkey = await resolveNip05(input);
    if (pubkey) {
      return pubkey;
    }
  }

  return undefined;
}

/**
 * Parse blossom command arguments
 *
 * Usage:
 *   blossom servers              - Show your Blossom servers
 *   blossom server <url>         - View info about a specific server
 *   blossom upload               - Open upload dialog
 *   blossom list [pubkey]        - List blobs (defaults to $me)
 *   blossom blob <sha256> [server] - View blob details
 *   blossom mirror <url> <server> - Mirror blob to server
 *   blossom delete <sha256> <server> - Delete blob from server
 */
export async function parseBlossomCommand(
  args: string[],
  activeAccountPubkey?: string,
): Promise<BlossomCommandResult> {
  // Default to 'servers' if no subcommand
  if (args.length === 0) {
    return { subcommand: "servers" };
  }

  const subcommand = args[0].toLowerCase();

  switch (subcommand) {
    case "servers":
      return { subcommand: "servers" };

    case "server": {
      // View info about a specific Blossom server
      if (args.length < 2) {
        throw new Error("Server URL required. Usage: blossom server <url>");
      }
      return {
        subcommand: "server",
        serverUrl: normalizeServerUrl(args[1]),
      };
    }

    case "upload":
      return { subcommand: "upload" };

    case "list":
    case "ls": {
      // Default to active account if no pubkey specified
      const pubkeyArg = args[1];
      let pubkey: string | undefined;

      if (pubkeyArg) {
        pubkey = await resolvePubkey(pubkeyArg, activeAccountPubkey);
        if (!pubkey) {
          throw new Error(
            `Invalid pubkey format: ${pubkeyArg}. Use npub, nprofile, hex, user@domain.com, or $me`,
          );
        }
      } else {
        pubkey = activeAccountPubkey;
      }

      return {
        subcommand: "list",
        pubkey,
      };
    }

    case "blob":
    case "view": {
      if (args.length < 2) {
        throw new Error(
          "SHA256 hash required. Usage: blossom blob <sha256> [server]",
        );
      }
      const sha256 = args[1].toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha256)) {
        throw new Error("Invalid SHA256 hash. Must be 64 hex characters.");
      }
      return {
        subcommand: "blob",
        sha256,
        serverUrl: args[2] ? normalizeServerUrl(args[2]) : undefined,
      };
    }

    case "mirror": {
      if (args.length < 3) {
        throw new Error(
          "Source URL and target server required. Usage: blossom mirror <url> <server>",
        );
      }
      return {
        subcommand: "mirror",
        sourceUrl: args[1],
        targetServer: normalizeServerUrl(args[2]),
      };
    }

    case "delete":
    case "rm": {
      if (args.length < 3) {
        throw new Error(
          "SHA256 hash and server required. Usage: blossom delete <sha256> <server>",
        );
      }
      const sha256 = args[1].toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha256)) {
        throw new Error("Invalid SHA256 hash. Must be 64 hex characters.");
      }
      return {
        subcommand: "delete",
        sha256,
        serverUrl: normalizeServerUrl(args[2]),
      };
    }

    default:
      throw new Error(
        `Unknown subcommand: ${subcommand}

Available subcommands:
  servers              Show your configured Blossom servers
  server <url>         View info about a specific server
  upload               Open file upload dialog
  list [pubkey]        List blobs (defaults to your account)
  blob <sha256> [server] View blob details
  mirror <url> <server> Mirror a blob to another server
  delete <sha256> <server> Delete a blob from a server`,
      );
  }
}
