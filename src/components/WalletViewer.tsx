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
  ChevronRight,
  Eye,
  EyeOff,
  ExternalLink,
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
import { parseZapRequest, getInvoiceDescription } from "@/lib/wallet-utils";
import { Zap } from "lucide-react";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./nostr/kinds";
import { RichText } from "./nostr/RichText";
import { UserName } from "./nostr/UserName";
import { CodeCopyButton } from "./CodeCopyButton";

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
 * Helper: Detect if a transaction is a Bitcoin on-chain transaction
 * Bitcoin transactions have invoice field containing a Bitcoin address instead of a Lightning invoice
 * Bitcoin address formats:
 * - Legacy (P2PKH): starts with 1
 * - P2SH: starts with 3
 * - Bech32 (native segwit): starts with bc1
 * - Bech32m (taproot): starts with bc1p
 */
function isBitcoinTransaction(transaction: Transaction): boolean {
  if (!transaction.invoice) return false;

  const invoice = transaction.invoice.trim();

  // Lightning invoices start with "ln" (lnbc, lntb, lnbcrt, etc.)
  if (invoice.toLowerCase().startsWith("ln")) {
    return false;
  }

  // Check if it looks like a Bitcoin address
  // Legacy: 1... (26-35 chars)
  // P2SH: 3... (26-35 chars)
  // Bech32: bc1... (42-62 chars for bc1q, 62 chars for bc1p)
  // Testnet: tb1..., 2..., m/n...
  const isBitcoinAddress =
    /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(invoice) || // Legacy or P2SH
    /^bc1[a-z0-9]{39,59}$/i.test(invoice) || // Mainnet bech32/bech32m
    /^tb1[a-z0-9]{39,59}$/i.test(invoice) || // Testnet bech32
    /^[2mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(invoice); // Testnet legacy

  return isBitcoinAddress;
}

/**
 * Helper: Extract txid from preimage field
 * Bitcoin preimage format: "txid" or "txid:outputIndex"
 * We only need the txid part for mempool.space
 */
function extractTxid(preimage: string): string {
  // Remove output index if present (e.g., "txid:0" -> "txid")
  return preimage.split(":")[0];
}

/**
 * Helper: Get mempool.space URL for a Bitcoin transaction
 */
function getMempoolUrl(txid: string, network?: string): string {
  const baseUrl =
    network === "testnet"
      ? "https://mempool.space/testnet"
      : network === "signet"
        ? "https://mempool.space/signet"
        : "https://mempool.space";
  return `${baseUrl}/tx/${txid}`;
}

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

/**
 * Helper to parse coordinate string (kind:pubkey:identifier)
 */
function parseAddressCoordinate(
  coordinate: string,
): { kind: number; pubkey: string; identifier: string } | null {
  const parts = coordinate.split(":");
  if (parts.length !== 3) return null;

  const kind = parseInt(parts[0], 10);
  if (isNaN(kind)) return null;

  return {
    kind,
    pubkey: parts[1],
    identifier: parts[2],
  };
}

/**
 * Component to render zap details in the transaction detail dialog
 */
function ZapTransactionDetail({ transaction }: { transaction: Transaction }) {
  const zapInfo = parseZapRequest(transaction);

  // Parse address coordinate if present (format: kind:pubkey:identifier)
  const addressPointer = zapInfo?.zappedEventAddress
    ? parseAddressCoordinate(zapInfo.zappedEventAddress)
    : null;

  // Call hooks unconditionally (before early return)
  const zappedEvent = useNostrEvent(
    zapInfo?.zappedEventId
      ? { id: zapInfo.zappedEventId }
      : addressPointer || undefined,
  );

  // Early return after hooks
  if (!zapInfo) return null;

  return (
    <div className="space-y-4 pt-4 border-t border-border">
      {/* Zap sender */}
      <div>
        <Label className="text-xs text-muted-foreground flex items-center gap-1">
          <Zap className="size-3 fill-zap text-zap" />
          Zap From
        </Label>
        <div className="mt-1">
          <UserName pubkey={zapInfo.sender} />
        </div>
      </div>

      {/* Zap message */}
      {zapInfo.message && (
        <div>
          <Label className="text-xs text-muted-foreground">Zap Message</Label>
          <div className="mt-1 text-sm">
            <RichText
              content={zapInfo.message}
              event={zapInfo.zapRequestEvent}
            />
          </div>
        </div>
      )}

      {/* Zapped event */}
      {zappedEvent && (
        <div>
          <Label className="text-xs text-muted-foreground">Zapped Post</Label>
          <div className="mt-1 border border-muted rounded-md overflow-hidden">
            <KindRenderer event={zappedEvent} />
          </div>
        </div>
      )}

      {/* Loading state for zapped event */}
      {(zapInfo.zappedEventId || zapInfo.zappedEventAddress) &&
        !zappedEvent && (
          <div>
            <Label className="text-xs text-muted-foreground">Zapped Post</Label>
            <div className="mt-1 text-xs text-muted-foreground">
              Loading event...
            </div>
          </div>
        )}
    </div>
  );
}

/**
 * Component to render a transaction row with zap detection
 */
function TransactionLabel({ transaction }: { transaction: Transaction }) {
  const zapInfo = parseZapRequest(transaction);

  // Not a zap - use original description, invoice description, or default label
  if (!zapInfo) {
    const description =
      transaction.description ||
      getInvoiceDescription(transaction) ||
      (transaction.type === "incoming" ? "Received" : "Payment");

    return <span className="text-sm truncate">{description}</span>;
  }

  // It's a zap! Show username + message on one line

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Zap className="size-3.5 flex-shrink-0 fill-zap text-zap" />
      <div className="text-sm min-w-0 flex items-center gap-2">
        <UserName pubkey={zapInfo.sender} className="flex-shrink-0" />
        {zapInfo.message && (
          <span className="line-clamp-1 min-w-0">
            <RichText
              content={zapInfo.message}
              event={zapInfo.zapRequestEvent}
            />
          </span>
        )}
      </div>
    </div>
  );
}

