/**
 * Nostr Wallet Connect (NIP-47) Client
 *
 * Implements the client side of NIP-47 protocol for connecting to remote Lightning wallets.
 * Uses NIP-04 encryption for secure communication over Nostr relays.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/47.md
 */

import { finalizeEvent, getPublicKey } from "nostr-tools";
import { nip04 } from "nostr-tools";
import pool from "./relay-pool";
import type { NWCConnection } from "@/types/app";

/**
 * NIP-47 request/response types
 */
export interface NWCRequest {
  method: string;
  params?: Record<string, any>;
}

export interface NWCResponse {
  result_type: string;
  result?: any;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Parses a nostr+walletconnect:// URI into connection details
 * Format: nostr+walletconnect://[pubkey]?relay=[url]&secret=[hex]&lud16=[optional]
 */
export function parseNWCUri(uri: string): {
  walletPubkey: string;
  relays: string[];
  secret: string;
} {
  // Remove protocol prefix
  const withoutProtocol = uri.replace(/^nostr\+walletconnect:\/\//i, "");

  // Split pubkey from query params
  const [pubkey, queryString] = withoutProtocol.split("?");

  if (!pubkey || !queryString) {
    throw new Error("Invalid NWC URI format");
  }

  // Parse query parameters
  const params = new URLSearchParams(queryString);
  const relay = params.get("relay");
  const secret = params.get("secret");

  if (!relay || !secret) {
    throw new Error("Missing required parameters: relay and secret");
  }

  // Normalize relay URL
  const relayUrl = relay.startsWith("wss://")
    ? relay
    : relay.startsWith("ws://")
      ? relay
      : `wss://${relay}`;

  return {
    walletPubkey: pubkey,
    relays: [relayUrl],
    secret,
  };
}

/**
 * NWC Client Class
 * Manages encrypted communication with a NWC wallet service
 */
export class NWCClient {
  private walletPubkey: string;
  private relays: string[];
  private secret: Uint8Array;
  private clientSecretKey: Uint8Array;
  private clientPubkey: string;

  constructor(connection: NWCConnection) {
    this.walletPubkey = connection.walletPubkey;
    this.relays = connection.relays;
    this.secret = this.hexToBytes(connection.secret);

    // Derive client keypair from secret
    this.clientSecretKey = this.secret;
    this.clientPubkey = getPublicKey(this.clientSecretKey);
  }

  /**
   * Sends a command to the wallet and waits for response
   */
  async sendRequest(
    method: string,
    params?: Record<string, any>,
  ): Promise<NWCResponse> {
    const request: NWCRequest = {
      method,
      params,
    };

    // Encrypt the request using NIP-04
    const encryptedContent = await nip04.encrypt(
      this.clientSecretKey,
      this.walletPubkey,
      JSON.stringify(request),
    );

    // Create kind 23194 event (client request)
    const requestEvent = finalizeEvent(
      {
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", this.walletPubkey]],
        content: encryptedContent,
      },
      this.clientSecretKey,
    );

    // Publish request to relays
    await pool.publish(this.relays, requestEvent);

    // Wait for response (kind 23195)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error("Request timeout"));
      }, 30000); // 30 second timeout

      // Capture client keys for use in subscription
      const clientSecretKey = this.clientSecretKey;
      const walletPubkey = this.walletPubkey;

      const observable = pool.subscription(this.relays, [
        {
          kinds: [23195],
          authors: [this.walletPubkey],
          "#p": [this.clientPubkey],
          since: requestEvent.created_at,
        },
      ]);

      const subscription = observable.subscribe({
        next: async (eventOrEose) => {
          // Skip EOSE markers
          if (typeof eventOrEose === "string") {
            return;
          }

          try {
            // Decrypt response
            const decryptedContent = await nip04.decrypt(
              clientSecretKey,
              walletPubkey,
              eventOrEose.content,
            );
            const response = JSON.parse(decryptedContent) as NWCResponse;

            clearTimeout(timeout);
            subscription.unsubscribe();
            resolve(response);
          } catch (error) {
            console.error("[NWC] Failed to decrypt response:", error);
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
    });
  }

  /**
   * Get wallet info (capabilities, alias, etc.)
   */
  async getInfo(): Promise<{
    alias?: string;
    color?: string;
    pubkey?: string;
    network?: string;
    block_height?: number;
    block_hash?: string;
    methods: string[];
    notifications?: string[];
  }> {
    const response = await this.sendRequest("get_info");

    if (response.error) {
      throw new Error(response.error.message);
    }

    return response.result;
  }

  /**
   * Get current wallet balance in millisatoshis
   */
  async getBalance(): Promise<number> {
    const response = await this.sendRequest("get_balance");

    if (response.error) {
      throw new Error(response.error.message);
    }

    return response.result.balance;
  }

  /**
   * Pay a BOLT11 invoice
   */
  async payInvoice(invoice: string): Promise<{
    preimage: string;
  }> {
    const response = await this.sendRequest("pay_invoice", { invoice });

    if (response.error) {
      throw new Error(response.error.message);
    }

    return response.result;
  }

  /**
   * Make a new invoice
   */
  async makeInvoice(params: {
    amount: number;
    description?: string;
    description_hash?: string;
    expiry?: number;
  }): Promise<{
    type: string;
    invoice: string;
    description?: string;
    description_hash?: string;
    preimage?: string;
    payment_hash: string;
    amount: number;
    fees_paid: number;
    created_at: number;
    expires_at?: number;
    metadata?: Record<string, any>;
  }> {
    const response = await this.sendRequest("make_invoice", params);

    if (response.error) {
      throw new Error(response.error.message);
    }

    return response.result;
  }

  /**
   * Helper: Convert hex string to Uint8Array
   */
  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }
}
