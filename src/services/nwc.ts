/**
 * NWC (Nostr Wallet Connect) Service
 *
 * Provides a singleton WalletConnect instance for the application using
 * applesauce-wallet-connect for NIP-47 Lightning wallet integration.
 *
 * Architecture:
 * - All state is exposed via BehaviorSubject observables
 * - Components subscribe via use$() for automatic updates
 * - Notification subscription handles balance updates reactively
 * - Automatic retry with exponential backoff on failures
 */

import { WalletConnect } from "applesauce-wallet-connect";
import type { NWCConnection } from "@/types/app";
import pool from "./relay-pool";
import { BehaviorSubject, Subscription, firstValueFrom, timeout } from "rxjs";

// Configure the pool for wallet connect
WalletConnect.pool = pool;

// Internal state
let notificationSubscription: Subscription | null = null;

/**
 * Connection status for the NWC wallet
 */
export type NWCConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// ============================================================================
// Observables - All state is exposed reactively
// ============================================================================

/** The current wallet instance (null if not connected) */
export const wallet$ = new BehaviorSubject<WalletConnect | null>(null);

/** Connection status */
export const connectionStatus$ = new BehaviorSubject<NWCConnectionStatus>(
  "disconnected",
);

/** Last connection error (null if no error) */
export const lastError$ = new BehaviorSubject<Error | null>(null);

/** Current balance in millisats */
export const balance$ = new BehaviorSubject<number | undefined>(undefined);

// ============================================================================
// Internal helpers
// ============================================================================

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Subscribe to wallet notifications with automatic retry on error.
 * Notifications trigger balance refresh for real-time updates.
 */
function subscribeToNotifications(wallet: WalletConnect) {
  // Clean up existing subscription
  notificationSubscription?.unsubscribe();
  notificationSubscription = null;

  let retryCount = 0;
  const maxRetries = 5;
  const baseDelay = 2000;

  function subscribe() {
    notificationSubscription = wallet.notifications$.subscribe({
      next: (notification) => {
        console.log(
          "[NWC] Notification received:",
          notification.notification_type,
        );
        retryCount = 0;

        // Recover from error state on successful notification
        if (connectionStatus$.value === "error") {
          connectionStatus$.next("connected");
          lastError$.next(null);
        }

        // Refresh balance on any notification
        refreshBalance();
      },
      error: (error) => {
        console.error("[NWC] Notification error:", error);

        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          retryCount++;
          connectionStatus$.next("connecting");
          setTimeout(subscribe, delay);
        } else {
          connectionStatus$.next("error");
          lastError$.next(
            error instanceof Error
              ? error
              : new Error("Notification subscription failed"),
          );
        }
      },
      complete: () => {
        // Reconnect if subscription completes unexpectedly
        if (wallet$.value && retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          retryCount++;
          setTimeout(subscribe, delay);
        }
      },
    });
  }

  subscribe();
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Creates a new wallet connection from a NWC URI.
 * Used when user connects a new wallet.
 */
export function createWalletFromURI(connectionString: string): WalletConnect {
  connectionStatus$.next("connecting");
  lastError$.next(null);

  const wallet = WalletConnect.fromConnectURI(connectionString);
  wallet$.next(wallet);

  subscribeToNotifications(wallet);

  return wallet;
}

/**
 * Restores a wallet from saved connection data.
 * Validates the connection before marking as connected.
 */
export async function restoreWallet(
  connection: NWCConnection,
): Promise<WalletConnect> {
  connectionStatus$.next("connecting");
  lastError$.next(null);

  const wallet = new WalletConnect({
    service: connection.service,
    relays: connection.relays,
    secret: hexToBytes(connection.secret),
  });

  wallet$.next(wallet);

  // Show cached balance immediately while validating
  if (connection.balance !== undefined) {
    balance$.next(connection.balance);
  }

  // Validate connection by waiting for support info
  try {
    await firstValueFrom(
      wallet.support$.pipe(
        timeout({
          first: 10000,
          with: () => {
            throw new Error("Connection timeout");
          },
        }),
      ),
    );
    connectionStatus$.next("connected");
  } catch (error) {
    console.error("[NWC] Validation failed:", error);
    connectionStatus$.next("error");
    lastError$.next(
      error instanceof Error ? error : new Error("Connection failed"),
    );
    // Continue anyway - notifications will retry
  }

  subscribeToNotifications(wallet);
  refreshBalance();

  return wallet;
}

/**
 * Disconnects and clears the wallet.
 */
export function clearWallet(): void {
  notificationSubscription?.unsubscribe();
  notificationSubscription = null;

  wallet$.next(null);
  balance$.next(undefined);
  connectionStatus$.next("disconnected");
  lastError$.next(null);
}

/**
 * Refreshes the balance from the wallet.
 * Includes retry logic for reliability.
 */
export async function refreshBalance(): Promise<number | undefined> {
  const wallet = wallet$.value;
  if (!wallet) return undefined;

  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await wallet.getBalance();
      balance$.next(result.balance);

      // Recover from error state on success
      if (connectionStatus$.value === "error") {
        connectionStatus$.next("connected");
        lastError$.next(null);
      }

      return result.balance;
    } catch (error) {
      console.error(
        `[NWC] Balance refresh failed (attempt ${attempt + 1}):`,
        error,
      );

      if (attempt < maxRetries - 1) {
        await new Promise((r) =>
          setTimeout(r, baseDelay * Math.pow(2, attempt)),
        );
      } else if (connectionStatus$.value !== "connected") {
        connectionStatus$.next("error");
        lastError$.next(
          error instanceof Error ? error : new Error("Failed to get balance"),
        );
      }
    }
  }

  return undefined;
}

/**
 * Attempts to reconnect after an error.
 */
export async function reconnect(): Promise<void> {
  const wallet = wallet$.value;
  if (!wallet) return;

  connectionStatus$.next("connecting");
  lastError$.next(null);

  subscribeToNotifications(wallet);
  await refreshBalance();
}
