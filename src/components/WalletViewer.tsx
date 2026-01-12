import { useState, useEffect, useCallback } from "react";
import {
  Wallet,
  Zap,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
} from "lucide-react";
import { use$ } from "applesauce-react/hooks";
import walletManager from "@/services/wallet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import WalletConnectDialog from "./WalletConnectDialog";
import { npubEncode } from "applesauce-core/helpers";
import { formatDistanceToNow } from "date-fns";
import type { Transaction } from "applesauce-wallet-connect/helpers/methods";

export default function WalletViewer() {
  const walletState = use$(walletManager.state$);
  const [showConnect, setShowConnect] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedPubkey, setCopiedPubkey] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await walletManager.refreshBalance();
      toast.success("Balance refreshed");
    } catch (_error) {
      toast.error("Failed to refresh balance");
    } finally {
      setIsRefreshing(false);
    }
  }

  function copyPubkey() {
    if (!walletState.info?.pubkey) return;
    try {
      const npub = npubEncode(walletState.info.pubkey);
      navigator.clipboard.writeText(npub);
      setCopiedPubkey(true);
      toast.success("Pubkey copied");
      setTimeout(() => setCopiedPubkey(false), 2000);
    } catch (_error) {
      toast.error("Failed to copy pubkey");
    }
  }

  function formatBalance(msats: number): string {
    const sats = Math.floor(msats / 1000);
    return sats.toLocaleString();
  }

  const supportsTransactions =
    walletState.info?.methods.includes("list_transactions");

  const loadTransactions = useCallback(async () => {
    const wallet = walletManager.getWallet();
    if (!wallet || !supportsTransactions) return;

    setIsLoadingTx(true);
    try {
      const result = await wallet.listTransactions({
        limit: 50,
      });
      setTransactions(result.transactions || []);
    } catch (_error) {
      toast.error("Failed to load transactions");
    } finally {
      setIsLoadingTx(false);
    }
  }, [supportsTransactions]);

  useEffect(() => {
    if (showTransactions && transactions.length === 0) {
      loadTransactions();
    }
  }, [showTransactions, transactions.length, loadTransactions]);

  if (!walletState.connected || !walletState.info) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <WalletConnectDialog open={showConnect} onOpenChange={setShowConnect} />
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Wallet className="size-12" />
          <h3 className="text-lg font-semibold">No Wallet Connected</h3>
          <p className="text-sm text-center max-w-md">
            Connect your Lightning wallet using Nostr Wallet Connect (NIP-47) to
            send and receive payments.
          </p>
        </div>
        <Button onClick={() => setShowConnect(true)}>
          <Wallet className="mr-2 size-4" />
          Connect Wallet
        </Button>
      </div>
    );
  }

  const { info } = walletState;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-6 space-y-6">
        {/* Balance Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Balance
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <Zap className="size-6 text-yellow-500" />
              <div className="text-3xl font-bold">
                {formatBalance(info.balance)}
              </div>
              <div className="text-lg text-muted-foreground">sats</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {(info.balance / 1000).toLocaleString()} msats
            </div>
          </CardContent>
        </Card>

        {/* Wallet Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Wallet Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {info.alias && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Alias</span>
                <span className="text-sm font-medium">{info.alias}</span>
              </div>
            )}

            <div className="flex justify-between items-center gap-2">
              <span className="text-sm text-muted-foreground">Pubkey</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono truncate max-w-[200px]">
                  {info.pubkey.slice(0, 16)}...
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyPubkey}
                  className="size-8 p-0"
                >
                  {copiedPubkey ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex justify-between items-start gap-2">
              <span className="text-sm text-muted-foreground">Methods</span>
              <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                {info.methods.map((method) => (
                  <span
                    key={method}
                    className="text-xs px-2 py-1 rounded-md bg-muted font-mono"
                  >
                    {method}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transactions */}
        {supportsTransactions && (
          <Card>
            <CardHeader
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => setShowTransactions(!showTransactions)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  Transactions
                </CardTitle>
                <div className="flex items-center gap-2">
                  {isLoadingTx && (
                    <RefreshCw className="size-4 animate-spin text-muted-foreground" />
                  )}
                  {showTransactions ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                </div>
              </div>
            </CardHeader>
            {showTransactions && (
              <CardContent className="space-y-2">
                {transactions.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    {isLoadingTx ? "Loading..." : "No transactions"}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {transactions.map((tx) => (
                      <TransactionItem key={tx.payment_hash} tx={tx} />
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => walletManager.disconnect()}
          >
            Disconnect Wallet
          </Button>
        </div>
      </div>
    </div>
  );
}

function TransactionItem({ tx }: { tx: Transaction }) {
  const isIncoming = tx.type === "incoming";
  const sats = Math.floor(tx.amount / 1000);
  const feesSats = tx.fees_paid ? Math.floor(tx.fees_paid / 1000) : 0;

  const timestamp = tx.settled_at || tx.created_at || Date.now() / 1000;
  const timeAgo = formatDistanceToNow(new Date(timestamp * 1000), {
    addSuffix: true,
  });

  return (
    <div className="flex items-start gap-3 p-3 rounded-md border bg-card hover:bg-muted/50">
      <div
        className={`mt-1 ${isIncoming ? "text-green-500" : "text-orange-500"}`}
      >
        {isIncoming ? (
          <ArrowDownLeft className="size-4" />
        ) : (
          <ArrowUpRight className="size-4" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {tx.description || (isIncoming ? "Received" : "Sent")}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <Clock className="size-3" />
              {timeAgo}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div
              className={`text-sm font-semibold ${isIncoming ? "text-green-600 dark:text-green-400" : "text-foreground"}`}
            >
              {isIncoming ? "+" : "-"}
              {sats.toLocaleString()}
            </div>
            {feesSats > 0 && (
              <div className="text-xs text-muted-foreground">
                fee: {feesSats}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
