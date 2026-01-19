/**
 * NWC (Nostr Wallet Connect) Service
 *
 * Provides a singleton WalletConnect instance for the application using
 * applesauce-wallet-connect for NIP-47 Lightning wallet integration.
 *
 * Features:
 * - Maintains persistent wallet connection across app lifetime
 * - Subscribes to NIP-47 notifications (kind 23197) for balance updates
 * - Fully reactive using RxJS observables (no polling!)
 * - Components use use$() to reactively subscribe to balance changes
 */

import { WalletConnect } from "applesauce-wallet-connect";
import type { NWCConnection } from "@/types/app";
import pool from "./relay-pool";
import { BehaviorSubject, Subscription } from "rxjs";

// Set the pool for wallet connect to use
WalletConnect.pool = pool;

let walletInstance: WalletConnect | null = null;
let notificationSubscription: Subscription | null = null;

/**
 * Observable for wallet balance updates
 * Components can subscribe to this for real-time balance changes using use$()
 */
export const balance$ = new BehaviorSubject<number | undefined>(undefined);

/**
 * Cached wallet info type
 * Contains the essential fields from NIP-47 get_info response
 */
export type WalletInfo = {
  alias?: string;
  methods: string[];
  notifications?: string[];
  network?: string;
};

/**
 * Observable for wallet info
 * Cached from initial connection, components can subscribe via use$()
 */
export const info$ = new BehaviorSubject<WalletInfo | undefined>(undefined);

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
 * Subscribe to wallet notifications (NIP-47 kind 23197)
 * This enables real-time balance updates when transactions occur
 */
function subscribeToNotifications(wallet: WalletConnect) {
  // Clean up existing subscription
  if (notificationSubscription) {
    notificationSubscription.unsubscribe();
  }

  console.log("[NWC] Subscribing to wallet notifications");

  // Subscribe to the wallet's notifications$ observable
  // This receives events like payment_received, payment_sent, etc.
  notificationSubscription = wallet.notifications$.subscribe({
    next: (notification) => {
      console.log("[NWC] Notification received:", notification);

      // When we get a notification, refresh the balance
      // The notification types include: payment_received, payment_sent, etc.
      wallet
        .getBalance()
        .then((result) => {
          const newBalance = result.balance;
          if (balance$.value !== newBalance) {
            balance$.next(newBalance);
            console.log("[NWC] Balance updated from notification:", newBalance);
          }
        })
        .catch((error) => {
          console.error(
            "[NWC] Failed to fetch balance after notification:",
            error,
          );
        });
    },
    error: (error) => {
      console.error("[NWC] Notification subscription error:", error);
    },
  });
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
 * Restores a wallet from saved connection data
 * Used on app startup to reconnect to a previously connected wallet
 */
export function restoreWallet(connection: NWCConnection): WalletConnect {
  walletInstance = new WalletConnect({
    service: connection.service,
    relays: connection.relays,
    secret: hexToBytes(connection.secret),
  });

  // Set initial balance from cache
  if (connection.balance !== undefined) {
    balance$.next(connection.balance);
  }

  // Set cached info from connection
  if (connection.info) {
    info$.next(connection.info);
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
  info$.next(undefined);
}

/**
 * Set the cached wallet info
 * Called after initial connection to cache the get_info response
 */
export function setWalletInfo(info: WalletInfo): void {
  info$.next(info);
}

/**
 * Manually refresh the balance from the wallet
 * Useful for initial load or manual refresh button
 */
export async function refreshBalance(): Promise<number | undefined> {
  if (!walletInstance) return undefined;

  try {
    const result = await walletInstance.getBalance();
    const newBalance = result.balance;

    balance$.next(newBalance);
    return newBalance;
  } catch (error) {
    console.error("[NWC] Failed to refresh balance:", error);
    return undefined;
  }
}
