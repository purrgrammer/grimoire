/**
 * WalletViewer Component
 *
 * Displays NWC wallet information and provides UI for wallet operations.
 * Layout: Header → Big centered balance → Send/Receive buttons → Transaction list
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  ChevronDown,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useWallet } from "@/hooks/useWallet";
import { useGrimoire } from "@/core/state";
import { decode as decodeBolt11 } from "light-bolt11-decoder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import QRCode from "qrcode";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ConnectWalletDialog from "./ConnectWalletDialog";
import { RelayLink } from "@/components/nostr/RelayLink";

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

interface InvoiceDetails {
  amount?: number;
  description?: string;
  timestamp?: number;
  expiry?: number;
}

const BATCH_SIZE = 20;
const PAYMENT_CHECK_INTERVAL = 5000; // Check every 5 seconds

/**
 * Helper: Format timestamp as a readable day marker
 */
function formatDayMarker(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Reset time parts for comparison
  const dateOnly = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const yesterdayOnly = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  );

  if (dateOnly.getTime() === todayOnly.getTime()) {
    return "Today";
  } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
    return "Yesterday";
  } else {
    // Format as "Jan 15" (short month, no year, respects locale)
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
}

/**
 * Helper: Check if two timestamps are on different days
 */
function isDifferentDay(timestamp1: number, timestamp2: number): boolean {
  const date1 = new Date(timestamp1 * 1000);
  const date2 = new Date(timestamp2 * 1000);

  return (
    date1.getFullYear() !== date2.getFullYear() ||
    date1.getMonth() !== date2.getMonth() ||
    date1.getDate() !== date2.getDate()
  );
}

/**
 * Parse a BOLT11 invoice to extract details with security validations
 */
function parseInvoice(invoice: string): InvoiceDetails | null {
  try {
    // Validate format
    if (!invoice.toLowerCase().startsWith("ln")) {
      throw new Error("Invalid invoice format");
    }

    const decoded = decodeBolt11(invoice);

    // Extract amount (in millisats)
    const amountSection = decoded.sections.find((s) => s.name === "amount");
    const amount =
      amountSection && "value" in amountSection
        ? Number(amountSection.value) / 1000 // Convert to sats
        : undefined;

    // Validate amount is reasonable (< 21M BTC in sats = 2.1 quadrillion msats)
    if (amount && amount > 2100000000000000) {
      throw new Error("Amount exceeds maximum possible value");
    }

    // Extract description
    const descSection = decoded.sections.find((s) => s.name === "description");
    const description =
      descSection && "value" in descSection
        ? String(descSection.value)
        : undefined;

    // Extract timestamp
    const timestampSection = decoded.sections.find(
      (s) => s.name === "timestamp",
    );
    const timestamp =
      timestampSection && "value" in timestampSection
        ? Number(timestampSection.value)
        : undefined;

    // Extract expiry
    const expiry = decoded.expiry;

    // Check if invoice is expired
    if (timestamp && expiry) {
      const expiresAt = timestamp + expiry;
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (expiresAt < nowSeconds) {
        throw new Error("Invoice has expired");
      }
    }

    return {
      amount,
      description,
      timestamp,
      expiry,
    };
  } catch (error) {
    console.error("Failed to parse invoice:", error);
    const message =
      error instanceof Error ? error.message : "Invalid invoice format";
    toast.error(`Invalid invoice: ${message}`);
    return null;
  }
}

