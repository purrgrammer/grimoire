import { useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import accounts from "@/services/accounts";

/**
 * Hook to access the active account with signing capability detection
 *
 * @returns {object} Account state
 * @property {IAccount | undefined} account - The full active account object
 * @property {string | undefined} pubkey - The account's public key (available for all account types)
 * @property {boolean} canSign - Whether the account can sign events (false for read-only accounts)
 * @property {ISigner | undefined} signer - The signer instance (undefined for read-only accounts)
 * @property {boolean} isLoggedIn - Whether any account is active (including read-only)
 *
 * @example
 * // For read-only operations (viewing profiles, loading data)
 * const { pubkey, isLoggedIn } = useAccount();
 * if (pubkey) {
 *   // Load user's relay list, emoji list, etc.
 * }
 *
 * @example
 * // For signing operations (posting, publishing, uploading)
 * const { canSign, signer, pubkey } = useAccount();
 * if (canSign) {
 *   // Can publish events
 *   await adapter.sendMessage({ activePubkey: pubkey, activeSigner: signer, ... });
 * } else {
 *   // Show "log in to post" message
 * }
 */
export function useAccount() {
  const account = use$(accounts.active$);

  return useMemo(() => {
    if (!account) {
      return {
        account: undefined,
        pubkey: undefined,
        canSign: false,
        signer: undefined,
        isLoggedIn: false,
      };
    }

    // Check if the account has a functional signer
    // Read-only accounts have a signer that throws errors on sign operations
    // We detect this by checking for the ReadonlySigner type or checking signer methods
    const signer = account.signer;
    let canSign = false;

    if (signer) {
      // ReadonlyAccount from applesauce-accounts has a ReadonlySigner
      // that throws on signEvent, nip04, nip44 operations
      // We can detect it by checking if it's an instance with the expected methods
      // but we'll use a safer approach: check the account type name
      const accountType = account.constructor.name;
      canSign = accountType !== "ReadonlyAccount";
    }

    return {
      account,
      pubkey: account.pubkey,
      canSign,
      signer: canSign ? signer : undefined,
      isLoggedIn: true,
    };
  }, [account]);
}
