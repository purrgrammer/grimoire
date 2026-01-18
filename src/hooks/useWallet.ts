/**
 * useWallet Hook
 *
 * Provides access to the NWC wallet throughout the application.
 * Handles wallet lifecycle, balance updates, and transaction methods.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { wallet, balance, payInvoice, makeInvoice, refreshBalance } = useWallet();
 *
 *   async function handlePay() {
 *     if (!wallet) return;
 *     await payInvoice("lnbc...");
 *   }
 *
 *   return <div>Balance: {balance} sats</div>;
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
  setBalanceUpdateCallback,
  refreshBalance as refreshBalanceService,
  balance$,
} from "@/services/nwc";
import type { WalletConnect } from "applesauce-wallet-connect";

export function useWallet() {
  const { state, updateNWCBalance } = useGrimoire();
  const nwcConnection = state.nwcConnection;
  const [wallet, setWallet] = useState<WalletConnect | null>(getWallet());

  // Subscribe to balance updates from the service
  const balance = use$(balance$);

  // Initialize wallet on mount if connection exists but no wallet instance
  useEffect(() => {
    if (nwcConnection && !wallet) {
      console.log("[useWallet] Restoring wallet from saved connection");
      const restoredWallet = restoreWallet(nwcConnection);
      setWallet(restoredWallet);

      // Refresh balance on restore
      refreshBalanceService();
    }
  }, [nwcConnection, wallet]);

  // Set up balance update callback to sync with state
  useEffect(() => {
    setBalanceUpdateCallback((newBalance) => {
      updateNWCBalance(newBalance);
    });

    return () => {
      setBalanceUpdateCallback(() => {});
    };
  }, [updateNWCBalance]);

  // Update local wallet ref when connection changes
  useEffect(() => {
    const currentWallet = getWallet();
    if (currentWallet !== wallet) {
      setWallet(currentWallet);
    }
  }, [nwcConnection]);

  /**
   * Pay a BOLT11 invoice
   */
  async function payInvoice(invoice: string, amount?: number) {
    if (!wallet) throw new Error("No wallet connected");

    const result = await wallet.payInvoice(invoice, amount);

    // Refresh balance after payment
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
   * Disconnect the wallet
   */
  function disconnect() {
    clearWalletService();
    setWallet(null);
  }

  return {
    /** The wallet instance (null if not connected) */
    wallet,
    /** Current balance in millisats (undefined if not available) */
    balance,
    /** Whether a wallet is connected */
    isConnected: !!wallet,
    /** Pay a BOLT11 invoice */
    payInvoice,
    /** Generate a new invoice */
    makeInvoice,
    /** Get wallet information */
    getInfo,
    /** Get current balance */
    getBalance,
    /** Manually refresh balance */
    refreshBalance,
    /** Disconnect wallet */
    disconnect,
  };
}
