import { isNip05 } from "@/lib/nip05";
import { ReadOnlyAccount } from "@/lib/account-types";

/**
 * Types of login input formats supported
 */
export type LoginInputType =
  | "npub"
  | "nprofile"
  | "nip05"
  | "hex"
  | "bunker"
  | "extension"
  | "unknown";

/**
 * Detect the type of login input
 * @param input - The user's login input string
 * @returns The detected input type
 */
export function detectLoginInputType(input: string): LoginInputType {
  if (!input || input.trim() === "") {
    return "extension"; // Default to extension when no input
  }

  const trimmed = input.trim();

  // NIP-19 encoded formats
  if (trimmed.startsWith("npub1")) return "npub";
  if (trimmed.startsWith("nprofile1")) return "nprofile";

  // Bunker/Nostr Connect URLs (NIP-46)
  if (trimmed.startsWith("bunker://")) return "bunker";
  if (trimmed.startsWith("nostrconnect://")) return "bunker";

  // NIP-05 identifier (user@domain.com or domain.com)
  if (isNip05(trimmed)) return "nip05";

  // Hex pubkey (64 character hex string)
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return "hex";

  return "unknown";
}

/**
 * Create an account from login input
 * @param input - The user's login input string
 * @returns A promise that resolves to an Account
 * @throws Error if the input format is invalid or account creation fails
 */
export async function createAccountFromInput(
  input: string,
): Promise<ReadOnlyAccount> {
  const trimmed = input.trim();
  const type = detectLoginInputType(trimmed);

  switch (type) {
    case "npub":
      return await ReadOnlyAccount.fromNpub(trimmed);

    case "nprofile":
      return await ReadOnlyAccount.fromNprofile(trimmed);

    case "nip05":
      return await ReadOnlyAccount.fromNip05(trimmed);

    case "hex":
      return ReadOnlyAccount.fromHex(trimmed);

    case "bunker":
      throw new Error(
        "Remote signer (NIP-46) support coming soon. Currently supports read-only accounts only.",
      );

    case "extension":
      throw new Error(
        "Extension login requires UI interaction. Please use the login dialog.",
      );

    case "unknown":
    default:
      throw new Error(
        `Unknown input format. Supported formats: npub, nprofile, hex pubkey, NIP-05 (user@domain.com)`,
      );
  }
}

/**
 * Validate if an input string is a valid login format
 * @param input - The input to validate
 * @returns True if the input is a valid format
 */
export function isValidLoginInput(input: string): boolean {
  if (!input || input.trim() === "") {
    return false; // Empty input is invalid for this check
  }

  const type = detectLoginInputType(input);
  return type !== "unknown" && type !== "extension";
}
