import { nip19 } from "nostr-tools";
import { resolveNip05 } from "@/lib/nip05";

/**
 * Account interface matching applesauce-accounts
 */
export interface Account {
  id: string;
  pubkey: string;
  signer?: any;
  metadata?: Record<string, any>;
  toJSON(): any;
}

/**
 * Read-only account - no signing capability
 * Supports login via npub, nip-05, hex pubkey, or nprofile
 */
export class ReadOnlyAccount implements Account {
  id: string;
  pubkey: string;
  signer = undefined;
  metadata: {
    type: "readonly";
    source: "npub" | "nip05" | "hex" | "nprofile";
    originalInput: string;
    relays?: string[]; // from nprofile
    nip05?: string; // original nip-05 identifier
  };

  constructor(
    pubkey: string,
    source: "npub" | "nip05" | "hex" | "nprofile",
    metadata: Partial<ReadOnlyAccount["metadata"]>,
  ) {
    this.pubkey = pubkey;
    this.id = `readonly:${pubkey}`;
    this.metadata = {
      type: "readonly",
      source,
      originalInput: metadata.originalInput || pubkey,
      ...metadata,
    };
  }

  toJSON() {
    return {
      id: this.id,
      pubkey: this.pubkey,
      metadata: this.metadata,
    };
  }

  static fromJSON(data: any): ReadOnlyAccount {
    return new ReadOnlyAccount(data.pubkey, data.metadata.source, {
      originalInput: data.metadata.originalInput,
      relays: data.metadata.relays,
      nip05: data.metadata.nip05,
    });
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
      return new ReadOnlyAccount(decoded.data, "npub", {
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
    return new ReadOnlyAccount(pubkey, "nip05", {
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
      return new ReadOnlyAccount(decoded.data.pubkey, "nprofile", {
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
    return new ReadOnlyAccount(hex.toLowerCase(), "hex", {
      originalInput: hex,
    });
  }
}
