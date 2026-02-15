/**
 * NIP-61 Wallet Service
 *
 * Manages NIP-60 Cashu wallet operations using applesauce-wallet.
 * Provides wallet unlocking, history, and token management.
 */

import { IndexedDBCouch } from "applesauce-wallet/helpers";

// Re-export wallet constants for use throughout the app
export {
  WALLET_KIND,
  WALLET_TOKEN_KIND,
  WALLET_HISTORY_KIND,
  NUTZAP_KIND,
} from "applesauce-wallet/helpers";

// Re-export wallet actions
export {
  UnlockWallet,
  ReceiveToken,
  ReceiveNutzaps,
  ConsolidateTokens,
  RecoverFromCouch,
  SetWalletMints,
  SetWalletRelays,
} from "applesauce-wallet/actions";

// Re-export casts - IMPORTANT: this enables user.wallet$ property
export type {
  Wallet,
  WalletToken,
  WalletHistory,
  Nutzap,
} from "applesauce-wallet/casts";

// Import casts to enable User extension with wallet$ property
import "applesauce-wallet/casts";

/**
 * Singleton IndexedDB couch for safe token operations
 *
 * The "couch" is temporary storage for proofs during operations that could fail.
 * This prevents losing proofs if the app crashes mid-operation.
 */
export const couch = new IndexedDBCouch();

/**
 * NIP-60 Nutzap Info event kind (kind:10019)
 * Used to advertise mints, relays, and P2PK pubkey for receiving nutzaps
 */
export const NUTZAP_INFO_KIND = 10019;
