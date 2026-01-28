/**
 * Wallet Command Parser
 *
 * Parses arguments for the wallet command with subcommands:
 * - nwc: NWC Lightning wallet (default)
 * - nip-61: NIP-60 Cashu ecash wallet
 */

export type WalletSubcommand = "nwc" | "nip-61";

export interface WalletCommandResult {
  subcommand: WalletSubcommand;
}

/**
 * Parse wallet command arguments
 *
 * Usage:
 *   wallet              - Open NWC Lightning wallet (default)
 *   wallet nwc          - Open NWC Lightning wallet
 *   wallet nip-61       - Open NIP-60 Cashu ecash wallet
 *   wallet cashu        - Alias for nip-61
 *   wallet ecash        - Alias for nip-61
 */
export function parseWalletCommand(args: string[]): WalletCommandResult {
  // Default to 'nwc' if no subcommand
  if (args.length === 0) {
    return { subcommand: "nwc" };
  }

  const subcommand = args[0].toLowerCase();

  switch (subcommand) {
    case "nwc":
    case "lightning":
    case "ln":
      return { subcommand: "nwc" };

    case "nip-61":
    case "nip61":
    case "cashu":
    case "ecash":
    case "nuts":
      return { subcommand: "nip-61" };

    default:
      throw new Error(
        `Unknown wallet type: ${subcommand}

Available wallet types:
  nwc              NWC Lightning wallet (default)
  nip-61           NIP-60 Cashu ecash wallet
  cashu            Alias for nip-61
  ecash            Alias for nip-61`,
      );
  }
}
