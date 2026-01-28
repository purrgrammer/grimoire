/**
 * useNip61Wallet Hook
 *
 * Provides access to the user's NIP-60 Cashu wallet with proper state machine:
 * - discovering: Querying the network to find if wallet exists
 * - missing: No wallet found after search completed
 * - locked: Wallet exists but encrypted
 * - unlocked: Wallet decrypted and ready to use
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
import { useGrimoire } from "@/core/state";

// Import casts to enable user.wallet$ property
import "applesauce-wallet/casts";

/** Wallet state machine states */
export type WalletState =
  | "discovering"
  | "missing"
  | "locked"
  | "unlocked"
  | "error";

/**
 * Hook to access the user's NIP-60 Cashu wallet
 *
 * @returns Wallet state and actions
 */
export function useNip61Wallet() {
  const { pubkey, canSign } = useAccount();
  const { state: appState, setCashuWalletSyncEnabled } = useGrimoire();
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveryComplete, setDiscoveryComplete] = useState(false);
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

  // Determine current wallet state
  const walletState: WalletState = useMemo(() => {
    if (!pubkey) return "missing";
    if (error) return "error";
    if (!discoveryComplete) return "discovering";
    if (!wallet) return "missing";
    if (wallet.unlocked) return "unlocked";
    return "locked";
  }, [pubkey, error, discoveryComplete, wallet]);

  // Subscribe to wallet events when pubkey is available
  useEffect(() => {
    if (!pubkey) {
      setDiscoveryComplete(true);
      return;
    }

    // Reset discovery state when pubkey changes
    setDiscoveryComplete(false);
    setError(null);

    // Get all relevant relays
    const walletRelays = relays || [];
    const userOutboxes = outboxes || [];
    const allRelays = relaySet(walletRelays, userOutboxes);

    // If no relays, use some defaults for discovery
    const queryRelays =
      allRelays.length > 0
        ? allRelays
        : [
            "wss://relay.damus.io",
            "wss://relay.primal.net",
            "wss://nos.lol",
            "wss://relay.nostr.band",
          ];

    // Subscribe to wallet-related events
    const observable = pool.subscription(
      queryRelays,
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

    const subscription = observable.subscribe({
      next: (response) => {
        // When we receive EOSE, discovery is complete
        if (typeof response === "string" && response === "EOSE") {
          setDiscoveryComplete(true);
        }
      },
      error: (err) => {
        console.error("Wallet subscription error:", err);
        setError(err instanceof Error ? err.message : "Subscription failed");
        setDiscoveryComplete(true);
      },
    });

    subscriptionRef.current = subscription;

    // Set a timeout for discovery in case no EOSE is received
    const timeout = setTimeout(() => {
      setDiscoveryComplete(true);
    }, 10000); // 10 second timeout

    return () => {
      clearTimeout(timeout);
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

  // Sort balances by amount (descending)
  const sortedBalance = useMemo(() => {
    if (!balance) return undefined;
    const entries = Object.entries(balance);
    entries.sort((a, b) => b[1] - a[1]);
    return Object.fromEntries(entries);
  }, [balance]);

  // Toggle sync setting
  const toggleSyncEnabled = useCallback(() => {
    setCashuWalletSyncEnabled(!appState.cashuWalletSyncEnabled);
  }, [appState.cashuWalletSyncEnabled, setCashuWalletSyncEnabled]);

  return {
    // State machine
    walletState,
    isDiscovering: walletState === "discovering",
    isMissing: walletState === "missing",
    isLocked: walletState === "locked",
    isUnlocked: walletState === "unlocked",

    // Wallet instance
    wallet,

    // Balances
    balance: sortedBalance, // { [mint: string]: number } sorted by amount
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

    // Sync setting
    syncEnabled: appState.cashuWalletSyncEnabled ?? false,
    toggleSyncEnabled,

    // Error state
    error,

    // Utilities
    canSign,
    couch, // For advanced operations
  };
}
