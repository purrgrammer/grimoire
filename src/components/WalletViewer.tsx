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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export interface WalletViewerProps {
  action: "view" | "connect";
  connectionURI?: string;
  name?: string;
}

/**
 * WalletViewer - Manage NIP-47 Nostr Wallet Connect connections
 *
 * Features:
 * - View all wallet connections
 * - Add new NWC connections
 * - View wallet balances
 * - Set active wallet
 * - Remove connections
 */
function WalletViewer({ action, connectionURI, name }: WalletViewerProps) {
  const [connections, setConnections] = useState<WalletConnectionInfo[]>([]);
  const activeWalletId = use$(walletManager.activeWalletId);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(action === "connect");
  const [newConnectionURI, setNewConnectionURI] = useState(connectionURI || "");
  const [newConnectionName, setNewConnectionName] = useState(name || "");
  const [isAddingConnection, setIsAddingConnection] = useState(false);

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

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Wallet Manager</h1>
        </div>
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

      {/* Wallet List */}
      <div className="flex-1 overflow-y-auto">
        {connections.length === 0 && (
          <div className="text-center text-muted-foreground font-mono text-sm p-8">
            <Wallet className="size-12 mx-auto mb-4 opacity-50" />
            <p className="mb-2">No wallet connections</p>
            <p className="text-xs">
              Add a NIP-47 wallet connection to get started
            </p>
          </div>
        )}

        {connections.map((connection) => (
          <WalletCard
            key={connection.id}
            connection={connection}
            isActive={activeWalletId === connection.id}
            onSetActive={handleSetActiveWallet}
            onRemove={handleRemoveConnection}
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
    <div className="border-b border-border">
      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Main Row */}
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

            {/* Relays */}
            <div className="text-xs text-muted-foreground font-mono truncate mb-2">
              {connection.relays.join(", ")}
            </div>

            {/* Balance */}
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

          {/* Actions */}
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
    </div>
  );
}

export default WalletViewer;
