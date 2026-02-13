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
import { BehaviorSubject, Subscription, firstValueFrom, timeout } from "rxjs";

// Configure wallet connect with custom methods that don't filter offline relays.
//
// By default, pool.subscription() and pool.publish() call pool.group(relays)
// with ignoreOffline=true, which silently drops relays in reconnect backoff.
// This causes NWC requests to be published to ZERO relays if the NWC relay
// has a momentary disconnection, making pay_invoice appear to time out.
//
// Using ignoreOffline=false ensures the underlying Relay.waitForReady() is
// used instead, which queues operations until the relay reconnects rather
// than silently dropping them.
WalletConnect.subscriptionMethod = (relays, filters) =>
  pool.group(relays, false).subscription(filters);
WalletConnect.publishMethod = (relays, event) =>
  pool.group(relays, false).publish(event);

// Internal state
let notificationSubscription: Subscription | null = null;
let notificationRetryTimeout: ReturnType<typeof setTimeout> | null = null;
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

/**
 * Subscribe to wallet support info to keep the ReplaySubject(1) cache warm.
 *
 * The library's support$ uses share({ connector: () => new ReplaySubject(1),
 * resetOnRefCountZero: () => timer(60000) }). If all subscribers drop for 60s,
 * the cached wallet info (kind 13194) is lost. Since events$ is hot, the relay
 * won't re-send the info event, so genericCall's firstValueFrom(encryption$)
 * hangs indefinitely — causing every wallet operation to time out.
 *
 * This persistent subscription prevents the cache from expiring.
 */
function subscribeToSupport(wallet: WalletConnect) {
  supportSubscription?.unsubscribe();
  supportSubscription = wallet.support$.subscribe();
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

  subscribeToSupport(wallet);
  subscribeToNotifications(wallet);
  refreshBalance(); // Fetch initial balance

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

  const wallet = WalletConnect.fromJSON({
    service: connection.service,
    relays: connection.relays,
    secret: connection.secret,
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

  subscribeToSupport(wallet);
  subscribeToNotifications(wallet);
  refreshBalance();

  return wallet;
}

/**
 * Disconnects and clears the wallet.
 */
export function clearWallet(): void {
  // Clean up subscriptions and pending retry
  supportSubscription?.unsubscribe();
  supportSubscription = null;
  notificationSubscription?.unsubscribe();
  notificationSubscription = null;
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
 */
export async function reconnect(): Promise<void> {
  const wallet = wallet$.value;
  if (!wallet) return;

  connectionStatus$.next("connecting");
  lastError$.next(null);

  subscribeToSupport(wallet);
  subscribeToNotifications(wallet);
  await refreshBalance();
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