export default function WalletViewer() {
  const {
    state,
    disconnectNWC: disconnectNWCFromState,
    toggleWalletBalancesBlur,
  } = useGrimoire();
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
  const [showRawTransaction, setShowRawTransaction] = useState(false);
  const [copiedRawTx, setCopiedRawTx] = useState(false);

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
      } catch {
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
          <div className="size-1.5 rounded-full bg-green-500" />
        </div>

        {/* Right: Info Dropdown, Refresh, Disconnect */}
        <div className="flex items-center gap-3">
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
                    {state.nwcConnection?.lud16 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          Lightning Address
                        </span>
                        <span className="font-mono">
                          {state.nwcConnection.lud16}
                        </span>
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
        <button
          onClick={toggleWalletBalancesBlur}
          className="text-4xl font-bold font-mono hover:opacity-70 transition-opacity cursor-pointer flex items-center gap-3"
          title="Click to toggle privacy blur"
        >
          <span>
            {state.walletBalancesBlurred ? "✦✦✦✦✦✦" : formatSats(balance)}
          </span>
          {state.walletBalancesBlurred ? (
            <EyeOff className="size-5 text-muted-foreground" />
          ) : (
            <Eye className="size-5 text-muted-foreground" />
          )}
        </button>
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
      <div className="flex-1 overflow-hidden flex justify-center">
        <div className="w-full max-w-md">
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={reloadTransactions}
                >
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
                        <TransactionLabel transaction={tx} />
                      </div>
                      <div className="flex-shrink-0 ml-4">
                        <p className="text-sm font-semibold font-mono">
                          {state.walletBalancesBlurred
                            ? "✦✦✦✦"
                            : formatSats(tx.amount)}
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
      <Dialog
        open={detailDialogOpen}
        onOpenChange={(open) => {
          setDetailDialogOpen(open);
          if (!open) {
            setShowRawTransaction(false);
            setCopiedRawTx(false);
          }
        }}
      >
        <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto max-h-[calc(70vh-8rem)] pr-2">
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
                      {state.walletBalancesBlurred
                        ? "✦✦✦✦✦✦ sats"
                        : `${formatSats(selectedTransaction.amount)} sats`}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {(() => {
                    const description =
                      selectedTransaction.description ||
                      getInvoiceDescription(selectedTransaction);
                    const isZap = parseZapRequest(selectedTransaction);

                    return (
                      description &&
                      !isZap && (
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Description
                          </Label>
                          <p className="text-sm">{description}</p>
                        </div>
                      )
                    );
                  })()}

                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Date
                    </Label>
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
                          {state.walletBalancesBlurred
                            ? "✦✦✦✦ sats"
                            : `${formatSats(selectedTransaction.fees_paid)} sats`}
                        </p>
                      </div>
                    )}

                  {(() => {
                    const isBitcoin = isBitcoinTransaction(selectedTransaction);

                    if (isBitcoin) {
                      // Bitcoin on-chain transaction - show Transaction ID with mempool.space link
                      // For Bitcoin txs, preimage contains the txid (possibly with :outputIndex)
                      if (!selectedTransaction.preimage) {
                        return null;
                      }

                      const txid = extractTxid(selectedTransaction.preimage);

                      return (
                        <div>
                          <Label className="text-xs text-muted-foreground">
                            Transaction ID
                          </Label>
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-mono break-all bg-muted p-2 rounded flex-1">
                              {txid}
                            </p>
                            <a
                              href={getMempoolUrl(txid, walletInfo?.network)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:text-primary/80 transition-colors flex-shrink-0"
                              title="View on mempool.space"
                            >
                              <ExternalLink className="size-4" />
                            </a>
                          </div>
                        </div>
                      );
                    }

                    // Lightning transaction - show payment hash and preimage
                    return (
                      <>
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
                      </>
                    );
                  })()}
                </div>

                {/* Zap Details (if this is a zap payment) */}
                <ZapTransactionDetail transaction={selectedTransaction} />

                {/* Raw Transaction (expandable) */}
                <div className="border-t border-border pt-4 mt-4">
                  <button
                    onClick={() => setShowRawTransaction(!showRawTransaction)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
                  >
                    {showRawTransaction ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                    <span>Show Raw Transaction</span>
                  </button>

                  {showRawTransaction && (
                    <div className="mt-3 space-y-2">
                      <div className="relative">
                        <pre className="text-xs font-mono bg-muted p-3 rounded overflow-x-auto max-h-60 overflow-y-auto">
                          {JSON.stringify(selectedTransaction, null, 2)}
                        </pre>
                        <CodeCopyButton
                          copied={copiedRawTx}
                          onCopy={() => {
                            navigator.clipboard.writeText(
                              JSON.stringify(selectedTransaction, null, 2),
                            );
                            setCopiedRawTx(true);
                            setTimeout(() => setCopiedRawTx(false), 2000);
                          }}
                          label="Copy transaction JSON"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDetailDialogOpen(false);
                setShowRawTransaction(false);
                setCopiedRawTx(false);
              }}
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
                      <div className="flex justify-between gap-2 min-w-0">
                        <span className="text-muted-foreground flex-shrink-0">
                          Description:
                        </span>
                        <span
                          className="truncate text-right min-w-0"
                          title={invoiceDetails.description}
                        >
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