export default function WalletViewer() {
  const { state, disconnectNWC: disconnectNWCFromState } = useGrimoire();
  const {
    wallet,
    balance,
    isConnected,
    getInfo,
    refreshBalance,
    listTransactions,
    makeInvoice,
    payInvoice,
    lookupInvoice,
    disconnect,
  } = useWallet();

  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [txLoadAttempted, setTxLoadAttempted] = useState(false);
  const [txLoadFailed, setTxLoadFailed] = useState(false);

  // Use refs to track loading attempts without causing re-renders
  const walletInfoLoadedRef = useRef(false);
  const lastConnectionStateRef = useRef(isConnected);
  const lastBalanceRefreshRef = useRef(0);
  const lastTxLoadRef = useRef(0);

  // Send dialog state
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendInvoice, setSendInvoice] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendStep, setSendStep] = useState<"input" | "confirm">("input");
  const [invoiceDetails, setInvoiceDetails] = useState<InvoiceDetails | null>(
    null,
  );
  const [sending, setSending] = useState(false);

  // Receive dialog state
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [receiveAmount, setReceiveAmount] = useState("");
  const [receiveDescription, setReceiveDescription] = useState("");
  const [generatedInvoice, setGeneratedInvoice] = useState("");
  const [generatedPaymentHash, setGeneratedPaymentHash] = useState("");
  const [invoiceQR, setInvoiceQR] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);

  // Transaction detail dialog state
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  // Load wallet info when connected
  useEffect(() => {
    // Detect connection state changes
    if (isConnected !== lastConnectionStateRef.current) {
      lastConnectionStateRef.current = isConnected;
      walletInfoLoadedRef.current = false;

      if (isConnected) {
        // Reset transaction loading flags when wallet connects
        setTxLoadAttempted(false);
        setTxLoadFailed(false);
        setTransactions([]);
        setWalletInfo(null);
      } else {
        // Clear all state when wallet disconnects
        setTxLoadAttempted(false);
        setTxLoadFailed(false);
        setTransactions([]);
        setWalletInfo(null);
        setLoading(false);
        setLoadingMore(false);
        setHasMore(true);
      }
    }

    // Load wallet info if connected and not yet loaded
    if (isConnected && !walletInfoLoadedRef.current) {
      walletInfoLoadedRef.current = true;
      getInfo()
        .then((info) => setWalletInfo(info))
        .catch((error) => {
          console.error("Failed to load wallet info:", error);
          toast.error("Failed to load wallet info");
          walletInfoLoadedRef.current = false; // Allow retry
        });
    }
  }, [isConnected, getInfo]);

  // Load transactions when wallet info is available (only once)
  useEffect(() => {
    if (
      walletInfo?.methods.includes("list_transactions") &&
      !txLoadAttempted &&
      !loading
    ) {
      setLoading(true);
      setTxLoadAttempted(true);
      listTransactions({
        limit: BATCH_SIZE,
        offset: 0,
      })
        .then((result) => {
          const txs = result.transactions || [];
          setTransactions(txs);
          setHasMore(txs.length === BATCH_SIZE);
          setTxLoadFailed(false);
        })
        .catch((error) => {
          console.error("Failed to load transactions:", error);
          setTxLoadFailed(true);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [walletInfo, txLoadAttempted, loading, listTransactions]);

  // Helper to reload transactions (resets flags to trigger reload)
  const reloadTransactions = useCallback(() => {
    // Rate limiting: minimum 5 seconds between transaction reloads
    const now = Date.now();
    const timeSinceLastLoad = now - lastTxLoadRef.current;
    if (timeSinceLastLoad < 5000) {
      const waitTime = Math.ceil((5000 - timeSinceLastLoad) / 1000);
      toast.warning(`Please wait ${waitTime}s before reloading transactions`);
      return;
    }

    lastTxLoadRef.current = now;
    setTxLoadAttempted(false);
    setTxLoadFailed(false);
  }, []);

  useEffect(() => {
    if (!generatedPaymentHash || !receiveDialogOpen) return;

    const checkPayment = async () => {
      if (!walletInfo?.methods.includes("lookup_invoice")) return;

      setCheckingPayment(true);
      try {
        const result = await lookupInvoice(generatedPaymentHash);
        // If invoice is settled, close dialog and refresh
        if (result.settled_at) {
          toast.success("Payment received!");
          setReceiveDialogOpen(false);
          resetReceiveDialog();
          // Reload transactions
          reloadTransactions();
        }
      } catch (error) {
        // Ignore errors, will retry
      } finally {
        setCheckingPayment(false);
      }
    };

    const intervalId = setInterval(checkPayment, PAYMENT_CHECK_INTERVAL);
    return () => clearInterval(intervalId);
  }, [
    generatedPaymentHash,
    receiveDialogOpen,
    walletInfo,
    lookupInvoice,
    reloadTransactions,
  ]);

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
    // Rate limiting: minimum 2 seconds between refreshes
    const now = Date.now();
    const timeSinceLastRefresh = now - lastBalanceRefreshRef.current;
    if (timeSinceLastRefresh < 2000) {
      const waitTime = Math.ceil((2000 - timeSinceLastRefresh) / 1000);
      toast.warning(`Please wait ${waitTime}s before refreshing again`);
      return;
    }

    lastBalanceRefreshRef.current = now;
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

  async function handleConfirmSend() {
    if (!sendInvoice.trim()) {
      toast.error("Please enter an invoice or Lightning address");
      return;
    }

    const input = sendInvoice.trim();

    // Check if it's a Lightning address
    if (input.includes("@") && !input.toLowerCase().startsWith("ln")) {
      // Lightning address - requires amount
      if (!sendAmount || parseInt(sendAmount) <= 0) {
        toast.error("Please enter an amount for Lightning address payments");
        return;
      }

      setSending(true);
      try {
        const amountSats = parseInt(sendAmount); // Amount is in sats
        const invoice = await resolveLightningAddress(input, amountSats);

        // Update the invoice field with the resolved invoice
        setSendInvoice(invoice);

        // Parse the resolved invoice
        const details = parseInvoice(invoice);
        if (!details) {
          throw new Error("Failed to parse resolved invoice");
        }

        setInvoiceDetails(details);
        setSendStep("confirm");
      } catch (error) {
        console.error("Failed to resolve Lightning address:", error);
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to resolve Lightning address",
        );
      } finally {
        setSending(false);
      }
      return;
    }

    // Parse BOLT11 invoice
    const details = parseInvoice(input);
    if (!details) {
      toast.error("Invalid Lightning invoice");
      return;
    }

    setInvoiceDetails(details);
    setSendStep("confirm");
  }

  // Auto-proceed to confirm when valid invoice with amount is entered
  function handleInvoiceChange(value: string) {
    setSendInvoice(value);

    // If it looks like an invoice, try to parse it
    if (value.toLowerCase().startsWith("ln")) {
      const details = parseInvoice(value);
      // Only auto-proceed if invoice has an amount
      if (details && details.amount !== undefined) {
        setInvoiceDetails(details);
        setSendStep("confirm");
      }
    }
  }

  // Resolve Lightning address to invoice with security validations
  async function resolveLightningAddress(address: string, amountSats: number) {
    try {
      const [username, domain] = address.split("@");
      if (!username || !domain) {
        throw new Error("Invalid Lightning address format");
      }

      // Security: Enforce HTTPS only
      const lnurlUrl = `https://${domain}/.well-known/lnurlp/${username}`;

      // Security: Add timeout for fetch requests (5 seconds)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(lnurlUrl, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(
            `Failed to fetch Lightning address: ${response.statusText}`,
          );
        }

        const data = await response.json();

        if (data.status === "ERROR") {
          throw new Error(data.reason || "Lightning address lookup failed");
        }

        // Validate callback URL uses HTTPS
        if (!data.callback || !data.callback.startsWith("https://")) {
          throw new Error("Invalid callback URL (must use HTTPS)");
        }

        // Check amount limits (amounts are in millisats)
        const amountMsat = amountSats * 1000;
        if (data.minSendable && amountMsat < data.minSendable) {
          throw new Error(
            `Amount too small. Minimum: ${data.minSendable / 1000} sats`,
          );
        }
        if (data.maxSendable && amountMsat > data.maxSendable) {
          throw new Error(
            `Amount too large. Maximum: ${data.maxSendable / 1000} sats`,
          );
        }

        // Fetch invoice from callback
        const callbackUrl = new URL(data.callback);
        callbackUrl.searchParams.set("amount", amountMsat.toString());

        const invoiceController = new AbortController();
        const invoiceTimeoutId = setTimeout(
          () => invoiceController.abort(),
          5000,
        );

        const invoiceResponse = await fetch(callbackUrl.toString(), {
          signal: invoiceController.signal,
        });
        clearTimeout(invoiceTimeoutId);

        if (!invoiceResponse.ok) {
          throw new Error(
            `Failed to get invoice: ${invoiceResponse.statusText}`,
          );
        }

        const invoiceData = await invoiceResponse.json();

        if (invoiceData.status === "ERROR") {
          throw new Error(invoiceData.reason || "Failed to generate invoice");
        }

        return invoiceData.pr; // The BOLT11 invoice
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          throw new Error("Request timeout (5 seconds)");
        }
        throw fetchError;
      }
    } catch (error) {
      console.error("Lightning address resolution failed:", error);
      throw error;
    }
  }

  function handleBackToInput() {
    setSendStep("input");
    setInvoiceDetails(null);
  }

  async function handleSendPayment() {
    setSending(true);
    try {
      // Convert sats to millisats for NWC protocol
      const amount = sendAmount ? parseInt(sendAmount) * 1000 : undefined;
      await payInvoice(sendInvoice, amount);
      toast.success("Payment sent successfully");
      resetSendDialog();
      setSendDialogOpen(false);
      // Reload transactions
      reloadTransactions();
    } catch (error) {
      console.error("Payment failed:", error);
      toast.error(error instanceof Error ? error.message : "Payment failed");
    } finally {
      setSending(false);
    }
  }

  function resetSendDialog() {
    setSendInvoice("");
    setSendAmount("");
    setSendStep("input");
    setInvoiceDetails(null);
  }

  async function handleGenerateInvoice() {
    const amountSats = parseInt(receiveAmount);
    if (!amountSats || amountSats <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setGenerating(true);
    try {
      // Convert sats to millisats for NWC protocol
      const amountMillisats = amountSats * 1000;
      const result = await makeInvoice(amountMillisats, {
        description: receiveDescription || undefined,
      });

      if (!result.invoice) {
        throw new Error("No invoice returned from wallet");
      }

      setGeneratedInvoice(result.invoice);
      // Extract payment hash if available
      if (result.payment_hash) {
        setGeneratedPaymentHash(result.payment_hash);
      }

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

  async function handleCopyInvoice() {
    try {
      await navigator.clipboard.writeText(generatedInvoice);
      setCopied(true);
      toast.success("Invoice copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy invoice:", error);
      toast.error("Failed to copy to clipboard");
    }
  }

  function resetReceiveDialog() {
    setGeneratedInvoice("");
    setGeneratedPaymentHash("");
    setInvoiceQR("");
    setReceiveAmount("");
    setReceiveDescription("");
    setCopied(false);
  }

  function handleDisconnect() {
    // Clear NWC connection from Grimoire state first
    disconnectNWCFromState();
    // Then clear the wallet service
    disconnect();
    setDisconnectDialogOpen(false);
    toast.success("Wallet disconnected");
  }

  function handleTransactionClick(tx: Transaction) {
    setSelectedTransaction(tx);
    setDetailDialogOpen(true);
  }

  function formatSats(millisats: number | undefined): string {
    if (millisats === undefined) return "—";
    return Math.floor(millisats / 1000).toLocaleString();
  }

  function formatFullDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
  }

  // Process transactions to include day markers
  const transactionsWithMarkers = useMemo(() => {
    if (!transactions || transactions.length === 0) return [];

    const items: Array<
      | { type: "transaction"; data: Transaction }
      | { type: "day-marker"; data: string; timestamp: number }
    > = [];

    transactions.forEach((transaction, index) => {
      // Add day marker if this is the first transaction or if day changed
      if (index === 0) {
        items.push({
          type: "day-marker",
          data: formatDayMarker(transaction.created_at),
          timestamp: transaction.created_at,
        });
      } else if (
        isDifferentDay(
          transactions[index - 1].created_at,
          transaction.created_at,
        )
      ) {
        items.push({
          type: "day-marker",
          data: formatDayMarker(transaction.created_at),
          timestamp: transaction.created_at,
        });
      }

      items.push({ type: "transaction", data: transaction });
    });

    return items;
  }, [transactions]);

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
        {/* Left: Wallet Name + Status */}
        <div className="flex items-center gap-2">
          <span className="font-semibold">
            {walletInfo?.alias || "Lightning Wallet"}
          </span>
          <div className="flex items-center gap-1">
            <div className="size-1.5 rounded-full bg-green-500" />
            <span className="text-[10px] text-muted-foreground">Connected</span>
          </div>
        </div>

        {/* Right: Info Dropdown, Refresh, Disconnect */}
        <div className="flex items-center gap-2">
          {walletInfo && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Wallet info"
                >
                  <Info className="size-3" />
                  <ChevronDown className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <div className="p-3 space-y-3">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold">
                      Wallet Information
                    </div>
                    {walletInfo.network && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Network</span>
                        <span className="font-mono capitalize">
                          {walletInfo.network}
                        </span>
                      </div>
                    )}
                    {state.nwcConnection?.relays &&
                      state.nwcConnection.relays.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">
                            Relay
                          </span>
                          <RelayLink
                            url={state.nwcConnection.relays[0]}
                            className="py-0"
                            urlClassname="text-xs"
                            iconClassname="size-3"
                            showInboxOutbox={false}
                          />
                        </div>
                      )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold">Capabilities</div>
                    <div className="flex flex-wrap gap-1">
                      {walletInfo.methods.map((method) => (
                        <span
                          key={method}
                          className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-mono"
                        >
                          {method}
                        </span>
                      ))}
                    </div>
                  </div>

                  {walletInfo.notifications &&
                    walletInfo.notifications.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold">
                          Notifications
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {walletInfo.notifications.map((notification) => (
                            <span
                              key={notification}
                              className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-mono"
                            >
                              {notification}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

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

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setDisconnectDialogOpen(true)}
                className="flex items-center gap-1 text-destructive hover:text-destructive/80 transition-colors"
                aria-label="Disconnect wallet"
              >
                <LogOut className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Disconnect Wallet</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Big Centered Balance */}
      <div className="py-4 flex flex-col items-center justify-center">
        <div className="text-4xl font-bold font-mono">
          {formatSats(balance)}
        </div>
      </div>

      {/* Send / Receive Buttons */}
      {walletInfo &&
        (walletInfo.methods.includes("pay_invoice") ||
          walletInfo.methods.includes("make_invoice")) && (
          <div className="px-4 pb-3">
            <div className="max-w-md mx-auto grid grid-cols-2 gap-3">
              {walletInfo.methods.includes("make_invoice") && (
                <Button
                  onClick={() => setReceiveDialogOpen(true)}
                  variant="outline"
                >
                  <Download className="mr-2 size-4" />
                  Receive
                </Button>
              )}
              {walletInfo.methods.includes("pay_invoice") && (
                <Button
                  onClick={() => setSendDialogOpen(true)}
                  variant="default"
                >
                  <Send className="mr-2 size-4" />
                  Send
                </Button>
              )}
            </div>
          </div>
        )}

      {/* Transaction History */}
      <div className="flex-1 overflow-hidden">
        {walletInfo?.methods.includes("list_transactions") ? (
          loading ? (
            <div className="flex h-full items-center justify-center">
              <RefreshCw className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : txLoadFailed ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
              <p className="text-sm text-muted-foreground text-center">
                Failed to load transaction history
              </p>
              <Button variant="outline" size="sm" onClick={reloadTransactions}>
                <RefreshCw className="mr-2 size-4" />
                Retry
              </Button>
            </div>
          ) : transactionsWithMarkers.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">
                No transactions found
              </p>
            </div>
          ) : (
            <Virtuoso
              data={transactionsWithMarkers}
              endReached={loadMoreTransactions}
              itemContent={(index, item) => {
                if (item.type === "day-marker") {
                  return (
                    <div
                      className="flex justify-center py-2"
                      key={`marker-${item.timestamp}`}
                    >
                      <Label className="text-[10px] text-muted-foreground">
                        {item.data}
                      </Label>
                    </div>
                  );
                }

                const tx = item.data;
                const txLabel =
                  tx.description ||
                  (tx.type === "incoming" ? "Received" : "Payment");

                return (
                  <div
                    key={tx.payment_hash || index}
                    className="flex items-center justify-between border-b border-border px-4 py-2.5 hover:bg-muted/50 transition-colors flex-shrink-0 cursor-pointer"
                    onClick={() => handleTransactionClick(tx)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {tx.type === "incoming" ? (
                        <ArrowDownLeft className="size-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <ArrowUpRight className="size-4 text-red-500 flex-shrink-0" />
                      )}
                      <span className="text-sm truncate">{txLabel}</span>
                    </div>
                    <div className="flex-shrink-0 ml-4">
                      <p className="text-sm font-semibold font-mono">
                        {formatSats(tx.amount)}
                      </p>
                    </div>
                  </div>
                );
              }}
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

      {/* Disconnect Confirmation Dialog */}
      <Dialog
        open={disconnectDialogOpen}
        onOpenChange={setDisconnectDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Wallet?</DialogTitle>
            <DialogDescription>
              This will disconnect your Lightning wallet. You can reconnect at
              any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDisconnectDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDisconnect}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
          </DialogHeader>

          {selectedTransaction && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {selectedTransaction.type === "incoming" ? (
                  <ArrowDownLeft className="size-6 text-green-500" />
                ) : (
                  <ArrowUpRight className="size-6 text-red-500" />
                )}
                <div>
                  <p className="text-lg font-semibold">
                    {selectedTransaction.type === "incoming"
                      ? "Received"
                      : "Sent"}
                  </p>
                  <p className="text-2xl font-bold font-mono">
                    {formatSats(selectedTransaction.amount)} sats
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {selectedTransaction.description && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Description
                    </Label>
                    <p className="text-sm">{selectedTransaction.description}</p>
                  </div>
                )}

                <div>
                  <Label className="text-xs text-muted-foreground">Date</Label>
                  <p className="text-sm font-mono">
                    {formatFullDate(selectedTransaction.created_at)}
                  </p>
                </div>

                {selectedTransaction.fees_paid !== undefined &&
                  selectedTransaction.fees_paid > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Fees Paid
                      </Label>
                      <p className="text-sm font-mono">
                        {formatSats(selectedTransaction.fees_paid)} sats
                      </p>
                    </div>
                  )}

                {selectedTransaction.payment_hash && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Payment Hash
                    </Label>
                    <p className="text-xs font-mono break-all bg-muted p-2 rounded">
                      {selectedTransaction.payment_hash}
                    </p>
                  </div>
                )}

                {selectedTransaction.preimage && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Preimage
                    </Label>
                    <p className="text-xs font-mono break-all bg-muted p-2 rounded">
                      {selectedTransaction.preimage}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDetailDialogOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Dialog */}
      <Dialog
        open={sendDialogOpen}
        onOpenChange={(open) => {
          setSendDialogOpen(open);
          if (!open) resetSendDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Payment</DialogTitle>
            <DialogDescription>
              {sendStep === "input"
                ? "Pay a Lightning invoice or Lightning address. Amount can be overridden if the invoice allows it."
                : "Confirm payment details before sending."}
            </DialogDescription>
          </DialogHeader>

          {sendStep === "input" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Invoice or Lightning Address
                </label>
                <Input
                  placeholder="lnbc... or user@domain.com"
                  value={sendInvoice}
                  onChange={(e) => handleInvoiceChange(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Amount (sats, optional)
                </label>
                <Input
                  type="number"
                  placeholder="Required for Lightning addresses"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty for invoices with fixed amounts
                </p>
              </div>

              <Button
                onClick={handleConfirmSend}
                disabled={!sendInvoice.trim() || sending}
                className="w-full"
              >
                {sending ? (
                  <>
                    <RefreshCw className="mr-2 size-4 animate-spin" />
                    Resolving...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-4">
                <div className="space-y-3">
                  <p className="text-sm font-medium">Confirm Payment</p>
                  <div className="space-y-2 text-sm">
                    {invoiceDetails?.amount && !sendAmount && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amount:</span>
                        <span className="font-semibold font-mono">
                          {Math.floor(invoiceDetails.amount).toLocaleString()}{" "}
                          sats
                        </span>
                      </div>
                    )}
                    {sendAmount && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amount:</span>
                        <span className="font-semibold font-mono">
                          {parseInt(sendAmount).toLocaleString()} sats
                        </span>
                      </div>
                    )}
                    {invoiceDetails?.description && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Description:
                        </span>
                        <span className="truncate ml-2">
                          {invoiceDetails.description}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleBackToInput}
                  disabled={sending}
                  variant="outline"
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSendPayment}
                  disabled={sending}
                  className="flex-1"
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
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Receive Dialog */}
      <Dialog
        open={receiveDialogOpen}
        onOpenChange={(open) => {
          setReceiveDialogOpen(open);
          if (!open) resetReceiveDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Receive Payment</DialogTitle>
            <DialogDescription>
              Generate a Lightning invoice to receive sats.
              {checkingPayment && " Waiting for payment..."}
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
                    <div className="relative">
                      <img
                        src={invoiceQR}
                        alt="Invoice QR Code"
                        className="size-64 rounded-lg border border-border"
                      />
                      {checkingPayment && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
                          <RefreshCw className="size-8 animate-spin text-primary" />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Button
                    onClick={handleCopyInvoice}
                    variant="default"
                    className="w-full h-12"
                  >
                    {copied ? (
                      <>
                        <Check className="mr-2 size-5" />
                        Copied Invoice
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 size-5" />
                        Copy Invoice
                      </>
                    )}
                  </Button>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      Invoice (tap to view)
                    </label>
                    <div
                      className="rounded bg-muted p-3 font-mono text-xs cursor-pointer hover:bg-muted/80 transition-colors break-all line-clamp-2"
                      onClick={handleCopyInvoice}
                    >
                      {generatedInvoice}
                    </div>
                  </div>

                  <Button
                    onClick={resetReceiveDialog}
                    variant="outline"
                    className="w-full"
                    disabled={checkingPayment}
                  >
                    Generate Another
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
