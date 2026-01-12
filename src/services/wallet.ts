import { WalletConnect } from "applesauce-wallet-connect/wallet-connect";
import pool from "./relay-pool";
import { BehaviorSubject } from "rxjs";

export interface WalletInfo {
  alias?: string;
  pubkey: string;
  balance: number; // msats
  methods: string[];
}

export interface WalletState {
  connected: boolean;
  connectURI?: string;
  info?: WalletInfo;
  error?: string;
}

const WALLET_URI_KEY = "nwc-uri";

class WalletManager {
  private wallet: WalletConnect | null = null;
  public state$ = new BehaviorSubject<WalletState>({ connected: false });

  constructor() {
    // Try to restore wallet from localStorage
    this.restoreWallet();
  }

  private async restoreWallet() {
    const uri = localStorage.getItem(WALLET_URI_KEY);
    if (uri) {
      try {
        await this.connect(uri);
      } catch (error) {
        console.error("[Wallet] Failed to restore wallet:", error);
        this.disconnect();
      }
    }
  }

  async connect(connectURI: string) {
    try {
      // Disconnect existing wallet if any
      if (this.wallet) {
        this.wallet = null;
      }

      // Create new wallet connection
      this.wallet = WalletConnect.fromConnectURI(connectURI, { pool });

      // Get wallet info
      const info = await this.wallet.getInfo();

      // Get initial balance
      const balanceResult = await this.wallet.getBalance();

      this.state$.next({
        connected: true,
        connectURI,
        info: {
          alias: info.alias || undefined,
          pubkey: info.pubkey || "",
          balance: balanceResult.balance,
          methods: info.methods,
        },
      });

      // Save to localStorage
      localStorage.setItem(WALLET_URI_KEY, connectURI);

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to connect";
      this.state$.next({
        connected: false,
        error: errorMessage,
      });
      throw error;
    }
  }

  async refreshBalance() {
    if (!this.wallet) return;

    try {
      const balanceResult = await this.wallet.getBalance();
      const currentState = this.state$.value;

      if (currentState.info) {
        this.state$.next({
          ...currentState,
          info: {
            ...currentState.info,
            balance: balanceResult.balance,
          },
        });
      }
    } catch (error) {
      console.error("[Wallet] Failed to refresh balance:", error);
    }
  }

  disconnect() {
    this.wallet = null;
    this.state$.next({ connected: false });
    localStorage.removeItem(WALLET_URI_KEY);
  }

  getWallet(): WalletConnect | null {
    return this.wallet;
  }
}

const walletManager = new WalletManager();

export default walletManager;
