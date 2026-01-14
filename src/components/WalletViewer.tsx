import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Wallet,
  Plus,
  Trash2,
  Loader2,
  Check,
  Info,
  AlertCircle,
  Zap,
  Send,
  Download,
  Settings,
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Clock,
} from "lucide-react";
import walletManager from "@/services/wallet";
import type {
  WalletConnectionInfo,
  WalletBalance,
  WalletInfo,
} from "@/services/wallet";
import { use$ } from "applesauce-react/hooks";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export interface WalletViewerProps {
  action: "view" | "connect";
  connectionURI?: string;
  name?: string;
}

/**
 * WalletViewer - Full-featured Lightning wallet UI
 *
 * Features:
 * - Overview: Balance and quick actions
 * - Transactions: Payment history
 * - Send: Pay Lightning invoices
 * - Receive: Generate Lightning invoices
 * - Manage: Wallet connections
 */
function WalletViewer({ action, connectionURI, name }: WalletViewerProps) {
  const [connections, setConnections] = useState<WalletConnectionInfo[]>([]);
  const activeWalletId = use$(walletManager.activeWalletId);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(action === "connect");
  const [newConnectionURI, setNewConnectionURI] = useState(connectionURI || "");
  const [newConnectionName, setNewConnectionName] = useState(name || "");
  const [isAddingConnection, setIsAddingConnection] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Load connections on mount and when action changes
  useEffect(() => {
    loadConnections();
  }, []);

  // Auto-add connection if URI provided via command
  useEffect(() => {
    if (action === "connect" && connectionURI && !isAddingConnection) {
      void handleAddConnection(connectionURI, name);
    }
  }, [action, connectionURI, name]);

  const loadConnections = () => {
    setConnections(walletManager.getConnections());
  };

  const handleAddConnection = async (uri: string, customName?: string) => {
    if (!uri) {
      toast.error("Connection URI required");
      return;
    }

    setIsAddingConnection(true);
    try {
      await walletManager.addConnectionFromURI(uri, customName);
      loadConnections();
      toast.success("Wallet connected successfully");
      setIsAddDialogOpen(false);
      setNewConnectionURI("");
      setNewConnectionName("");
    } catch (error) {
      console.error("Failed to add wallet connection:", error);
      toast.error(
        `Failed to connect wallet: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsAddingConnection(false);
    }
  };

  const handleRemoveConnection = async (id: string) => {
    try {
      walletManager.removeConnection(id);
      loadConnections();
      toast.success("Wallet connection removed");
    } catch (error) {
      console.error("Failed to remove wallet connection:", error);
      toast.error(
        `Failed to remove connection: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const handleSetActiveWallet = (id: string) => {
    try {
      walletManager.setActiveWallet(id);
      toast.success("Active wallet updated");
    } catch (error) {
      console.error("Failed to set active wallet:", error);
      toast.error(
        `Failed to set active wallet: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  // Show empty state if no connections
  if (connections.length === 0) {
    return (
      <div className="h-full w-full flex flex-col bg-background text-foreground items-center justify-center p-8">
        <Wallet className="size-16 mx-auto mb-4 opacity-50 text-muted-foreground" />
        <h2 className="text-xl font-semibold mb-2">No Wallet Connected</h2>
        <p className="text-muted-foreground text-sm mb-6 text-center max-w-md">
          Connect a NIP-47 Nostr Wallet Connect wallet to send and receive
          Lightning payments
        </p>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4 mr-2" />
              Add Wallet Connection
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Wallet Connection</DialogTitle>
              <DialogDescription>
                Connect a NIP-47 Nostr Wallet Connect wallet. Get a connection
                URI from your wallet provider (e.g., Alby, Mutiny, etc.)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Connection URI (required)
                </label>
                <Input
                  placeholder="nostr+walletconnect://..."
                  value={newConnectionURI}
                  onChange={(e) => setNewConnectionURI(e.target.value)}
                  disabled={isAddingConnection}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Wallet Name (optional)
                </label>
                <Input
                  placeholder="My Wallet"
                  value={newConnectionName}
                  onChange={(e) => setNewConnectionName(e.target.value)}
                  disabled={isAddingConnection}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() =>
                  handleAddConnection(newConnectionURI, newConnectionName)
                }
                disabled={isAddingConnection || !newConnectionURI}
              >
                {isAddingConnection && (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                )}
                Connect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="h-full flex flex-col"
      >
        <div className="border-b border-border">
          <TabsList className="w-full justify-start rounded-none border-b-0 bg-transparent p-0">
            <TabsTrigger
              value="overview"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            >
              <Wallet className="size-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="transactions"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            >
              <Clock className="size-4 mr-2" />
              Transactions
            </TabsTrigger>
            <TabsTrigger
              value="send"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            >
              <Send className="size-4 mr-2" />
              Send
            </TabsTrigger>
            <TabsTrigger
              value="receive"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            >
              <Download className="size-4 mr-2" />
              Receive
            </TabsTrigger>
            <TabsTrigger
              value="manage"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            >
              <Settings className="size-4 mr-2" />
              Manage
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="overview" className="m-0 h-full">
            <OverviewTab activeWalletId={activeWalletId} />
          </TabsContent>

          <TabsContent value="transactions" className="m-0 h-full">
            <TransactionsTab activeWalletId={activeWalletId} />
          </TabsContent>

          <TabsContent value="send" className="m-0 h-full">
            <SendTab activeWalletId={activeWalletId} />
          </TabsContent>

          <TabsContent value="receive" className="m-0 h-full">
            <ReceiveTab activeWalletId={activeWalletId} />
          </TabsContent>

          <TabsContent value="manage" className="m-0 h-full">
            <ManageTab
              connections={connections}
              activeWalletId={activeWalletId}
              onSetActive={handleSetActiveWallet}
              onRemove={handleRemoveConnection}
              onAddConnection={handleAddConnection}
              isAddDialogOpen={isAddDialogOpen}
              setIsAddDialogOpen={setIsAddDialogOpen}
              newConnectionURI={newConnectionURI}
              setNewConnectionURI={setNewConnectionURI}
              newConnectionName={newConnectionName}
              setNewConnectionName={setNewConnectionName}
              isAddingConnection={isAddingConnection}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// Overview Tab - Balance and quick actions
function OverviewTab({ activeWalletId }: { activeWalletId?: string }) {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeWalletId) {
      loadWalletData();
    }
  }, [activeWalletId]);

  const loadWalletData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [balanceData, infoData] = await Promise.all([
        walletManager.getBalance(),
        walletManager.getInfo(),
      ]);
      setBalance(balanceData);
      setInfo(infoData);
    } catch (err) {
      console.error("Failed to load wallet data:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load wallet data",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const formatBalance = (millisats: number) => {
    const sats = Math.floor(millisats / 1000);
    return sats.toLocaleString();
  };

  if (!activeWalletId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No active wallet selected
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Balance Card */}
      <div className="border rounded-lg p-6 bg-muted/30">
        <div className="text-sm text-muted-foreground mb-2">Total Balance</div>
        {isLoading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <span>Loading...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-red-500">
            <AlertCircle className="size-5" />
            <span>{error}</span>
          </div>
        ) : balance ? (
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold font-mono">
              {formatBalance(balance.balance)}
            </span>
            <span className="text-xl text-muted-foreground">sats</span>
          </div>
        ) : null}

        {info && (
          <div className="mt-4 text-xs text-muted-foreground space-y-1">
            {info.alias && <div>Wallet: {info.alias}</div>}
            {info.network && <div>Network: {info.network}</div>}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4">
        <Button variant="outline" size="lg" className="h-auto py-4" disabled>
          <Send className="size-5 mr-2" />
          <div className="text-left">
            <div className="font-semibold">Send</div>
            <div className="text-xs text-muted-foreground">Pay invoice</div>
          </div>
        </Button>
        <Button variant="outline" size="lg" className="h-auto py-4" disabled>
          <Download className="size-5 mr-2" />
          <div className="text-left">
            <div className="font-semibold">Receive</div>
            <div className="text-xs text-muted-foreground">Create invoice</div>
          </div>
        </Button>
      </div>
    </div>
  );
}

// Transactions Tab - Payment history
function TransactionsTab({ activeWalletId }: { activeWalletId?: string }) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeWalletId) {
      loadTransactions();
    }
  }, [activeWalletId]);

  const loadTransactions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const txs = await walletManager.listTransactions();
      setTransactions(txs);
    } catch (err) {
      console.error("Failed to load transactions:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load transactions",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const formatAmount = (millisats: number) => {
    const sats = Math.floor(millisats / 1000);
    return sats.toLocaleString();
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  if (!activeWalletId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No active wallet selected
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <AlertCircle className="size-12 text-red-500" />
        <p className="text-red-500">{error}</p>
        <Button onClick={loadTransactions}>Retry</Button>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Clock className="size-12 mb-4 opacity-50" />
        <p>No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {transactions.map((tx, index) => (
        <div
          key={index}
          className="px-4 py-3 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {tx.type === "incoming" ? (
                  <ArrowDownLeft className="size-4 text-green-500" />
                ) : (
                  <ArrowUpRight className="size-4 text-red-500" />
                )}
                <span className="font-semibold text-sm">
                  {tx.type === "incoming" ? "Received" : "Sent"}
                </span>
              </div>
              {tx.description && (
                <p className="text-sm text-muted-foreground truncate">
                  {tx.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {formatDate(tx.settled_at || tx.created_at)}
              </p>
            </div>
            <div className="text-right">
              <div
                className={`font-mono font-semibold ${tx.type === "incoming" ? "text-green-500" : "text-red-500"}`}
              >
                {tx.type === "incoming" ? "+" : "-"}
                {formatAmount(tx.amount)} sats
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Send Tab - Pay Lightning invoice
function SendTab({ activeWalletId }: { activeWalletId?: string }) {
  const [invoice, setInvoice] = useState("");
  const [amount, setAmount] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!invoice) {
      toast.error("Please enter a Lightning invoice");
      return;
    }

    setIsSending(true);
    try {
      const result = await walletManager.payInvoice(invoice);
      toast.success("Payment sent successfully!");
      setInvoice("");
      setAmount("");
      console.log("Payment preimage:", result.preimage);
    } catch (error) {
      console.error("Failed to send payment:", error);
      toast.error(
        `Failed to send payment: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsSending(false);
    }
  };

  if (!activeWalletId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No active wallet selected
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium">Lightning Invoice</label>
        <Textarea
          placeholder="lnbc..."
          value={invoice}
          onChange={(e) => setInvoice(e.target.value)}
          disabled={isSending}
          className="font-mono text-sm"
          rows={4}
        />
        <p className="text-xs text-muted-foreground">
          Paste a Lightning invoice (BOLT11) to send payment
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">
          Amount (optional, if not specified in invoice)
        </label>
        <Input
          type="number"
          placeholder="1000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isSending}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Amount in satoshis (only for zero-amount invoices)
        </p>
      </div>

      <Button
        onClick={handleSend}
        disabled={isSending || !invoice}
        className="w-full"
        size="lg"
      >
        {isSending ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            Sending...
          </>
        ) : (
          <>
            <Send className="size-4 mr-2" />
            Send Payment
          </>
        )}
      </Button>
    </div>
  );
}

// Receive Tab - Generate Lightning invoice
function ReceiveTab({ activeWalletId }: { activeWalletId?: string }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [invoice, setInvoice] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    const amountNum = parseInt(amount);
    if (!amountNum || amountNum <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setIsGenerating(true);
    try {
      const result = await walletManager.makeInvoice(amountNum, description);
      setInvoice(result.invoice);
      toast.success("Invoice generated!");
    } catch (error) {
      console.error("Failed to generate invoice:", error);
      toast.error(
        `Failed to generate invoice: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(invoice);
    toast.success("Invoice copied to clipboard!");
  };

  const handleReset = () => {
    setInvoice("");
    setAmount("");
    setDescription("");
  };

  if (!activeWalletId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No active wallet selected
      </div>
    );
  }

  if (invoice) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="border rounded-lg p-6 bg-muted/30 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Invoice Generated</h3>
            <Zap className="size-5 text-yellow-500" />
          </div>
          <div className="p-4 bg-background rounded border font-mono text-sm break-all">
            {invoice}
          </div>
          <Button onClick={handleCopy} className="w-full" variant="outline">
            <Copy className="size-4 mr-2" />
            Copy Invoice
          </Button>
        </div>
        <Button onClick={handleReset} variant="outline" className="w-full">
          Generate New Invoice
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium">Amount (sats) *</label>
        <Input
          type="number"
          placeholder="1000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isGenerating}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Amount to receive in satoshis
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Description (optional)</label>
        <Input
          placeholder="Payment for..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isGenerating}
        />
        <p className="text-xs text-muted-foreground">
          Optional note for the payer
        </p>
      </div>

      <Button
        onClick={handleGenerate}
        disabled={isGenerating || !amount}
        className="w-full"
        size="lg"
      >
        {isGenerating ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Download className="size-4 mr-2" />
            Generate Invoice
          </>
        )}
      </Button>
    </div>
  );
}

// Manage Tab - Wallet connections
interface ManageTabProps {
  connections: WalletConnectionInfo[];
  activeWalletId?: string;
  onSetActive: (id: string) => void;
  onRemove: (id: string) => void;
  onAddConnection: (uri: string, name?: string) => void;
  isAddDialogOpen: boolean;
  setIsAddDialogOpen: (open: boolean) => void;
  newConnectionURI: string;
  setNewConnectionURI: (uri: string) => void;
  newConnectionName: string;
  setNewConnectionName: (name: string) => void;
  isAddingConnection: boolean;
}

function ManageTab({
  connections,
  activeWalletId,
  onSetActive,
  onRemove,
  onAddConnection,
  isAddDialogOpen,
  setIsAddDialogOpen,
  newConnectionURI,
  setNewConnectionURI,
  newConnectionName,
  setNewConnectionName,
  isAddingConnection,
}: ManageTabProps) {
  return (
    <div>
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold">Wallet Connections</h3>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="size-4 mr-2" />
              Add Connection
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Wallet Connection</DialogTitle>
              <DialogDescription>
                Connect a NIP-47 Nostr Wallet Connect wallet. Get a connection
                URI from your wallet provider (e.g., Alby, Mutiny, etc.)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Connection URI (required)
                </label>
                <Input
                  placeholder="nostr+walletconnect://..."
                  value={newConnectionURI}
                  onChange={(e) => setNewConnectionURI(e.target.value)}
                  disabled={isAddingConnection}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Wallet Name (optional)
                </label>
                <Input
                  placeholder="My Wallet"
                  value={newConnectionName}
                  onChange={(e) => setNewConnectionName(e.target.value)}
                  disabled={isAddingConnection}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() =>
                  onAddConnection(newConnectionURI, newConnectionName)
                }
                disabled={isAddingConnection || !newConnectionURI}
              >
                {isAddingConnection && (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                )}
                Connect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="divide-y divide-border">
        {connections.map((connection) => (
          <WalletCard
            key={connection.id}
            connection={connection}
            isActive={activeWalletId === connection.id}
            onSetActive={onSetActive}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

interface WalletCardProps {
  connection: WalletConnectionInfo;
  isActive: boolean;
  onSetActive: (id: string) => void;
  onRemove: (id: string) => void;
}

function WalletCard({
  connection,
  isActive,
  onSetActive,
  onRemove,
}: WalletCardProps) {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWalletData();
  }, [connection.id]);

  const loadWalletData = async () => {
    setIsLoadingBalance(true);
    setError(null);
    try {
      const [balanceData, infoData] = await Promise.all([
        walletManager.getBalance(connection.id),
        walletManager.getInfo(connection.id),
      ]);
      setBalance(balanceData);
      setInfo(infoData);
    } catch (err) {
      console.error("Failed to load wallet data:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load wallet data",
      );
    } finally {
      setIsLoadingBalance(false);
    }
  };

  const formatBalance = (millisats: number) => {
    const sats = Math.floor(millisats / 1000);
    return sats.toLocaleString();
  };

  return (
    <div className="px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-sm truncate">
              {connection.name}
            </h3>
            {isActive && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">
                    <Check className="size-4 text-green-500" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Active Wallet</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <div className="text-xs text-muted-foreground font-mono truncate mb-2">
            {connection.relays.join(", ")}
          </div>

          <div className="flex items-center gap-2">
            {isLoadingBalance ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm">Loading balance...</span>
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 text-red-500">
                <AlertCircle className="size-4" />
                <span className="text-sm">{error}</span>
              </div>
            ) : balance ? (
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-yellow-500" />
                <span className="font-mono font-semibold">
                  {formatBalance(balance.balance)} sats
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {info && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-xs space-y-1">
                  {info.alias && <div>Alias: {info.alias}</div>}
                  {info.network && <div>Network: {info.network}</div>}
                  <div>Methods: {info.methods.join(", ")}</div>
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {!isActive && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onSetActive(connection.id)}
            >
              Set Active
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onRemove(connection.id)}
                className="text-muted-foreground hover:text-red-500 transition-colors"
              >
                <Trash2 className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Remove Connection</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export default WalletViewer;
