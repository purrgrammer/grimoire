import { useEventStore, use$ } from "applesauce-react/hooks";
import { useGrimoire } from "@/core/state";
import {
  Wallet,
  Lock,
  Unlock,
  AlertCircle,
  Coins,
  History,
  ArrowUpRight,
  ArrowDownLeft,
  Zap,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMemo, useState, useCallback } from "react";
import accountManager from "@/services/accounts";
import {
  decryptWalletConfig,
  decryptUnspentTokens,
  decryptTransactionHistory,
  calculateBalance,
  getTotalBalance,
  formatBalance,
  sortTransactions,
  getMintDisplayName,
  type WalletConfig,
  type UnspentTokens,
  type Transaction,
} from "@/lib/wallet-utils";

export interface WalletViewerProps {
  pubkey: string;
}

/**
 * WalletViewer - NIP-60 Cashu Wallet Display
 * Shows wallet configuration, balance, and transaction history
 *
 * NIP-60 Event Kinds:
 * - kind:17375 - Wallet config (replaceable, encrypted)
 * - kind:7375  - Unspent tokens (multiple allowed, encrypted)
 * - kind:7376  - Transaction history (optional, encrypted)
 */
export function WalletViewer({ pubkey }: WalletViewerProps) {
  const { state } = useGrimoire();
  const eventStore = useEventStore();

  // State for decrypted wallet data
  const [walletConfig, setWalletConfig] = useState<WalletConfig | null>(null);
  const [unspentTokens, setUnspentTokens] = useState<UnspentTokens[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [decryptionError, setDecryptionError] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  // Resolve $me alias
  const resolvedPubkey =
    pubkey === "$me" ? state.activeAccount?.pubkey : pubkey;

  // Fetch wallet config event (kind:17375)
  const walletConfigEvent = use$(
    () =>
      resolvedPubkey
        ? eventStore.replaceable(17375, resolvedPubkey)
        : undefined,
    [resolvedPubkey, eventStore],
  );

  // Fetch token events (kind:7375)
  const tokenEvents = use$(
    () =>
      resolvedPubkey
        ? eventStore.timeline([
            {
              kinds: [7375],
              authors: [resolvedPubkey],
            },
          ])
        : undefined,
    [resolvedPubkey, eventStore],
  );

  // Fetch history events (kind:7376)
  const historyEvents = use$(
    () =>
      resolvedPubkey
        ? eventStore.timeline([
            {
              kinds: [7376],
              authors: [resolvedPubkey],
            },
          ])
        : undefined,
    [resolvedPubkey, eventStore],
  );

  const isOwnWallet = resolvedPubkey === state.activeAccount?.pubkey;

  // Check if wallet exists
  const walletExists = walletConfigEvent !== undefined;

  // Get active account from accountManager
  const activeAccount = use$(accountManager.active$);

  // Manual decrypt function
  const decryptWalletData = useCallback(async () => {
    if (!activeAccount?.nip44) {
      setDecryptionError("No NIP-44 encryption support in active account");
      return;
    }

    setIsDecrypting(true);
    setDecryptionError(null);

    console.log("[WalletViewer] Starting decryption...");
    console.log(
      "[WalletViewer] Wallet config event:",
      walletConfigEvent ? "found" : "not found",
    );
    console.log("[WalletViewer] Token events:", tokenEvents?.length || 0);
    console.log("[WalletViewer] History events:", historyEvents?.length || 0);

    try {
      // Decrypt wallet config
      if (walletConfigEvent) {
        console.log("[WalletViewer] Decrypting wallet config...");
        const config = await decryptWalletConfig(
          walletConfigEvent,
          activeAccount,
        );
        if (config) {
          console.log(
            "[WalletViewer] Wallet config decrypted successfully:",
            config,
          );
          setWalletConfig(config);
        } else {
          console.warn("[WalletViewer] Wallet config decryption returned null");
        }
      }

      // Decrypt token events
      if (tokenEvents && tokenEvents.length > 0) {
        console.log(
          `[WalletViewer] Decrypting ${tokenEvents.length} token event(s)...`,
        );
        const decryptedTokens: UnspentTokens[] = [];
        for (const event of tokenEvents) {
          const tokens = await decryptUnspentTokens(event, activeAccount);
          if (tokens) {
            console.log("[WalletViewer] Token event decrypted:", tokens);
            decryptedTokens.push(tokens);
          } else {
            console.warn(
              "[WalletViewer] Token event decryption returned null:",
              event.id,
            );
          }
        }
        setUnspentTokens(decryptedTokens);
        console.log(
          `[WalletViewer] Total ${decryptedTokens.length} token event(s) decrypted`,
        );
      } else {
        console.log("[WalletViewer] No token events to decrypt");
        setUnspentTokens([]);
      }

      // Decrypt history events
      if (historyEvents && historyEvents.length > 0) {
        console.log(
          `[WalletViewer] Decrypting ${historyEvents.length} history event(s)...`,
        );
        const allTransactions: Transaction[] = [];
        for (const event of historyEvents) {
          const history = await decryptTransactionHistory(event, activeAccount);
          if (history && history.transactions) {
            console.log(
              `[WalletViewer] History event decrypted: ${history.transactions.length} transaction(s)`,
            );
            allTransactions.push(...history.transactions);
          } else {
            console.warn(
              "[WalletViewer] History event decryption returned null:",
              event.id,
            );
          }
        }
        setTransactions(sortTransactions(allTransactions));
        console.log(
          `[WalletViewer] Total ${allTransactions.length} transaction(s) decrypted`,
        );
      } else {
        console.log("[WalletViewer] No history events to decrypt");
        setTransactions([]);
      }

      console.log("[WalletViewer] Decryption completed successfully");
    } catch (error) {
      console.error("[WalletViewer] Decryption error:", error);
      setDecryptionError(
        error instanceof Error
          ? error.message
          : "Failed to decrypt wallet data",
      );
    } finally {
      setIsDecrypting(false);
    }
  }, [activeAccount, walletConfigEvent, tokenEvents, historyEvents]);

  // Calculate balance
  const balanceByMint = useMemo(() => {
    if (unspentTokens.length === 0) return new Map();
    return calculateBalance(unspentTokens);
  }, [unspentTokens]);

  const totalBalance = useMemo(() => {
    return getTotalBalance(balanceByMint);
  }, [balanceByMint]);

  if (!resolvedPubkey) {
    return (
      <div className="p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No active account. Please log in to view your wallet.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!walletExists) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Wallet className="h-5 w-5" />
          <h2 className="text-lg font-semibold">NIP-60 Cashu Wallet</h2>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {isOwnWallet
              ? "No NIP-60 wallet found for your account. You can create a wallet using a compatible Cashu wallet application."
              : "No NIP-60 wallet found for this user."}
          </AlertDescription>
        </Alert>

        {isOwnWallet && (
          <Card>
            <CardHeader>
              <CardTitle>What is NIP-60?</CardTitle>
              <CardDescription>
                NIP-60 is a protocol for storing Cashu ecash wallets on Nostr
                relays
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                <strong>Cashu</strong> is a privacy-preserving ecash system
                backed by Bitcoin via Lightning Network.
              </p>
              <p>
                <strong>NIP-60</strong> stores your wallet data encrypted on
                Nostr relays, making it accessible across applications.
              </p>
              <p className="pt-2">
                To create a wallet, use a NIP-60 compatible application like{" "}
                <a
                  href="https://nostrudel.ninja"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  noStrudel
                </a>{" "}
                or{" "}
                <a
                  href="https://cashu.me"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Cashu.me
                </a>
                .
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          <h2 className="text-lg font-semibold">
            {isOwnWallet ? "Your" : "User"} Cashu Wallet
          </h2>
        </div>

        {!isOwnWallet && (
          <div className="text-sm text-muted-foreground">
            Viewing another user's wallet (encrypted)
          </div>
        )}
      </div>

      {/* Wallet Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {isOwnWallet && walletConfig ? (
                <Unlock className="h-4 w-4 text-green-500" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              Wallet Status
            </CardTitle>
            {isOwnWallet &&
              !walletConfig &&
              !isDecrypting &&
              activeAccount?.nip44 && (
                <Button size="sm" onClick={decryptWalletData}>
                  <Unlock className="h-4 w-4 mr-2" />
                  Unlock Wallet
                </Button>
              )}
            {isOwnWallet && walletConfig && (
              <div className="text-xs text-green-500 font-medium flex items-center gap-1">
                <Unlock className="h-3 w-3" />
                Unlocked
              </div>
            )}
          </div>
          <CardDescription>
            NIP-60 wallet stored on Nostr relays
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {decryptionError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>{decryptionError}</span>
                <Button size="sm" variant="outline" onClick={decryptWalletData}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {isOwnWallet && walletConfig && (
            <Alert>
              <Unlock className="h-4 w-4" />
              <AlertDescription>
                <strong>Wallet Unlocked:</strong> Your wallet has been decrypted
                and is ready to use. Balance and transaction history are now
                visible.
              </AlertDescription>
            </Alert>
          )}

          {isOwnWallet &&
            !walletConfig &&
            !isDecrypting &&
            !decryptionError && (
              <Alert>
                <Lock className="h-4 w-4" />
                <AlertDescription>
                  <strong>Wallet Locked:</strong> Your wallet data is encrypted
                  with NIP-44.{" "}
                  {activeAccount?.nip44
                    ? "Click 'Unlock Wallet' to decrypt."
                    : "Sign in to decrypt."}
                </AlertDescription>
              </Alert>
            )}

          {isDecrypting && (
            <Alert>
              <RefreshCw className="h-4 w-4 animate-spin" />
              <AlertDescription>
                <strong>Decrypting...</strong> Please wait while your wallet
                data is being decrypted.
              </AlertDescription>
            </Alert>
          )}

          {!isOwnWallet && (
            <Alert>
              <Lock className="h-4 w-4" />
              <AlertDescription>
                <strong>Privacy Protected:</strong> This wallet's data is
                encrypted and cannot be viewed without the owner's private key.
              </AlertDescription>
            </Alert>
          )}

          {/* Wallet Metadata (shown when unlocked) */}
          {isOwnWallet && walletConfig && (
            <div className="space-y-4 p-4 bg-muted rounded-lg">
              <div className="text-sm font-semibold text-foreground">
                Wallet Configuration
              </div>

              {/* Wallet Name */}
              {walletConfig.name && (
                <div>
                  <div className="text-xs text-muted-foreground">Name</div>
                  <div className="font-mono text-sm">{walletConfig.name}</div>
                </div>
              )}

              {/* Unit */}
              <div>
                <div className="text-xs text-muted-foreground">Unit</div>
                <div className="font-mono text-sm">
                  {walletConfig.unit || "sat"}
                </div>
              </div>

              {/* Mints */}
              {walletConfig.mints && walletConfig.mints.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    Configured Mints ({walletConfig.mints.length})
                  </div>
                  <div className="space-y-1">
                    {walletConfig.mints.map((mint) => (
                      <div
                        key={mint}
                        className="font-mono text-xs p-2 bg-background rounded"
                      >
                        {mint}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Relays */}
              {walletConfig.relays && walletConfig.relays.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">
                    Relays ({walletConfig.relays.length})
                  </div>
                  <div className="space-y-1">
                    {walletConfig.relays.map((relay) => (
                      <div
                        key={relay}
                        className="font-mono text-xs p-2 bg-background rounded"
                      >
                        {relay}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Private Key (show first 8 and last 8 chars) */}
              {walletConfig.privkey && (
                <div>
                  <div className="text-xs text-muted-foreground">
                    Wallet Private Key (for signing Cashu operations)
                  </div>
                  <div className="font-mono text-xs p-2 bg-background rounded break-all">
                    {walletConfig.privkey.substring(0, 8)}...
                    {walletConfig.privkey.substring(
                      walletConfig.privkey.length - 8,
                    )}
                  </div>
                  <div className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
                    ⚠️ Keep this key private - it controls your Cashu wallet
                  </div>
                </div>
              )}

              {/* Description */}
              {walletConfig.description && (
                <div>
                  <div className="text-xs text-muted-foreground">
                    Description
                  </div>
                  <div className="text-sm">{walletConfig.description}</div>
                </div>
              )}
            </div>
          )}

          {/* Event Status Grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Config Event</div>
              <div className="font-mono text-xs">
                {walletConfigEvent ? "✓ Found (kind:17375)" : "✗ Not found"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Token Events</div>
              <div className="font-mono text-xs">
                {tokenEvents && tokenEvents.length > 0
                  ? `✓ ${tokenEvents.length} event(s) (kind:7375)`
                  : "✗ No tokens"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">History Events</div>
              <div className="font-mono text-xs">
                {historyEvents && historyEvents.length > 0
                  ? `✓ ${historyEvents.length} event(s) (kind:7376)`
                  : "○ No history"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Created</div>
              <div className="font-mono text-xs">
                {walletConfigEvent
                  ? new Date(
                      walletConfigEvent.created_at * 1000,
                    ).toLocaleDateString()
                  : "Unknown"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Balance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-4 w-4" />
            Balance
          </CardTitle>
          <CardDescription>
            Total unspent tokens across all mints
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isOwnWallet ? (
            <div className="flex items-center justify-center p-8 border-2 border-dashed rounded-lg">
              <div className="text-center space-y-2">
                <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Balance encrypted
                </p>
                <p className="text-xs text-muted-foreground">
                  Only the owner can view this wallet
                </p>
              </div>
            </div>
          ) : isDecrypting ? (
            <div className="flex items-center justify-center p-8">
              <div className="text-center space-y-2">
                <Unlock className="h-8 w-8 mx-auto text-muted-foreground animate-pulse" />
                <p className="text-sm text-muted-foreground">
                  Decrypting wallet...
                </p>
              </div>
            </div>
          ) : decryptionError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{decryptionError}</AlertDescription>
            </Alert>
          ) : unspentTokens.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Coins className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No funds available</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Total Balance */}
              <div className="text-center p-6 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground mb-2">
                  Total Balance
                </div>
                <div className="text-3xl font-bold">
                  {formatBalance(totalBalance)}
                </div>
              </div>

              {/* Balance by Mint */}
              {balanceByMint.size > 1 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">
                    By Mint
                  </div>
                  {Array.from(balanceByMint.entries()).map(
                    ([mint, balance]) => (
                      <div
                        key={mint}
                        className="flex justify-between items-center p-3 bg-muted rounded"
                      >
                        <div className="text-sm font-mono text-muted-foreground">
                          {getMintDisplayName(mint)}
                        </div>
                        <div className="text-sm font-semibold">
                          {formatBalance(balance)}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Transaction History
          </CardTitle>
          <CardDescription>Recent wallet activity</CardDescription>
        </CardHeader>
        <CardContent>
          {!isOwnWallet && historyEvents && historyEvents.length > 0 ? (
            <div className="flex items-center justify-center p-8 border-2 border-dashed rounded-lg">
              <div className="text-center space-y-2">
                <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Transaction history encrypted
                </p>
                <p className="text-xs text-muted-foreground">
                  Only the owner can view this wallet
                </p>
              </div>
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No transaction history</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.slice(0, 10).map((tx, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-muted rounded hover:bg-muted/80 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {tx.type === "mint" && (
                      <Zap className="h-4 w-4 text-green-500" />
                    )}
                    {tx.type === "melt" && (
                      <Zap className="h-4 w-4 text-orange-500" />
                    )}
                    {tx.type === "send" && (
                      <ArrowUpRight className="h-4 w-4 text-red-500" />
                    )}
                    {tx.type === "receive" && (
                      <ArrowDownLeft className="h-4 w-4 text-green-500" />
                    )}
                    <div>
                      <div className="text-sm font-medium capitalize">
                        {tx.type}
                      </div>
                      {tx.memo && (
                        <div className="text-xs text-muted-foreground">
                          {tx.memo}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-sm font-semibold ${tx.type === "send" || tx.type === "melt" ? "text-red-500" : "text-green-500"}`}
                    >
                      {tx.type === "send" || tx.type === "melt" ? "-" : "+"}
                      {formatBalance(tx.amount)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(tx.timestamp * 1000).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
              {transactions.length > 10 && (
                <div className="text-center text-sm text-muted-foreground pt-2">
                  Showing 10 of {transactions.length} transactions
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Developer Info */}
      {isOwnWallet && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Raw Events (For Developers)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Wallet Config Event (kind:17375)
              </summary>
              <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-x-auto">
                {walletConfigEvent
                  ? JSON.stringify(walletConfigEvent, null, 2)
                  : "Not found"}
              </pre>
            </details>

            {tokenEvents && tokenEvents.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Token Events (kind:7375) - {tokenEvents.length} event(s)
                </summary>
                <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-x-auto">
                  {JSON.stringify(tokenEvents, null, 2)}
                </pre>
              </details>
            )}

            {historyEvents && historyEvents.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  History Events (kind:7376) - {historyEvents.length} event(s)
                </summary>
                <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-x-auto">
                  {JSON.stringify(historyEvents, null, 2)}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* Help Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">About NIP-60 Cashu Wallets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <strong className="text-foreground">What you're seeing:</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>
                kind:17375 - Encrypted wallet configuration (mint URLs, wallet
                private key)
              </li>
              <li>kind:7375 - Encrypted unspent Cashu proofs (ecash tokens)</li>
              <li>kind:7376 - Encrypted transaction history (optional)</li>
            </ul>
          </div>

          <div>
            <strong className="text-foreground">Privacy & Security:</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>All wallet data is encrypted with NIP-44</li>
              <li>Only the owner can decrypt and spend the funds</li>
              <li>Wallet follows you across Nostr applications</li>
            </ul>
          </div>

          <div>
            <strong className="text-foreground">Compatible Apps:</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>
                <a
                  href="https://nostrudel.ninja"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  noStrudel
                </a>{" "}
                - Full-featured Nostr client with NIP-60 wallet
              </li>
              <li>
                <a
                  href="https://cashu.me"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Cashu.me
                </a>{" "}
                - Cashu ecash wallet
              </li>
            </ul>
          </div>

          <div className="pt-2 border-t">
            <p className="text-xs">
              📚 Learn more:{" "}
              <a
                href="https://github.com/nostr-protocol/nips/blob/master/60.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                NIP-60 Specification
              </a>
              {" | "}
              <a
                href="https://cashu.space"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Cashu Protocol
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
