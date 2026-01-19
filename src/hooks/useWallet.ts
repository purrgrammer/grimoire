/**
 * useWallet Hook
 *
 * Provides access to the NWC wallet throughout the application.
 * Fully reactive using observables - balance updates automatically via use$()
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { wallet, balance, payInvoice, makeInvoice } = useWallet();
 *
 *   async function handlePay() {
 *     if (!wallet) return;
 *     await payInvoice("lnbc...");
 *     // Balance automatically updates via notifications!
 *   }
 *
 *   return <div>Balance: {balance ? Math.floor(balance / 1000) : 0} sats</div>;
 * }
 * ```
 */

import { useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import { useGrimoire } from "@/core/state";
import {
  getWallet,
  restoreWallet,
  clearWallet as clearWalletService,
  refreshBalance as refreshBalanceService,
  balance$,
  info$,
  type WalletInfo,
} from "@/services/nwc";
import type { WalletConnect } from "applesauce-wallet-connect";

export function useWallet() {
  const { state } = useGrimoire();
  const nwcConnection = state.nwcConnection;
  const [wallet, setWallet] = useState<WalletConnect | null>(getWallet());

  // Subscribe to balance updates from observable (fully reactive!)
  const balance = use$(balance$);

  // Subscribe to cached wallet info (from initial connection)
  const info = use$(info$);

  // Initialize wallet on mount if connection exists but no wallet instance
  useEffect(() => {
    if (nwcConnection && !wallet) {
      console.log("[useWallet] Restoring wallet from saved connection");
      const restoredWallet = restoreWallet(nwcConnection);
      setWallet(restoredWallet);

      // Fetch initial balance
      refreshBalanceService();
    }
  }, [nwcConnection, wallet]);

  // Update local wallet ref when connection changes
  useEffect(() => {
    const currentWallet = getWallet();
    if (currentWallet !== wallet) {
      setWallet(currentWallet);
    }
  }, [nwcConnection, wallet]);

  /**
   * Pay a BOLT11 invoice
   * Balance will auto-update via notification subscription
   */
  async function payInvoice(invoice: string, amount?: number) {
    if (!wallet) throw new Error("No wallet connected");

    const result = await wallet.payInvoice(invoice, amount);

    // Balance will update automatically via notifications
    // But we can also refresh immediately for instant feedback
    await refreshBalanceService();

    return result;
  }

  /**
   * Generate a new invoice
   */
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

  /**
   * Get wallet info (capabilities, alias, etc.)
   */
  async function getInfo() {
    if (!wallet) throw new Error("No wallet connected");

    return await wallet.getInfo();
  }

  /**
   * Get current balance
   */
  async function getBalance() {
    if (!wallet) throw new Error("No wallet connected");

    const result = await wallet.getBalance();
    return result.balance;
  }

  /**
   * Manually refresh the balance
   */
  async function refreshBalance() {
    return await refreshBalanceService();
  }

  /**
   * List recent transactions
   * @param options - Pagination and filter options
   */
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

  /**
   * Look up an invoice by payment hash
   * @param paymentHash - The payment hash to look up
   */
  async function lookupInvoice(paymentHash: string) {
    if (!wallet) throw new Error("No wallet connected");

    return await wallet.lookupInvoice(paymentHash);
  }

  /**
   * Pay to a node pubkey directly (keysend)
   * @param pubkey - The node pubkey to pay
   * @param amount - Amount in millisats
   * @param preimage - Optional preimage (hex string)
   */
  async function payKeysend(pubkey: string, amount: number, preimage?: string) {
    if (!wallet) throw new Error("No wallet connected");

    const result = await wallet.payKeysend(pubkey, amount, preimage);

    // Refresh balance after payment
    await refreshBalanceService();

    return result;
  }

  /**
   * Disconnect the wallet
   */
  function disconnect() {
    clearWalletService();
    setWallet(null);
  }

  return {
    /** The wallet instance (null if not connected) */
    wallet,
    /** Current balance in millisats (auto-updates via observable!) */
    balance,
    /** Cached wallet info (alias, methods, notifications) from initial connection */
    info,
    /** Whether a wallet is connected */
    isConnected: !!wallet,
    /** Pay a BOLT11 invoice */
    payInvoice,
    /** Generate a new invoice */
    makeInvoice,
    /** Get wallet information (prefer using cached `info` instead) */
    getInfo,
    /** Get current balance */
    getBalance,
    /** Manually refresh balance */
    refreshBalance,
    /** List recent transactions */
    listTransactions,
    /** Look up an invoice by payment hash */
    lookupInvoice,
    /** Pay to a node pubkey directly (keysend) */
    payKeysend,
    /** Disconnect wallet */
    disconnect,
  };
}

export type { WalletInfo };
