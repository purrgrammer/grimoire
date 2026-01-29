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
 * - Connection health tracking with automatic recovery
 * - Uses library's support$ observable for cached wallet capabilities
 */

import { WalletConnect } from "applesauce-wallet-connect";
import type { NWCConnection } from "@/types/app";
import pool from "./relay-pool";
import { BehaviorSubject, Subscription, firstValueFrom, timeout } from "rxjs";

// Set the pool for wallet connect to use
WalletConnect.pool = pool;

let walletInstance: WalletConnect | null = null;
let notificationSubscription: Subscription | null = null;
let supportSubscription: Subscription | null = null;

/**
 * Connection status for the NWC wallet
 * - disconnected: No wallet connected
 * - connecting: Wallet is being restored/validated
 * - connected: Wallet is connected and responding
 * - error: Connection failed or lost
 */
export type NWCConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * Observable for connection status
 * Components can subscribe to this for real-time connection state using use$()
 */
export const connectionStatus$ = new BehaviorSubject<NWCConnectionStatus>(
  "disconnected",
);

/**
 * Observable for the last connection error
 * Components can use this to display error messages
 */
export const lastError$ = new BehaviorSubject<Error | null>(null);

/**
 * Observable for wallet balance updates
 * Components can subscribe to this for real-time balance changes using use$()
 */
export const balance$ = new BehaviorSubject<number | undefined>(undefined);

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
 * Subscribe to wallet notifications with automatic retry on error
 * This enables real-time balance updates when transactions occur
 */
function subscribeToNotificationsWithRetry(wallet: WalletConnect) {
  // Clean up existing subscription
  if (notificationSubscription) {
    notificationSubscription.unsubscribe();
    notificationSubscription = null;
  }

  let retryCount = 0;
  const maxRetries = 5;
  const baseDelay = 2000; // 2 seconds

  function subscribe() {
    console.log(
      `[NWC] Subscribing to wallet notifications (attempt ${retryCount + 1})`,
    );

    notificationSubscription = wallet.notifications$.subscribe({
      next: (notification) => {
        console.log("[NWC] Notification received:", notification);
        retryCount = 0; // Reset retry count on success

        // Mark as connected if we were in error state
        if (connectionStatus$.value === "error") {
          connectionStatus$.next("connected");
          lastError$.next(null);
        }

        // When we get a notification, refresh the balance
        refreshBalance();
      },
      error: (error) => {
        console.error("[NWC] Notification subscription error:", error);

        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          retryCount++;
          console.log(`[NWC] Retrying notification subscription in ${delay}ms`);
          connectionStatus$.next("connecting");
          setTimeout(subscribe, delay);
        } else {
          console.error("[NWC] Max notification retries reached");
          connectionStatus$.next("error");
          lastError$.next(
            error instanceof Error
              ? error
              : new Error("Notification subscription failed"),
          );
        }
      },
      complete: () => {
        console.log("[NWC] Notification subscription completed");
        // If subscription completes unexpectedly, try to reconnect
        if (walletInstance && retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          retryCount++;
          console.log(
            `[NWC] Subscription completed, reconnecting in ${delay}ms`,
          );
          setTimeout(subscribe, delay);
        }
      },
    });
  }

  subscribe();
}

/**
 * Subscribe to the wallet's support$ observable for cached capabilities
 * This keeps connection alive and validates the wallet is responding
 */
function subscribeToSupport(wallet: WalletConnect) {
  // Clean up existing subscription
  if (supportSubscription) {
    supportSubscription.unsubscribe();
    supportSubscription = null;
  }

  supportSubscription = wallet.support$.subscribe({
    next: (support) => {
      if (support) {
        console.log("[NWC] Wallet support info received:", support);
        // Mark as connected when we receive support info
        if (
          connectionStatus$.value === "connecting" ||
          connectionStatus$.value === "error"
        ) {
          connectionStatus$.next("connected");
          lastError$.next(null);
        }
      }
    },
    error: (error) => {
      console.error("[NWC] Support subscription error:", error);
      // Don't set error state here as notifications subscription handles recovery
    },
  });
}

