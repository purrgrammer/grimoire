/**
 * NWC (Nostr Wallet Connect) Service
 *
 * Provides a singleton WalletConnect instance for the application using
 * applesauce-wallet-connect for NIP-47 Lightning wallet integration.
 */

import { WalletConnect } from "applesauce-wallet-connect";
import pool from "./relay-pool";

// Set the pool for wallet connect to use
WalletConnect.pool = pool;

let walletInstance: WalletConnect | null = null;

/**
 * Creates a new WalletConnect instance from a connection string
 */
export function createWalletFromURI(connectionString: string): WalletConnect {
  walletInstance = WalletConnect.fromConnectURI(connectionString);
  return walletInstance;
}

/**
 * Gets the current wallet instance
 */
export function getWallet(): WalletConnect | null {
  return walletInstance;
}

/**
 * Clears the current wallet instance
 */
export function clearWallet(): void {
  walletInstance = null;
}

/**
 * Sets the wallet instance (used for restoring from saved state)
 */
export function setWallet(wallet: WalletConnect): void {
  walletInstance = wallet;
}
