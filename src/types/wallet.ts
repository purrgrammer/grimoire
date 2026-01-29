/**
 * Wallet-related type definitions for NWC (NIP-47)
 */

/**
 * A Lightning/Bitcoin transaction from NWC list_transactions
 */
export interface Transaction {
  type: "incoming" | "outgoing";
  invoice?: string;
  description?: string;
  description_hash?: string;
  preimage?: string;
  payment_hash?: string;
  amount: number;
  fees_paid?: number;
  created_at: number;
  expires_at?: number;
  settled_at?: number;
  metadata?: Record<string, unknown>;
}

/**
 * State for the transactions observable
 */
export interface TransactionsState {
  /** The list of transactions */
  items: Transaction[];
  /** Whether we're loading the initial batch */
  loading: boolean;
  /** Whether we're loading more (pagination) */
  loadingMore: boolean;
  /** Whether there are more transactions to load */
  hasMore: boolean;
  /** Error from last load attempt */
  error: Error | null;
  /** Whether initial load has been triggered */
  initialized: boolean;
}

/**
 * Initial state for transactions
 */
export const INITIAL_TRANSACTIONS_STATE: TransactionsState = {
  items: [],
  loading: false,
  loadingMore: false,
  hasMore: true,
  error: null,
  initialized: false,
};
