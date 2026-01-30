/**
 * useWallet Hook
 *
 * Provides reactive access to the NWC wallet throughout the application.
 * All state is derived from observables - no manual synchronization needed.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { wallet, balance, connectionStatus, walletMethods, payInvoice } = useWallet();
 *
 *   if (connectionStatus === 'error') {
 *     return <ErrorState onRetry={reconnect} />;
 *   }
 *
 *   // walletMethods combines support$ with cached info for reliability
 *   if (walletMethods.includes('pay_invoice')) {
 *     return <PayButton onClick={() => payInvoice("lnbc...")} />;
 *   }
 *
 *   return <div>Balance: {formatSats(balance)}</div>;
 * }
 * ```
 */

import { useEffect, useMemo, useRef } from "react";
import { use$ } from "applesauce-react/hooks";
import { useGrimoire } from "@/core/state";
import type { WalletSupport } from "applesauce-wallet-connect/helpers";
import {
  wallet$,
  restoreWallet,
  clearWallet,
  refreshBalance as refreshBalanceService,
  reconnect as reconnectService,
  balance$,
  connectionStatus$,
  lastError$,
  transactionsState$,
  loadTransactions as loadTransactionsService,
  loadMoreTransactions as loadMoreTransactionsService,
  retryLoadTransactions as retryLoadTransactionsService,
  ensureWalletReady,
} from "@/services/nwc";

export function useWallet() {
  const { state } = useGrimoire();
  const nwcConnection = state.nwcConnection;
  const restoreAttemptedRef = useRef(false);

  // All state derived from observables
  const wallet = use$(wallet$);
  const balance = use$(balance$);
  const connectionStatus = use$(connectionStatus$);
  const lastError = use$(lastError$);
  const transactionsState = use$(transactionsState$);

  // Wallet support from library's support$ observable (cached by library for 60s)
  const support: WalletSupport | null | undefined = use$(
    () => wallet?.support$,
    [wallet],
  );

  // Wallet methods - combines reactive support$ with cached info fallback
  // The support$ waits for kind 13194 events which some wallets don't publish
  const walletMethods = useMemo(() => {
    return support?.methods ?? state.nwcConnection?.info?.methods ?? [];
  }, [support?.methods, state.nwcConnection?.info?.methods]);

  // Restore wallet on mount if connection exists
  // Note: Not awaited intentionally - wallet is available synchronously from wallet$
  // before validation completes. Any async errors are handled within restoreWallet.
  useEffect(() => {
    if (nwcConnection && !wallet && !restoreAttemptedRef.current) {
      restoreAttemptedRef.current = true;
      restoreWallet(nwcConnection);
    }
  }, [nwcConnection, wallet]);

  // Reset restore flag when connection is cleared
  useEffect(() => {
    if (!nwcConnection) {
      restoreAttemptedRef.current = false;
    }
  }, [nwcConnection]);

  // Derived state
  const isConnected = connectionStatus !== "disconnected";

  // ============================================================================
  // Wallet operations
  // ============================================================================

  /**
   * Pay a Lightning invoice via NWC.
   *
   * IMPORTANT: This first calls ensureWalletReady() to ensure the wallet's
   * support$ observable has emitted. Without this, wallet.payInvoice() can
   * hang forever because the applesauce-wallet-connect library's genericCall
   * waits for encryption$ (derived from support$) without any timeout.
   */
  async function payInvoice(invoice: string, amount?: number) {
    // Ensure wallet is ready - this waits for support$ with a timeout
    // instead of letting it hang forever
    const readyWallet = await ensureWalletReady();
    const result = await readyWallet.payInvoice(invoice, amount);
    await refreshBalanceService();
    return result;
  }

  async function makeInvoice(
    amount: number,
    options?: {
      description?: string;
      description_hash?: string;
      expiry?: number;
    },
  ) {
    const readyWallet = await ensureWalletReady();
    return await readyWallet.makeInvoice(amount, options);
  }

  async function getInfo() {
    const readyWallet = await ensureWalletReady();
    return await readyWallet.getInfo();
  }

  async function getBalance() {
    const readyWallet = await ensureWalletReady();
    const result = await readyWallet.getBalance();
    return result.balance;
  }

  async function listTransactions(options?: {
    from?: number;
    until?: number;
    limit?: number;
    offset?: number;
    unpaid?: boolean;
    type?: "incoming" | "outgoing";
  }) {
    const readyWallet = await ensureWalletReady();
    return await readyWallet.listTransactions(options);
  }

  async function lookupInvoice(paymentHash: string) {
    const readyWallet = await ensureWalletReady();
    return await readyWallet.lookupInvoice(paymentHash);
  }

  async function payKeysend(pubkey: string, amount: number, preimage?: string) {
    const readyWallet = await ensureWalletReady();
    const result = await readyWallet.payKeysend(pubkey, amount, preimage);
    await refreshBalanceService();
    return result;
  }

  function disconnect() {
    clearWallet();
  }

  async function reconnect() {
    await reconnectService();
  }

  async function refreshBalance() {
    return await refreshBalanceService();
  }

  async function loadTransactions() {
    await loadTransactionsService();
  }

  async function loadMoreTransactions() {
    await loadMoreTransactionsService();
  }

  async function retryLoadTransactions() {
    await retryLoadTransactionsService();
  }

  return {
    // State (all derived from observables)
    wallet,
    balance,
    isConnected,
    connectionStatus,
    lastError,
    support,
    walletMethods,
    transactionsState,

    // Operations
    payInvoice,
    makeInvoice,
    getInfo,
    getBalance,
    refreshBalance,
    listTransactions,
    lookupInvoice,
    payKeysend,
    disconnect,
    reconnect,
    loadTransactions,
    loadMoreTransactions,
    retryLoadTransactions,
  };
}
