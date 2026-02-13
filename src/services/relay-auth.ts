import { map } from "rxjs/operators";
import { RelayAuthManager } from "relay-auth-manager";
import type { AuthSigner } from "relay-auth-manager";
import { canAccountSign } from "@/hooks/useAccount";
import pool from "./relay-pool";
import accountManager from "./accounts";

/**
 * Singleton RelayAuthManager instance for Grimoire.
 *
 * Wired to Grimoire's relay pool, account system, and localStorage.
 * Manages NIP-42 auth challenges, preferences, and auto-auth.
 */
const relayAuthManager = new RelayAuthManager({
  pool,

  // Map active account to signer (null when read-only or logged out)
  signer$: accountManager.active$.pipe(
    map((account) => {
      if (!account || !canAccountSign(account)) return null;
      // IAccount satisfies AuthSigner (has signEvent method)
      return account as unknown as AuthSigner;
    }),
  ),

  // Use localStorage for preference persistence
  storage: localStorage,

  // Use "relay-auth-preferences" key (default)
});

export default relayAuthManager;
