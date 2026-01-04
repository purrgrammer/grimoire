import { nip19 } from "nostr-tools";
import { resolveNip05 } from "@/lib/nip05";
import { BaseAccount, type SerializedAccount } from "applesauce-accounts";
import type { ISigner } from "applesauce-signers";
import type { EventTemplate, NostrEvent } from "nostr-tools";

/**
 * Read-only metadata interface
 */
export interface ReadOnlyMetadata {
  source: "npub" | "nip05" | "hex" | "nprofile";
  originalInput: string;
  relays?: string[]; // from nprofile
  nip05?: string; // original nip-05 identifier
}

/**
 * A signer that always throws errors - used for read-only accounts
 */
export class ReadOnlySigner implements ISigner {
  constructor(public pubkey: string) {}

  async getPublicKey(): Promise<string> {
    return this.pubkey;
  }

  async signEvent(_template: EventTemplate): Promise<NostrEvent> {
    throw new Error(
      "Cannot sign events with a read-only account. Please add a signing account.",
    );
  }

  // Optional NIP-04/NIP-44 methods - also throw errors
  nip04 = {
    encrypt: async (_pubkey: string, _plaintext: string): Promise<string> => {
      throw new Error("Cannot encrypt with a read-only account.");
    },
    decrypt: async (_pubkey: string, _ciphertext: string): Promise<string> => {
      throw new Error("Cannot decrypt with a read-only account.");
    },
  };

  nip44 = {
    encrypt: async (_pubkey: string, _plaintext: string): Promise<string> => {
      throw new Error("Cannot encrypt with a read-only account.");
    },
    decrypt: async (_pubkey: string, _ciphertext: string): Promise<string> => {
      throw new Error("Cannot decrypt with a read-only account.");
    },
  };
}

/**
 * Read-only account - no signing capability
 * Supports login via npub, nip-05, hex pubkey, or nprofile
 */
export class ReadOnlyAccount extends BaseAccount<
  ReadOnlySigner,
  void,
  ReadOnlyMetadata
> {
  static readonly type = "readonly";

  constructor(pubkey: string, signer: ReadOnlySigner) {
    super(pubkey, signer);
  }

  toJSON(): SerializedAccount<void, ReadOnlyMetadata> {
    return this.saveCommonFields({
      signer: undefined,
    });
  }

  static fromJSON(
    data: SerializedAccount<void, ReadOnlyMetadata>,
  ): ReadOnlyAccount {
    const signer = new ReadOnlySigner(data.pubkey);
    const account = new ReadOnlyAccount(data.pubkey, signer);
    return BaseAccount.loadCommonFields(account, data);
  }

  /**
   * Helper to create account with metadata
   */
  private static createWithMetadata(
    pubkey: string,
    metadata: ReadOnlyMetadata,
  ): ReadOnlyAccount {
    const signer = new ReadOnlySigner(pubkey);
    const account = new ReadOnlyAccount(pubkey, signer);
    account.metadata = metadata;
    return account;
  }

  /**
   * Create account from npub (NIP-19 encoded public key)
   */
  static async fromNpub(npub: string): Promise<ReadOnlyAccount> {
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type !== "npub") {
        throw new Error("Invalid npub: expected npub format");
      }
      return ReadOnlyAccount.createWithMetadata(decoded.data, {
        source: "npub",
        originalInput: npub,
      });
    } catch (error) {
      throw new Error(
        `Failed to decode npub: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Create account from NIP-05 identifier (user@domain.com)
   */
  static async fromNip05(nip05: string): Promise<ReadOnlyAccount> {
    const pubkey = await resolveNip05(nip05);
    if (!pubkey) {
      throw new Error(`Failed to resolve NIP-05 identifier: ${nip05}`);
    }
    return ReadOnlyAccount.createWithMetadata(pubkey, {
      source: "nip05",
      originalInput: nip05,
      nip05,
    });
  }

  /**
   * Create account from nprofile (NIP-19 encoded profile with relay hints)
   */
  static async fromNprofile(nprofile: string): Promise<ReadOnlyAccount> {
    try {
      const decoded = nip19.decode(nprofile);
      if (decoded.type !== "nprofile") {
        throw new Error("Invalid nprofile: expected nprofile format");
      }
      return ReadOnlyAccount.createWithMetadata(decoded.data.pubkey, {
        source: "nprofile",
        originalInput: nprofile,
        relays: decoded.data.relays,
      });
    } catch (error) {
      throw new Error(
        `Failed to decode nprofile: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Create account from hex public key
   */
  static fromHex(hex: string): ReadOnlyAccount {
    // Validate hex format (64 character hex string)
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error(
        "Invalid hex pubkey: expected 64 character hexadecimal string",
      );
    }
    return ReadOnlyAccount.createWithMetadata(hex.toLowerCase(), {
      source: "hex",
      originalInput: hex,
    });
  }
}
