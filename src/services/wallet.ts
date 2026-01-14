import { WalletConnect } from "applesauce-wallet-connect";
import { BehaviorSubject } from "rxjs";
import pool from "./relay-pool";

// Configure WalletConnect to use Grimoire's relay pool
WalletConnect.pool = pool;

export type WalletConnectionInfo = {
  id: string; // Unique identifier
  name: string; // User-friendly name
  pubkey: string; // Service pubkey
  relays: string[]; // Relay URLs
  secret: string; // Secret key (hex)
  createdAt: number; // Timestamp
};

export type WalletBalance = {
  balance: number; // millisatoshis
};

export type WalletInfo = {
  alias?: string;
  color?: string;
  pubkey?: string;
  network?: string;
  block_height?: number;
  block_hash?: string;
  methods: string[];
};

/**
 * WalletManager - Singleton service for managing Nostr Wallet Connect connections
 *
 * Handles NIP-47 wallet connections with persistence to localStorage.
 * Follows the singleton pattern like EventStore and RelayPool.
 */
class WalletManager {
  private connections = new Map<string, WalletConnect>();
  private connectionInfo = new Map<string, WalletConnectionInfo>();
  private activeWalletId$ = new BehaviorSubject<string | undefined>(undefined);
  private storageKey = "grimoire_wallet_connections_v1";

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Load wallet connections from localStorage
   */
  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return;

      const data = JSON.parse(stored);
      const connections: WalletConnectionInfo[] = data.connections || [];
      const activeId: string | undefined = data.activeId;

      // Restore wallet connections
      for (const info of connections) {
        try {
          // Convert hex secret to Uint8Array
          const secretBytes = new Uint8Array(
            info.secret.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
          );

          const wallet = new WalletConnect({
            secret: secretBytes,
            relays: info.relays,
            service: info.pubkey,
          });

          this.connections.set(info.id, wallet);
          this.connectionInfo.set(info.id, info);
        } catch (error) {
          console.error(
            `[WalletManager] Failed to restore connection ${info.id}:`,
            error,
          );
        }
      }

      // Restore active wallet
      if (activeId && this.connections.has(activeId)) {
        this.activeWalletId$.next(activeId);
      }