/**
 * Creates a new WalletConnect instance from a connection string
 * Automatically subscribes to notifications for balance updates
 */
export function createWalletFromURI(connectionString: string): WalletConnect {
  connectionStatus$.next("connecting");
  lastError$.next(null);

  walletInstance = WalletConnect.fromConnectURI(connectionString);
  subscribeToSupport(walletInstance);
  subscribeToNotificationsWithRetry(walletInstance);

  return walletInstance;
}

/**
 * Restores a wallet from saved connection data
 * Used on app startup to reconnect to a previously connected wallet
 * Validates the connection using the support$ observable
 */
export async function restoreWallet(
  connection: NWCConnection,
): Promise<WalletConnect> {
  connectionStatus$.next("connecting");
  lastError$.next(null);

  walletInstance = new WalletConnect({
    service: connection.service,
    relays: connection.relays,
    secret: hexToBytes(connection.secret),
  });

  // Set initial balance from cache while we validate
  if (connection.balance !== undefined) {
    balance$.next(connection.balance);
  }

  // Subscribe to support$ for cached wallet capabilities
  subscribeToSupport(walletInstance);

  // Validate connection by waiting for support info with timeout
  try {
    console.log("[NWC] Validating wallet connection...");
    await firstValueFrom(
      walletInstance.support$.pipe(
        timeout({
          first: 10000, // 10 second timeout for first value
          with: () => {
            throw new Error("Connection validation timeout");
          },
        }),
      ),
    );
    console.log("[NWC] Wallet connection validated");
    connectionStatus$.next("connected");
  } catch (error) {
    console.error("[NWC] Wallet validation failed:", error);
    connectionStatus$.next("error");
    lastError$.next(
      error instanceof Error
        ? error
        : new Error("Connection validation failed"),
    );
    // Continue anyway - notifications subscription will retry
  }

  // Subscribe to notifications with retry logic
  subscribeToNotificationsWithRetry(walletInstance);

  // Refresh balance from wallet (not just cache)
  refreshBalance();

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
  if (supportSubscription) {
    supportSubscription.unsubscribe();
    supportSubscription = null;
  }
  walletInstance = null;
  balance$.next(undefined);
  connectionStatus$.next("disconnected");
  lastError$.next(null);
}

/**
 * Manually refresh the balance from the wallet
 * Useful for initial load or manual refresh button
 * Includes retry logic for reliability
 */
export async function refreshBalance(): Promise<number | undefined> {
  if (!walletInstance) return undefined;

  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await walletInstance.getBalance();
      const newBalance = result.balance;

      balance$.next(newBalance);

      // Mark as connected on successful balance fetch
      if (connectionStatus$.value === "error") {
        connectionStatus$.next("connected");
        lastError$.next(null);
      }

      return newBalance;
    } catch (error) {
      console.error(
        `[NWC] Failed to refresh balance (attempt ${attempt + 1}):`,
        error,
      );

      if (attempt < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelay * Math.pow(2, attempt)),
        );
      } else {
        // Only set error state on final failure if not already connected
        if (connectionStatus$.value !== "connected") {
          connectionStatus$.next("error");
          lastError$.next(
            error instanceof Error ? error : new Error("Failed to get balance"),
          );
        }
      }
    }
  }

  return undefined;
}

/**
 * Attempt to reconnect the wallet
 * Call this when the user wants to manually retry after an error
 */
export async function reconnect(): Promise<void> {
  if (!walletInstance) return;

  connectionStatus$.next("connecting");
  lastError$.next(null);

  // Re-subscribe to support and notifications
  subscribeToSupport(walletInstance);
  subscribeToNotificationsWithRetry(walletInstance);

  // Try to refresh balance
  await refreshBalance();
}
