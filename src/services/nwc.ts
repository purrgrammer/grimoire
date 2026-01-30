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
import {
  type TransactionsState,
  INITIAL_TRANSACTIONS_STATE,
} from "@/types/wallet";
import pool from "./relay-pool";
import {
  BehaviorSubject,
  Subscription,
  firstValueFrom,
  race,
  timer,
  map,
} from "rxjs";

// Configure the pool for wallet connect
WalletConnect.pool = pool;

// Internal state
let notificationSubscription: Subscription | null = null;
let notificationRetryTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Subscription that keeps the wallet's support$ observable alive.
 *
 * CRITICAL: The applesauce-wallet-connect library's support$ uses a ReplaySubject(1)
 * with resetOnRefCountZero: timer(60000). This means if no one subscribes to support$
 * for 60 seconds, the cached value is LOST. Then genericCall's firstValueFrom(encryption$)
 * hangs forever waiting for a new kind 13194 event.
 *
 * We keep a persistent subscription to support$ to prevent this reset.
 */
let supportSubscription: Subscription | null = null;

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

/** Transaction list state (lazy loaded) */
export const transactionsState$ = new BehaviorSubject<TransactionsState>(
  INITIAL_TRANSACTIONS_STATE,
);

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
  // Clean up existing subscription and pending retry
  notificationSubscription?.unsubscribe();
  notificationSubscription = null;
  if (notificationRetryTimeout) {
    clearTimeout(notificationRetryTimeout);
    notificationRetryTimeout = null;
  }

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

        // Refresh balance and transactions on any notification
        refreshBalance();
        refreshTransactions();
      },
      error: (error) => {
        console.error("[NWC] Notification error:", error);

        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          retryCount++;
          connectionStatus$.next("connecting");
          notificationRetryTimeout = setTimeout(subscribe, delay);
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
          notificationRetryTimeout = setTimeout(subscribe, delay);
        }
      },
    });
  }

  subscribe();
}

/**
 * Waits for the wallet's support$ to emit and creates a persistent subscription.
 *
 * CRITICAL: The applesauce-wallet-connect library has two issues:
 * 1. genericCall waits for encryption$ (derived from support$) without any timeout
 * 2. support$ uses ReplaySubject(1) with resetOnRefCountZero: timer(60000)
 *
 * This means if no one subscribes to support$ for 60 seconds, the cached value is LOST,
 * and subsequent genericCall invocations hang forever waiting for a new kind 13194 event.
 *
 * This function:
 * 1. Waits for support$ to emit with a timeout
 * 2. Creates a PERSISTENT subscription to support$ to prevent the ReplaySubject reset
 *
 * @param wallet The wallet instance
 * @param timeoutMs Maximum time to wait (default: 15 seconds)
 * @throws Error if support$ doesn't emit within timeout
 */
