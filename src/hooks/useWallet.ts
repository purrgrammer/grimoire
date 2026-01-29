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
import {
  wallet$,
  restoreWallet,
  clearWallet,
  refreshBalance as refreshBalanceService,
  reconnect as reconnectService,
  balance$,
  connectionStatus$,
  lastError$,
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

  // Wallet support from library's support$ observable (cached)
  const support = use$(() => wallet?.support$, [wallet]);

  // Wallet methods - combines reactive support$ with cached info fallback
  // The support$ waits for kind 13194 events which some wallets don't publish
  const walletMethods = useMemo(() => {
    return support?.methods ?? state.nwcConnection?.info?.methods ?? [];
  }, [support?.methods, state.nwcConnection?.info?.methods]);

  // Restore wallet on mount if connection exists
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

  async function payInvoice(invoice: string, amount?: number) {
    if (!wallet) throw new Error("No wallet connected");
    const result = await wallet.payInvoice(invoice, amount);
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
    if (!wallet) throw new Error("No wallet connected");
    return await wallet.makeInvoice(amount, options);
  }

  async function getInfo() {
    if (!wallet) throw new Error("No wallet connected");
    return await wallet.getInfo();
  }

  async function getBalance() {
    if (!wallet) throw new Error("No wallet connected");
    const result = await wallet.getBalance();
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
    if (!wallet) throw new Error("No wallet connected");
    return await wallet.listTransactions(options);
  }

  async function lookupInvoice(paymentHash: string) {
    if (!wallet) throw new Error("No wallet connected");
    return await wallet.lookupInvoice(paymentHash);
  }

  async function payKeysend(pubkey: string, amount: number, preimage?: string) {
    if (!wallet) throw new Error("No wallet connected");
    const result = await wallet.payKeysend(pubkey, amount, preimage);
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

  return {
    // State (all derived from observables)
    wallet,
    balance,
    isConnected,
    connectionStatus,
    lastError,
    support,
    walletMethods,

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
  };
}
