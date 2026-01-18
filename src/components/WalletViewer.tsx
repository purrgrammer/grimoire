/**
 * WalletViewer Component
 *
 * Displays NWC wallet information and provides UI for wallet operations.
 * Dynamically shows features based on wallet capabilities (methods).
 *
 * Features:
 * - Balance display with real-time updates
 * - Transaction history (if list_transactions supported)
 * - Send/Receive Lightning payments
 * - Budget information (if get_budget supported)
 * - Wallet info and capabilities
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Wallet,
  RefreshCw,
  Send,
  Download,
  Info,
  AlertCircle,
  Copy,
  Check,
  Zap,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import QRCode from "qrcode";

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
  } = useWallet();

  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Send tab state
  const [sendInvoice, setSendInvoice] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sending, setSending] = useState(false);

  // Receive tab state
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

  // Load transactions when switching to that tab
  useEffect(() => {
    if (
      activeTab === "transactions" &&
      walletInfo?.methods.includes("list_transactions")
    ) {
      loadTransactions();
    }
  }, [activeTab, walletInfo]);

  async function loadWalletInfo() {
    try {
      const info = await getInfo();
      setWalletInfo(info);
    } catch (error) {
      console.error("Failed to load wallet info:", error);
      toast.error("Failed to load wallet info");
    }
  }

  async function loadTransactions() {
    if (!walletInfo?.methods.includes("list_transactions")) return;

    setLoading(true);
    try {
      const result = await listTransactions({ limit: 50 });
      setTransactions(result.transactions || []);
    } catch (error) {
      console.error("Failed to load transactions:", error);
      toast.error("Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }

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
        width: 300,
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
              <AlertCircle className="size-5" />
              No Wallet Connected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Connect a Nostr Wallet Connect (NWC) enabled Lightning wallet to
              use this feature.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wallet className="size-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">
                {walletInfo?.alias || "Lightning Wallet"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Balance: {formatSats(balance)} sats
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshBalance}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <div className="border-b border-border bg-card px-4">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="overview">
              <Info className="mr-2 size-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="send">
              <Send className="mr-2 size-4" />
              Send
            </TabsTrigger>
            <TabsTrigger value="receive">
              <Download className="mr-2 size-4" />
              Receive
            </TabsTrigger>
            {walletInfo?.methods.includes("list_transactions") && (
              <TabsTrigger value="transactions">
                <Zap className="mr-2 size-4" />
                Transactions
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4">
            <TabsContent value="overview" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Wallet Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {walletInfo?.alias && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Alias
                      </span>
                      <span className="text-sm font-medium">
                        {walletInfo.alias}
                      </span>
                    </div>
                  )}
                  {walletInfo?.network && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">
                        Network
                      </span>
                      <span className="text-sm font-medium capitalize">
                        {walletInfo.network}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">
                      Balance
                    </span>
                    <span className="text-sm font-medium">
                      {formatSats(balance)} sats
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Capabilities</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {walletInfo?.methods.map((method) => (
                      <div
                        key={method}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Check className="size-4 text-green-500" />
                        <span className="font-mono">{method}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {walletInfo?.notifications &&
                walletInfo.notifications.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Notifications</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {walletInfo.notifications.map((notification) => (
                          <div
                            key={notification}
                            className="flex items-center gap-2 text-sm"
                          >
                            <Check className="size-4 text-green-500" />
                            <span className="font-mono">{notification}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
            </TabsContent>

            <TabsContent value="send" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Send Payment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Invoice</label>
                    <Input
                      placeholder="lnbc..."
                      value={sendInvoice}
                      onChange={(e) => setSendInvoice(e.target.value)}
                      disabled={sending}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Amount (optional, in millisats)
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
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="receive" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Receive Payment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
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

                  {generatedInvoice && (
                    <div className="space-y-4 rounded-lg border border-border bg-muted/50 p-4">
                      <div className="flex justify-center">
                        {invoiceQR && (
                          <img
                            src={invoiceQR}
                            alt="Invoice QR Code"
                            className="size-64"
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
                        <div className="break-all rounded bg-background p-3 font-mono text-xs">
                          {generatedInvoice}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {walletInfo?.methods.includes("list_transactions") && (
              <TabsContent value="transactions" className="mt-0 space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Transaction History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {loading ? (
                      <div className="flex justify-center py-8">
                        <RefreshCw className="size-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : transactions.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No transactions found
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {transactions.map((tx, index) => (
                          <div
                            key={tx.payment_hash || index}
                            className="flex items-start justify-between rounded-lg border border-border p-3"
                          >
                            <div className="flex items-start gap-3">
                              {tx.type === "incoming" ? (
                                <ArrowDownLeft className="mt-0.5 size-5 text-green-500" />
                              ) : (
                                <ArrowUpRight className="mt-0.5 size-5 text-red-500" />
                              )}
                              <div className="space-y-1">
                                <p className="text-sm font-medium">
                                  {tx.type === "incoming" ? "Received" : "Sent"}
                                </p>
                                {tx.description && (
                                  <p className="text-xs text-muted-foreground">
                                    {tx.description}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                  {formatDate(tx.created_at)}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold">
                                {tx.type === "incoming" ? "+" : "-"}
                                {formatSats(tx.amount)} sats
                              </p>
                              {tx.fees_paid !== undefined &&
                                tx.fees_paid > 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    Fee: {formatSats(tx.fees_paid)} sats
                                  </p>
                                )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
