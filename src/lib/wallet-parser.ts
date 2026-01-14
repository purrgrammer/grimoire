export interface ParsedWalletCommand {
  action: "view" | "connect";
  connectionURI?: string;
  name?: string;
}

/**
 * Parse WALLET command arguments
 * Supports:
 * - wallet                            -> Open wallet manager
 * - wallet connect <uri>              -> Add NWC connection
 * - wallet connect <uri> --name "..."  -> Add NWC connection with custom name
 */
export function parseWalletCommand(args: string[]): ParsedWalletCommand {
  // No args = open wallet manager
  if (args.length === 0) {
    return {
      action: "view",
    };
  }

  const subcommand = args[0];

  if (subcommand === "connect") {
    const uri = args[1];

    if (!uri) {
      throw new Error("Connection URI required. Usage: wallet connect <uri>");
    }

    // Validate URI format
    if (!uri.startsWith("nostr+walletconnect://")) {
      throw new Error(
        "Invalid connection URI. Must start with 'nostr+walletconnect://'",
      );
    }

    // Check for --name flag
    let name: string | undefined;
    const nameIndex = args.indexOf("--name");
    if (nameIndex !== -1 && args[nameIndex + 1]) {
      name = args[nameIndex + 1];
    }

    return {
      action: "connect",
      connectionURI: uri,
      name,
    };
  }

  throw new Error(
    `Unknown wallet subcommand: ${subcommand}. Available: connect`,
  );
}
