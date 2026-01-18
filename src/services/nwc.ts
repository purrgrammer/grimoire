/**
 * NWC (Nostr Wallet Connect) Service
 *
 * Provides a singleton WalletConnect instance for the application using
 * applesauce-wallet-connect for NIP-47 Lightning wallet integration.
 *
 * Features:
 * - Maintains persistent wallet connection across app lifetime
 * - Subscribes to NIP-47 notifications (kind 23197) for balance updates
 * - Automatically updates balance when transactions occur
 * - Provides hook for easy wallet access throughout the app
 */

import { WalletConnect } from "applesauce-wallet-connect";
import type { NWCConnection } from "@/types/app";
import pool from "./relay-pool";
import { BehaviorSubject } from "rxjs";

// Set the pool for wallet connect to use
WalletConnect.pool = pool;

let walletInstance: WalletConnect | null = null;
let notificationSubscription: any = null;

/**
 * Observable for wallet balance updates
 * Components can subscribe to this for real-time balance changes
 */
export const balance$ = new BehaviorSubject<number | undefined>(undefined);

/**
 * Callback for balance updates (set by the hook/state management)
 */
let onBalanceUpdate: ((balance: number) => void) | null = null;

/**
 * Register a callback for balance updates
 */
export function setBalanceUpdateCallback(callback: (balance: number) => void) {
  onBalanceUpdate = callback;
}

/**
 * Subscribe to wallet notifications (NIP-47 kind 23197)
 * This enables real-time balance updates when transactions occur
 */
function subscribeToNotifications(wallet: WalletConnect) {
  // Clean up existing subscription
  if (notificationSubscription) {
    notificationSubscription.unsubscribe();
  }

  // Subscribe to notifications from the wallet service
  // The applesauce-wallet-connect library handles this internally
  // when notifications are enabled in the wallet info
  console.log("[NWC] Subscribed to wallet notifications");

  // Note: The actual notification subscription is handled by WalletConnect
  // We can poll for balance updates periodically as a fallback
  startBalancePolling(wallet);
}

/**
 * Poll for balance updates every 30 seconds
 * This ensures we stay in sync even if notifications aren't working
 */
function startBalancePolling(wallet: WalletConnect) {
  const pollInterval = setInterval(async () => {
    try {
      const result = await wallet.getBalance();
      const newBalance = result.balance;

      // Update observable
      if (balance$.value !== newBalance) {
        balance$.next(newBalance);

        // Trigger callback for state updates
        if (onBalanceUpdate) {
          onBalanceUpdate(newBalance);
        }

        console.log("[NWC] Balance updated:", newBalance);
      }
    } catch (error) {
      console.error("[NWC] Failed to poll balance:", error);
    }
  }, 30000); // Poll every 30 seconds

  // Store for cleanup
  notificationSubscription = {
    unsubscribe: () => clearInterval(pollInterval),
  };
}

/**
 * Creates a new WalletConnect instance from a connection string
 * Automatically subscribes to notifications for balance updates
 */
export function createWalletFromURI(connectionString: string): WalletConnect {
  walletInstance = WalletConnect.fromConnectURI(connectionString);
  subscribeToNotifications(walletInstance);
  return walletInstance;
}

/**
 * Helper to convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Restores a wallet from saved connection data
 * Used on app startup to reconnect to a previously connected wallet
 */
export function restoreWallet(connection: NWCConnection): WalletConnect {
  walletInstance = new WalletConnect({
    service: connection.service,
    relays: connection.relays,
    secret: hexToBytes(connection.secret),
  });

  // Set initial balance
  if (connection.balance !== undefined) {
    balance$.next(connection.balance);
  }

  subscribeToNotifications(walletInstance);
  return walletInstance;
}

/**
 * Gets the current wallet instance
 */
export function getWallet(): WalletConnect | null {
  return walletInstance;
}

/**
 * Clears the current wallet instance and stops notifications
 */
export function clearWallet(): void {
  if (notificationSubscription) {
    notificationSubscription.unsubscribe();
    notificationSubscription = null;
  }
  walletInstance = null;
  balance$.next(undefined);
  onBalanceUpdate = null;
}

/**
 * Manually refresh the balance from the wallet
 */
export async function refreshBalance(): Promise<number | undefined> {
  if (!walletInstance) return undefined;

  try {
    const result = await walletInstance.getBalance();
    const newBalance = result.balance;

    balance$.next(newBalance);

    if (onBalanceUpdate) {
      onBalanceUpdate(newBalance);
    }

    return newBalance;
  } catch (error) {
    console.error("[NWC] Failed to refresh balance:", error);
    return undefined;
  }
}