async function waitForSupport(
  wallet: WalletConnect,
  timeoutMs = 15000,
): Promise<void> {
  // Clean up any existing subscription
  supportSubscription?.unsubscribe();
  supportSubscription = null;

  try {
    // Race support$ against a timeout
    // This ensures we don't hang forever waiting for kind 13194 events
    await firstValueFrom(
      race(
        wallet.support$,
        timer(timeoutMs).pipe(
          map(() => {
            throw new Error(
              "Wallet connection timeout - wallet service not responding",
            );
          }),
        ),
      ),
    );

    // CRITICAL: Create a persistent subscription to support$ to prevent
    // the ReplaySubject from resetting after 60 seconds of inactivity.
    // Without this, genericCall's firstValueFrom(encryption$) would hang
    // if the user waits >60 seconds between operations.
    supportSubscription = wallet.support$.subscribe({
      next: (support) => {
        console.log(
          "[NWC] Support info updated:",
          support?.methods?.length,
          "methods available",
        );
      },
      error: (err) => {
        console.error("[NWC] Support subscription error:", err);
      },
    });

    console.log("[NWC] Wallet support info received, ready for operations");
  } catch (error) {
    console.error("[NWC] Failed to get wallet support info:", error);
    throw error;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Creates a new wallet connection from a NWC URI.
 * Used when user connects a new wallet.
 * Waits for wallet to be ready before returning.
 */
export async function createWalletFromURI(
  connectionString: string,
): Promise<WalletConnect> {
  connectionStatus$.next("connecting");
  lastError$.next(null);

  const wallet = WalletConnect.fromConnectURI(connectionString);
  wallet$.next(wallet);

  // Subscribe to notifications to keep events$ alive
  subscribeToNotifications(wallet);

  // Wait for wallet to be ready (support$ must emit)
  try {
    await waitForSupport(wallet, 15000);
    connectionStatus$.next("connected");
    // Start fetching balance after wallet is ready
    refreshBalance();
  } catch (error) {
    console.error("[NWC] Wallet connection failed:", error);
    connectionStatus$.next("error");
    lastError$.next(
      error instanceof Error ? error : new Error("Connection failed"),
    );
    throw error; // Re-throw so the dialog can show the error
  }

  return wallet;
}

/**
 * Restores a wallet from saved connection data.
 * Sets up notification subscription first to keep events$ alive,
 * then waits for support info to validate the connection.
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

  // IMPORTANT: Subscribe to notifications FIRST to keep events$ alive.
  // This ensures the relay subscription is established before we wait for support$.
  // Without this, support$ might never emit because there's no active subscription.
  subscribeToNotifications(wallet);

  // Now wait for support$ to emit (validates the wallet is responding)
  // This uses a longer timeout since we need the relay to connect and wallet to respond
  try {
    await waitForSupport(wallet, 15000);
    connectionStatus$.next("connected");
    // Start fetching balance after wallet is ready
    refreshBalance();
  } catch (error) {
    console.error("[NWC] Wallet validation failed:", error);
    connectionStatus$.next("error");
    lastError$.next(
      error instanceof Error ? error : new Error("Connection failed"),
    );
    // Don't call refreshBalance() here - the wallet isn't ready and it would hang
  }

  return wallet;
}

/**
 * Disconnects and clears the wallet.
 */
export function clearWallet(): void {
  // Clean up subscriptions and pending retry
  notificationSubscription?.unsubscribe();
  notificationSubscription = null;
  supportSubscription?.unsubscribe();
  supportSubscription = null;
  if (notificationRetryTimeout) {
    clearTimeout(notificationRetryTimeout);
    notificationRetryTimeout = null;
  }

  wallet$.next(null);
  balance$.next(undefined);
  connectionStatus$.next("disconnected");
  lastError$.next(null);
  resetTransactions();
}

/**
 * Refreshes the balance from the wallet.
 * Includes retry logic with exponential backoff for reliability.
 *
 * Note: If we're already connected and a balance fetch fails after retries,
 * we don't set error state. This prevents UI flapping - the notification
 * subscription is the primary health indicator. A transient balance fetch
 * failure shouldn't mark an otherwise working connection as errored.
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
        // Only set error state if not already connected (e.g., during initial validation)
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
 * Resets support tracking and waits for wallet to become ready again.
 */
export async function reconnect(): Promise<void> {
  const wallet = wallet$.value;
  if (!wallet) return;

  connectionStatus$.next("connecting");
  lastError$.next(null);

  // Re-subscribe to notifications (this keeps events$ alive)
  subscribeToNotifications(wallet);

  // Wait for wallet to become ready
  try {
    await waitForSupport(wallet, 15000);
    connectionStatus$.next("connected");
    await refreshBalance();
  } catch (error) {
    console.error("[NWC] Reconnect failed:", error);
    connectionStatus$.next("error");
    lastError$.next(
      error instanceof Error ? error : new Error("Reconnection failed"),
    );
  }
}

// ============================================================================
// Transaction loading (lazy, paginated)
// ============================================================================

const TRANSACTIONS_PAGE_SIZE = 20;

/**
 * Loads the initial batch of transactions.
 * Only loads if not already initialized (lazy loading).
 */
export async function loadTransactions(): Promise<void> {
  const wallet = wallet$.value;
  if (!wallet) return;

  const current = transactionsState$.value;

  // Skip if already loading or initialized
  if (current.loading || current.initialized) return;

  transactionsState$.next({
    ...current,
    loading: true,
    error: null,
  });

  try {
    const result = await wallet.listTransactions({
      limit: TRANSACTIONS_PAGE_SIZE,
    });

    transactionsState$.next({
      items: result.transactions,
      loading: false,
      loadingMore: false,
      hasMore: result.transactions.length >= TRANSACTIONS_PAGE_SIZE,
      error: null,
      initialized: true,
    });
  } catch (error) {
    console.error("[NWC] Failed to load transactions:", error);
    transactionsState$.next({
      ...transactionsState$.value,
      loading: false,
      error:
        error instanceof Error
          ? error
          : new Error("Failed to load transactions"),
      initialized: true,
    });
  }
}

/**
 * Loads more transactions (pagination).
 */
export async function loadMoreTransactions(): Promise<void> {
  const wallet = wallet$.value;
  if (!wallet) return;

  const current = transactionsState$.value;

  // Skip if already loading or no more to load
  if (current.loading || current.loadingMore || !current.hasMore) return;

  transactionsState$.next({
    ...current,
    loadingMore: true,
  });

  try {
    // Get the oldest transaction timestamp for pagination
    const oldestTx = current.items[current.items.length - 1];
    const until = oldestTx?.created_at;

    const result = await wallet.listTransactions({
      limit: TRANSACTIONS_PAGE_SIZE,
      until,
    });

    // Filter out any duplicates (in case of overlapping timestamps)
    const existingHashes = new Set(current.items.map((tx) => tx.payment_hash));
    const newTransactions = result.transactions.filter(
      (tx) => !existingHashes.has(tx.payment_hash),
    );

    transactionsState$.next({
      ...current,
      items: [...current.items, ...newTransactions],
      loadingMore: false,
      hasMore: result.transactions.length >= TRANSACTIONS_PAGE_SIZE,
    });
  } catch (error) {
    console.error("[NWC] Failed to load more transactions:", error);
    transactionsState$.next({
      ...current,
      loadingMore: false,
      error:
        error instanceof Error
          ? error
          : new Error("Failed to load more transactions"),
    });
  }
}

/**
 * Refreshes the transaction list (prepends new transactions).
 * Called automatically on payment notifications.
 */
export async function refreshTransactions(): Promise<void> {
  const wallet = wallet$.value;
  if (!wallet) return;

  const current = transactionsState$.value;

  // Only refresh if already initialized
  if (!current.initialized) return;

  try {
    // Get the newest transaction timestamp
    const newestTx = current.items[0];
    const from = newestTx?.created_at ? newestTx.created_at + 1 : undefined;

    const result = await wallet.listTransactions({
      limit: TRANSACTIONS_PAGE_SIZE,
      from,
    });

    // Filter out duplicates and prepend new transactions
    const existingHashes = new Set(current.items.map((tx) => tx.payment_hash));
    const newTransactions = result.transactions.filter(
      (tx) => !existingHashes.has(tx.payment_hash),
    );

    if (newTransactions.length > 0) {
      transactionsState$.next({
        ...current,
        items: [...newTransactions, ...current.items],
      });
    }
  } catch (error) {
    console.error("[NWC] Failed to refresh transactions:", error);
  }
}

/**
 * Resets transaction state (called on wallet clear).
 */
function resetTransactions(): void {
  transactionsState$.next(INITIAL_TRANSACTIONS_STATE);
}

/**
 * Force reload transactions (used for retry after error).
 */
export async function retryLoadTransactions(): Promise<void> {
  resetTransactions();
  await loadTransactions();
}
