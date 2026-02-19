import { map } from "rxjs/operators";
import { RelayAuthManager } from "relay-auth-manager";
import type { AuthSigner, AuthPreference } from "relay-auth-manager";
import { canAccountSign } from "@/hooks/useAccount";
import { normalizeRelayURL } from "@/lib/relay-url";
import pool from "./relay-pool";
import accountManager from "./accounts";
import db from "./db";

const STORAGE_KEY = "relay-auth-preferences";

/**
 * One-time migration: move auth preferences from Dexie to localStorage.
 * Runs in the background on first load. After migration, Dexie rows are
 * cleared so it doesn't run again.
 */
function migrateFromDexie() {
  // Skip if localStorage already has preferences (already migrated)
  if (localStorage.getItem(STORAGE_KEY)) return;

  db.relayAuthPreferences
    .toArray()
    .then((rows) => {
      if (rows.length === 0) return;

      const prefs: Record<string, string> = {};
      for (const row of rows) {
        if (
          row.preference === "always" ||
          row.preference === "never" ||
          row.preference === "ask"
        ) {
          prefs[row.url] = row.preference;
        }
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));

      // Inject into the already-running manager
      for (const [url, pref] of Object.entries(prefs)) {
        relayAuthManager.setPreference(url, pref as AuthPreference);
      }

      // Clean up Dexie table
      db.relayAuthPreferences.clear();
    })
    .catch(() => {
      // Ignore migration errors — user just re-answers prompts
    });
}

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

  storage: localStorage,
  storageKey: STORAGE_KEY,

  // Use Grimoire's normalizer (lowercase + trailing slash via applesauce)
  // to ensure preference keys match relay URLs consistently.
  normalizeUrl: normalizeRelayURL,
});

// Run one-time migration from Dexie → localStorage
migrateFromDexie();

export default relayAuthManager;