      console.log(
        `[WalletManager] Restored ${this.connections.size} wallet connection(s)`,
      );
    } catch (error) {
      console.error("[WalletManager] Failed to load from storage:", error);
    }
  }

  /**
   * Save wallet connections to localStorage
   */
  private saveToStorage() {
    try {
      const connections = Array.from(this.connectionInfo.values());
      const activeId = this.activeWalletId$.value;

      const data = {
        connections,
        activeId,
      };

      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error("[WalletManager] Failed to save to storage:", error);
    }
  }

  /**
   * Add a new wallet connection from a connection URI
   * Format: nostr+walletconnect://relay?secret=xxx&pubkey=xxx&relay=xxx
   */
  async addConnectionFromURI(uri: string, name?: string): Promise<string> {
    const wallet = WalletConnect.fromConnectURI(uri);

    // Wait for service to be available (with 5 second timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      await wallet.waitForService(controller.signal);
    } catch (error) {
      clearTimeout(timeoutId);
      // Service might not be online, but we can still save the connection
      console.warn("[WalletManager] Service not available:", error);
    }
    clearTimeout(timeoutId);

    // Generate unique ID
    const id = crypto.randomUUID();

    // Get wallet info to use as default name
    let displayName = name;
    if (!displayName) {
      try {
        const info = await wallet.getInfo();
        displayName = info.alias || `Wallet ${this.connections.size + 1}`;
      } catch {
        displayName = `Wallet ${this.connections.size + 1}`;
      }
    }

    // Convert secret Uint8Array to hex string for storage
    const secretHex = Array.from(wallet.secret)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Store connection info
    const connectionInfo: WalletConnectionInfo = {
      id,
      name: displayName,
      pubkey: wallet.service || "",
      relays: wallet.relays,
      secret: secretHex,
      createdAt: Date.now(),
    };

    this.connections.set(id, wallet);
    this.connectionInfo.set(id, connectionInfo);

    // Set as active if it's the first wallet
    if (this.connections.size === 1) {
      this.activeWalletId$.next(id);
    }

    this.saveToStorage();

    console.log(`[WalletManager] Added connection: ${displayName} (${id})`);
    return id;
  }

  /**
   * Remove a wallet connection
   */
  removeConnection(id: string) {
    const info = this.connectionInfo.get(id);
    if (!info) {
      throw new Error(`Connection ${id} not found`);
    }

    this.connections.delete(id);
    this.connectionInfo.delete(id);

    // Clear active wallet if it was the removed one
    if (this.activeWalletId$.value === id) {
      // Set to first available wallet or undefined
      const firstId = Array.from(this.connections.keys())[0];
      this.activeWalletId$.next(firstId);
    }

    this.saveToStorage();

    console.log(`[WalletManager] Removed connection: ${info.name} (${id})`);
  }

  /**
   * Set the active wallet
   */
  setActiveWallet(id: string) {
    if (!this.connections.has(id)) {
      throw new Error(`Connection ${id} not found`);
    }

    this.activeWalletId$.next(id);
    this.saveToStorage();
  }

  /**
   * Get the active wallet connection
   */
  getActiveWallet(): WalletConnect | undefined {
    const activeId = this.activeWalletId$.value;
    return activeId ? this.connections.get(activeId) : undefined;
  }

  /**
   * Get active wallet ID observable
   */
  get activeWalletId() {
    return this.activeWalletId$.asObservable();
  }

  /**
   * Get all wallet connections info
   */
  getConnections(): WalletConnectionInfo[] {
    return Array.from(this.connectionInfo.values());
  }

  /**
   * Get wallet connection by ID
   */
  getConnection(id: string): WalletConnect | undefined {
    return this.connections.get(id);
  }

  /**
   * Get wallet connection info by ID
   */
  getConnectionInfo(id: string): WalletConnectionInfo | undefined {
    return this.connectionInfo.get(id);
  }

  /**
   * Get wallet balance
   */
  async getBalance(id?: string): Promise<WalletBalance> {
    const wallet = id ? this.connections.get(id) : this.getActiveWallet();
    if (!wallet) {
      throw new Error("No wallet connection available");
    }

    const result = await wallet.getBalance();
    return { balance: result.balance };
  }

  /**
   * Get wallet info
   */
  async getInfo(id?: string): Promise<WalletInfo> {
    const wallet = id ? this.connections.get(id) : this.getActiveWallet();
    if (!wallet) {
      throw new Error("No wallet connection available");
    }

    return await wallet.getInfo();
  }

  /**
   * Pay a Lightning invoice
   */
  async payInvoice(
    invoice: string,
    id?: string,
  ): Promise<{ preimage: string }> {
    const wallet = id ? this.connections.get(id) : this.getActiveWallet();
    if (!wallet) {
      throw new Error("No wallet connection available");
    }

    const result = await wallet.payInvoice(invoice);
    return { preimage: result.preimage };
  }

  /**
   * Create an invoice
   */
  async makeInvoice(
    amount: number,
    description?: string,
    id?: string,
  ): Promise<{ invoice: string; payment_hash: string }> {
    const wallet = id ? this.connections.get(id) : this.getActiveWallet();
    if (!wallet) {
      throw new Error("No wallet connection available");
    }

    const result = await wallet.makeInvoice(amount, { description });
    return {
      invoice: result.invoice || "",
      payment_hash: result.payment_hash || "",
    };
  }

  /**
   * List transactions
   */
  async listTransactions(id?: string): Promise<any[]> {
    const wallet = id ? this.connections.get(id) : this.getActiveWallet();
    if (!wallet) {
      throw new Error("No wallet connection available");
    }

    const result = await wallet.listTransactions();
    return result.transactions || [];
  }

  /**
   * Lookup invoice status
   */
  async lookupInvoice(
    invoice: string,
    id?: string,
  ): Promise<{ paid: boolean; preimage?: string }> {
    const wallet = id ? this.connections.get(id) : this.getActiveWallet();
    if (!wallet) {
      throw new Error("No wallet connection available");
    }

    const result = await wallet.lookupInvoice(undefined, invoice);
    // The result is a Transaction type, need to determine if it's paid
    // A transaction with preimage is considered paid
    return {
      paid: !!result.preimage,
      preimage: result.preimage,
    };
  }
}

// Export singleton instance
const walletManager = new WalletManager();
export default walletManager;
