/**
 * NIP-60 Cashu Wallet Utilities
 * Helpers for working with encrypted wallet data on Nostr
 */

import type { NostrEvent } from "nostr-tools";
import type { ISigner } from "applesauce-signers";

/**
 * NIP-60 Wallet Configuration (kind:17375)
 * Stored as encrypted JSON in event content
 */
export interface WalletConfig {
  /** Wallet private key (for signing Cashu operations) */
  privkey: string;
  /** Array of mint URLs this wallet uses */
  mints: string[];
  /** Optional wallet metadata */
  name?: string;
  description?: string;
  unit?: string; // e.g., "sat", "usd"
  relays?: string[];
}

/**
 * NIP-60 Unspent Token Data (kind:7375)
 * Contains Cashu proofs that can be spent
 */
export interface UnspentTokens {
  /** Mint URL these proofs are from */
  mint: string;
  /** Array of Cashu proofs (ecash tokens) */
  proofs: CashuProof[];
}

/**
 * Cashu Proof (ecash token)
 * Represents a spendable token with a specific amount
 */
export interface CashuProof {
  /** Unique identifier for this proof */
  id: string;
  /** Amount in base units (sats) */
  amount: number;
  /** Secret blinding factor */
  secret: string;
  /** Proof signature from mint */
  C: string;
  /** Keyset ID from mint */
  keyset_id?: string;
}

/**
 * NIP-60 Transaction History (kind:7376)
 * Records of past wallet operations
 */
export interface TransactionHistory {
  /** Array of transaction records */
  transactions: Transaction[];
}

/**
 * Transaction Record
 */
export interface Transaction {
  /** Transaction type */
  type: "mint" | "melt" | "send" | "receive";
  /** Amount in base units */
  amount: number;
  /** Mint URL */
  mint: string;
  /** Unix timestamp */
  timestamp: number;
  /** Optional memo/note */
  memo?: string;
  /** Optional related event ID (for sends/receives) */
  event_id?: string;
}

/**
 * Decrypts a NIP-60 wallet config event
 * @param event kind:17375 wallet config event
 * @param signer Account signer with nip44 support
 * @returns Decrypted wallet configuration
 */
export async function decryptWalletConfig(
  event: NostrEvent,
  signer: ISigner,
): Promise<WalletConfig | null> {
  if (!signer.nip44) {
    throw new Error("Signer does not support NIP-44 encryption");
  }

  try {
    const decrypted = await signer.nip44.decrypt(event.pubkey, event.content);
    return JSON.parse(decrypted) as WalletConfig;
  } catch (error) {
    console.error("Failed to decrypt wallet config:", error);
    return null;
  }
}

/**
 * Decrypts a NIP-60 unspent tokens event
 * @param event kind:7375 unspent tokens event
 * @param signer Account signer with nip44 support
 * @returns Decrypted unspent tokens
 */
export async function decryptUnspentTokens(
  event: NostrEvent,
  signer: ISigner,
): Promise<UnspentTokens | null> {
  if (!signer.nip44) {
    throw new Error("Signer does not support NIP-44 encryption");
  }

  try {
    const decrypted = await signer.nip44.decrypt(event.pubkey, event.content);
    return JSON.parse(decrypted) as UnspentTokens;
  } catch (error) {
    console.error("Failed to decrypt unspent tokens:", error);
    return null;
  }
}

/**
 * Decrypts a NIP-60 transaction history event
 * @param event kind:7376 transaction history event
 * @param signer Account signer with nip44 support
 * @returns Decrypted transaction history
 */
export async function decryptTransactionHistory(
  event: NostrEvent,
  signer: ISigner,
): Promise<TransactionHistory | null> {
  if (!signer.nip44) {
    throw new Error("Signer does not support NIP-44 encryption");
  }

  try {
    const decrypted = await signer.nip44.decrypt(event.pubkey, event.content);
    return JSON.parse(decrypted) as TransactionHistory;
  } catch (error) {
    console.error("Failed to decrypt transaction history:", error);
    return null;
  }
}

/**
 * Calculates total balance from all unspent token events
 * @param tokenEvents Array of decrypted UnspentTokens
 * @returns Total balance in base units (sats) grouped by mint
 */
export function calculateBalance(
  tokenEvents: UnspentTokens[],
): Map<string, number> {
  const balanceByMint = new Map<string, number>();

  for (const tokens of tokenEvents) {
    const currentBalance = balanceByMint.get(tokens.mint) || 0;
    const tokenSum = tokens.proofs.reduce(
      (sum, proof) => sum + proof.amount,
      0,
    );
    balanceByMint.set(tokens.mint, currentBalance + tokenSum);
  }

  return balanceByMint;
}

/**
 * Gets total balance across all mints
 * @param balanceByMint Map of mint URLs to balances
 * @returns Total balance in base units (sats)
 */
export function getTotalBalance(balanceByMint: Map<string, number>): number {
  let total = 0;
  for (const balance of balanceByMint.values()) {
    total += balance;
  }
  return total;
}

/**
 * Formats balance for display
 * @param sats Balance in satoshis
 * @param unit Unit to display ("sat" or "btc")
 * @returns Formatted balance string
 */
export function formatBalance(
  sats: number,
  unit: "sat" | "btc" = "sat",
): string {
  if (unit === "btc") {
    return (sats / 100_000_000).toFixed(8) + " BTC";
  }
  return sats.toLocaleString() + " sats";
}

/**
 * Sorts transactions by timestamp (most recent first)
 * @param transactions Array of transactions
 * @returns Sorted array
 */
export function sortTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Gets a short mint display name from URL
 * @param mintUrl Full mint URL
 * @returns Shortened display name
 */
export function getMintDisplayName(mintUrl: string): string {
  try {
    const url = new URL(mintUrl);
    return url.hostname;
  } catch {
    return mintUrl;
  }
}
