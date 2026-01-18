/**
 * WalletViewer Component
 *
 * Displays NWC wallet information and provides UI for wallet operations.
 * Single-view layout with balance, send/receive, and transaction history.
 */

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Wallet,
  RefreshCw,
  Send,
  Download,
  Info,
  Copy,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  LogOut,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useWallet } from "@/hooks/useWallet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import QRCode from "qrcode";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ConnectWalletDialog from "./ConnectWalletDialog";

interface Transaction {
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
  metadata?: Record<string, any>;
}

interface WalletInfo {
  alias?: string;
  color?: string;
  pubkey?: string;
  network?: string;
  block_height?: number;
  block_hash?: string;
  methods: string[];
  notifications?: string[];
}

const BATCH_SIZE = 20;

export default function WalletViewer() {
  const {
    wallet,
    balance,
    isConnected,
    getInfo,
    refreshBalance,
    listTransactions,
    makeInvoice,
    payInvoice,
    disconnect,
  } = useWallet();

  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);

  // Send dialog state
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendInvoice, setSendInvoice] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sending, setSending] = useState(false);

  // Receive dialog state
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [receiveAmount, setReceiveAmount] = useState("");
  const [receiveDescription, setReceiveDescription] = useState("");
  const [generatedInvoice, setGeneratedInvoice] = useState("");
  const [invoiceQR, setInvoiceQR] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load wallet info on mount
  useEffect(() => {
    if (isConnected) {
      loadWalletInfo();
    }
  }, [isConnected]);

  // Load transactions when wallet info is available
  useEffect(() => {
    if (walletInfo?.methods.includes("list_transactions")) {
      loadInitialTransactions();
    }
  }, [walletInfo]);

  async function loadWalletInfo() {
    try {
      const info = await getInfo();
      setWalletInfo(info);
    } catch (error) {
      console.error("Failed to load wallet info:", error);
      toast.error("Failed to load wallet info");
    }
  }

  async function loadInitialTransactions() {
    setLoading(true);
    try {
      const result = await listTransactions({
        limit: BATCH_SIZE,
        offset: 0,
      });
      const txs = result.transactions || [];
      setTransactions(txs);
      setHasMore(txs.length === BATCH_SIZE);
    } catch (error) {
      console.error("Failed to load transactions:", error);
      toast.error("Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }

  const loadMoreTransactions = useCallback(async () => {
    if (
      !walletInfo?.methods.includes("list_transactions") ||
      !hasMore ||
      loadingMore
    ) {
      return;
    }

    setLoadingMore(true);
    try {
      const result = await listTransactions({
        limit: BATCH_SIZE,
        offset: transactions.length,
      });
      const newTxs = result.transactions || [];
      setTransactions((prev) => [...prev, ...newTxs]);
      setHasMore(newTxs.length === BATCH_SIZE);
    } catch (error) {
      console.error("Failed to load more transactions:", error);
      toast.error("Failed to load more transactions");
    } finally {
      setLoadingMore(false);
    }
  }, [walletInfo, hasMore, loadingMore, transactions.length, listTransactions]);

  async function handleRefreshBalance() {
    setLoading(true);
    try {
      await refreshBalance();
      toast.success("Balance refreshed");
    } catch (error) {
      console.error("Failed to refresh balance:", error);
      toast.error("Failed to refresh balance");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendPayment() {
    if (!sendInvoice.trim()) {
      toast.error("Please enter an invoice");
      return;
    }

    setSending(true);
    try {
      const amount = sendAmount ? parseInt(sendAmount) : undefined;
      await payInvoice(sendInvoice, amount);
      toast.success("Payment sent successfully");
      setSendInvoice("");
      setSendAmount("");
      setSendDialogOpen(false);
      // Reload transactions
      loadInitialTransactions();
    } catch (error) {
      console.error("Payment failed:", error);
      toast.error(error instanceof Error ? error.message : "Payment failed");
    } finally {
      setSending(false);
    }
  }

  async function handleGenerateInvoice() {
    const amount = parseInt(receiveAmount);
    if (!amount || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setGenerating(true);
    try {
      const result = await makeInvoice(amount, {
        description: receiveDescription || undefined,
      });

      if (!result.invoice) {
        throw new Error("No invoice returned from wallet");
      }

      setGeneratedInvoice(result.invoice);

      // Generate QR code
      const qrDataUrl = await QRCode.toDataURL(result.invoice.toUpperCase(), {
        width: 256,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      setInvoiceQR(qrDataUrl);

      toast.success("Invoice generated");
    } catch (error) {
      console.error("Failed to generate invoice:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to generate invoice",
      );
    } finally {
      setGenerating(false);
    }
  }

  function handleCopyInvoice() {
    navigator.clipboard.writeText(generatedInvoice);
    setCopied(true);
    toast.success("Invoice copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDisconnect() {
    disconnect();
    toast.success("Wallet disconnected");
  }

  function formatSats(millisats: number | undefined): string {
    if (millisats === undefined) return "—";
    return Math.floor(millisats / 1000).toLocaleString();
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
  }

  if (!isConnected || !wallet) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-5" />
              No Wallet Connected
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect a Nostr Wallet Connect (NWC) enabled Lightning wallet to
              send and receive payments.
            </p>
            <Button
              onClick={() => setConnectDialogOpen(true)}
              className="w-full"
            >
              <Wallet className="mr-2 size-4" />
              Connect Wallet
            </Button>
          </CardContent>
        </Card>
        <ConnectWalletDialog
          open={connectDialogOpen}
          onOpenChange={setConnectDialogOpen}
        />
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between">
        {/* Left: Wallet Name & Balance */}
        <div className="flex items-center gap-2">
          <span className="font-semibold">
            {walletInfo?.alias || "Lightning Wallet"}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {formatSats(balance)} sats
          </span>
          {walletInfo && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="size-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-2">
                    <div className="font-semibold">Capabilities:</div>
                    <div className="space-y-1">
                      {walletInfo.methods.map((method) => (
                        <div
                          key={method}
                          className="flex items-center gap-2 text-xs"
                        >
                          <Check className="size-3 text-green-500" />
                          <span className="font-mono">{method}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setReceiveDialogOpen(true)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Receive payment"
              >
                <Download className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Receive</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSendDialogOpen(true)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Send payment"
              >
                <Send className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Send</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleRefreshBalance}
                disabled={loading}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                aria-label="Refresh balance"
              >
                <RefreshCw
                  className={`size-3 ${loading ? "animate-spin" : ""}`}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh Balance</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Transaction History */}
      <div className="flex-1 overflow-hidden">
        {walletInfo?.methods.includes("list_transactions") ? (
          loading ? (
            <div className="flex h-full items-center justify-center">
              <RefreshCw className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">
                No transactions found
              </p>
            </div>
          ) : (
            <Virtuoso
              data={transactions}
              endReached={loadMoreTransactions}
              itemContent={(index, tx) => (
                <div
                  key={tx.payment_hash || index}
                  className="flex items-center justify-between border-b border-border px-4 py-3 hover:bg-muted/50 transition-colors flex-shrink-0"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {tx.type === "incoming" ? (
                      <ArrowDownLeft className="size-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <ArrowUpRight className="size-4 text-red-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className="text-sm font-medium">
                          {tx.type === "incoming" ? "Received" : "Sent"}
                        </p>
                        {tx.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {tx.description}
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">
                        {formatDate(tx.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="text-sm font-semibold font-mono">
                      {tx.type === "incoming" ? "+" : "-"}
                      {formatSats(tx.amount)}
                    </p>
                    {tx.fees_paid !== undefined && tx.fees_paid > 0 && (
                      <p className="text-xs text-muted-foreground font-mono">
                        Fee: {formatSats(tx.fees_paid)}
                      </p>
                    )}
                  </div>
                </div>
              )}
              components={{
                Footer: () =>
                  loadingMore ? (
                    <div className="flex justify-center py-4 border-b border-border">
                      <RefreshCw className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : !hasMore && transactions.length > 0 ? (
                    <div className="py-4 text-center text-xs text-muted-foreground border-b border-border">
                      No more transactions
                    </div>
                  ) : null,
              }}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Transaction history not available
            </p>
          </div>
        )}
      </div>

      {/* Footer with Disconnect */}
      <div className="border-t border-border p-4">
        <Button
          variant="destructive"
          onClick={handleDisconnect}
          className="w-full"
        >
          <LogOut className="mr-2 size-4" />
          Disconnect Wallet
        </Button>
      </div>

      {/* Send Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Payment</DialogTitle>
            <DialogDescription>
              Pay a Lightning invoice. Amount can be overridden if the invoice
              allows it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Invoice</label>
              <Input
                placeholder="lnbc..."
                value={sendInvoice}
                onChange={(e) => setSendInvoice(e.target.value)}
                disabled={sending}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Amount (optional, millisats)
              </label>
              <Input
                type="number"
                placeholder="Leave empty for invoice amount"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                disabled={sending}
              />
            </div>

            <Button
              onClick={handleSendPayment}
              disabled={sending || !sendInvoice.trim()}
              className="w-full"
            >
              {sending ? (
                <>
                  <RefreshCw className="mr-2 size-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 size-4" />
                  Send Payment
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receive Dialog */}
      <Dialog open={receiveDialogOpen} onOpenChange={setReceiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Receive Payment</DialogTitle>
            <DialogDescription>
              Generate a Lightning invoice to receive sats.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!generatedInvoice ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Amount (sats)</label>
                  <Input
                    type="number"
                    placeholder="1000"
                    value={receiveAmount}
                    onChange={(e) => setReceiveAmount(e.target.value)}
                    disabled={generating}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Description (optional)
                  </label>
                  <Input
                    placeholder="What's this for?"
                    value={receiveDescription}
                    onChange={(e) => setReceiveDescription(e.target.value)}
                    disabled={generating}
                  />
                </div>

                <Button
                  onClick={handleGenerateInvoice}
                  disabled={generating || !receiveAmount}
                  className="w-full"
                >
                  {generating ? (
                    <>
                      <RefreshCw className="mr-2 size-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 size-4" />
                      Generate Invoice
                    </>
                  )}
                </Button>
              </>
            ) : (
              <>
                <div className="flex justify-center">
                  {invoiceQR && (
                    <img
                      src={invoiceQR}
                      alt="Invoice QR Code"
                      className="size-64 rounded-lg border border-border"
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Invoice</label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopyInvoice}
                    >
                      {copied ? (
                        <>
                          <Check className="mr-2 size-4" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="mr-2 size-4" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="break-all rounded bg-muted p-3 font-mono text-xs max-h-32 overflow-y-auto">
                    {generatedInvoice}
                  </div>
                </div>

                <Button
                  onClick={() => {
                    setGeneratedInvoice("");
                    setInvoiceQR("");
                    setReceiveAmount("");
                    setReceiveDescription("");
                    setCopied(false);
                  }}
                  variant="outline"
                  className="w-full"
                >
                  Generate Another
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
