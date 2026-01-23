/**
 * useNip61Wallet Hook
 *
 * Provides access to the user's NIP-60 Cashu wallet state.
 * Uses applesauce-wallet casts for reactive wallet data.
 */

import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { use$ } from "applesauce-react/hooks";
import { castUser } from "applesauce-common/casts";
import type { Subscription } from "rxjs";
import { useAccount } from "@/hooks/useAccount";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { hub } from "@/services/hub";
import {
  couch,
  UnlockWallet,
  WALLET_KIND,
  WALLET_TOKEN_KIND,
  WALLET_HISTORY_KIND,
} from "@/services/nip61-wallet";
import { kinds, relaySet } from "applesauce-core/helpers";

// Import casts to enable user.wallet$ property
import "applesauce-wallet/casts";

/**
 * Hook to access the user's NIP-60 Cashu wallet
 *
 * @returns Wallet state and actions
 */
export function useNip61Wallet() {
  const { pubkey, canSign } = useAccount();
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<Subscription | null>(null);

  // Create User cast for the active pubkey
  const user = useMemo(
    () => (pubkey ? castUser(pubkey, eventStore) : undefined),
    [pubkey],
  );

  // Get wallet observable from user cast
  const wallet = use$(() => user?.wallet$, [user]);

  // Get wallet state observables
  const balance = use$(() => wallet?.balance$, [wallet]);
  const tokens = use$(() => wallet?.tokens$, [wallet]);
  const history = use$(() => wallet?.history$, [wallet]);
  const mints = use$(() => wallet?.mints$, [wallet]);
  const relays = use$(() => wallet?.relays$, [wallet]);
  const received = use$(() => wallet?.received$, [wallet]);

  // Get user's outbox relays for subscriptions
  const outboxes = use$(() => user?.outboxes$, [user]);

  // Subscribe to wallet events when pubkey is available
  useEffect(() => {
    if (!pubkey) return;

    // Get all relevant relays
    const walletRelays = relays || [];
    const userOutboxes = outboxes || [];
    const allRelays = relaySet(walletRelays, userOutboxes);

    if (allRelays.length === 0) return;

    // Subscribe to wallet-related events
    const observable = pool.subscription(
      allRelays,
      [
        // Wallet events
        {
          kinds: [WALLET_KIND, WALLET_TOKEN_KIND, WALLET_HISTORY_KIND],
          authors: [pubkey],
        },
        // Token deletions
        {
          kinds: [kinds.EventDeletion],
          "#k": [String(WALLET_TOKEN_KIND)],
          authors: [pubkey],
        },
      ],
      { eventStore },
    );

    const subscription = observable.subscribe();
    subscriptionRef.current = subscription;

    return () => {
      subscription.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [pubkey, relays?.join(","), outboxes?.join(",")]);

  // Unlock wallet action
  const unlock = useCallback(async () => {
    if (!canSign) {
      setError("Cannot unlock: no signer available");
      return false;
    }

    setUnlocking(true);
    setError(null);

    try {
      await hub.run(UnlockWallet, { history: true, tokens: true });
      return true;
    } catch (err) {
      console.error("Failed to unlock wallet:", err);
      setError(err instanceof Error ? err.message : "Failed to unlock wallet");
      return false;
    } finally {
      setUnlocking(false);
    }
  }, [canSign]);

  // Calculate total balance across all mints
  const totalBalance = useMemo(() => {
    if (!balance) return 0;
    return Object.values(balance).reduce((sum, amount) => sum + amount, 0);
  }, [balance]);

  return {
    // Wallet state
    wallet,
    hasWallet: wallet !== undefined,
    isUnlocked: wallet?.unlocked ?? false,

    // Balances
    balance, // { [mint: string]: number }
    totalBalance, // Total across all mints

    // Data
    tokens,
    history,
    mints,
    relays,
    received, // Received nutzap IDs

    // Actions
    unlock,
    unlocking,

    // Error state
    error,

    // Utilities
    canSign,
    couch, // For advanced operations
  };
}
