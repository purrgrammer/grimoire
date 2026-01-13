/**
 * Blossom Command Parser
 *
 * Parses arguments for the blossom command with subcommands:
 * - servers: Show/manage user's Blossom server list
 * - check <server>: Check if a server is online
 * - upload <file>: Upload a file (handled by UI file picker)
 * - list [pubkey]: List blobs for a user
 * - mirror <url> <server>: Mirror a blob to another server
 */

import { nip19 } from "nostr-tools";

export type BlossomSubcommand =
  | "servers"
  | "check"
  | "upload"
  | "list"
  | "mirror"
  | "delete";

export interface BlossomCommandResult {
  subcommand: BlossomSubcommand;
  // For 'check' subcommand
  serverUrl?: string;
  // For 'list' subcommand
  pubkey?: string;
  // For 'mirror' subcommand
  sourceUrl?: string;
  targetServer?: string;
  // For 'delete' subcommand
  sha256?: string;
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
 * Resolve a pubkey from various formats (npub, nprofile, hex, $me)
 */
function resolvePubkey(
  input: string,
  activeAccountPubkey?: string,
): string | undefined {
  // Handle $me alias
  if (input === "$me") {
    return activeAccountPubkey;
  }

  // Handle hex pubkey
  if (/^[0-9a-f]{64}$/i.test(input)) {
    return input.toLowerCase();
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

  return undefined;
}

/**
 * Parse blossom command arguments
 *
 * Usage:
 *   blossom servers              - Show your Blossom servers
 *   blossom check <server>       - Check server health
 *   blossom upload               - Open upload dialog
 *   blossom list [pubkey]        - List blobs (defaults to $me)
 *   blossom mirror <url> <server> - Mirror blob to server
 *   blossom delete <sha256> <server> - Delete blob from server
 */
export function parseBlossomCommand(
  args: string[],
  activeAccountPubkey?: string,
): BlossomCommandResult {
  // Default to 'servers' if no subcommand
  if (args.length === 0) {
    return { subcommand: "servers" };
  }

  const subcommand = args[0].toLowerCase();

  switch (subcommand) {
    case "servers":
    case "server":
      return { subcommand: "servers" };

    case "check": {
      if (args.length < 2) {
        throw new Error("Server URL required. Usage: blossom check <server>");
      }
      return {
        subcommand: "check",
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
        pubkey = resolvePubkey(pubkeyArg, activeAccountPubkey);
        if (!pubkey) {
          throw new Error(
            `Invalid pubkey format: ${pubkeyArg}. Use npub, nprofile, hex, or $me`,
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
  check <server>       Check if a server is online
  upload               Open file upload dialog
  list [pubkey]        List blobs (defaults to your account)
  mirror <url> <server> Mirror a blob to another server
  delete <sha256> <server> Delete a blob from a server`,
      );
  }
}
