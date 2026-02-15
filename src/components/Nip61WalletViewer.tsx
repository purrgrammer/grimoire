/**
 * Nip61WalletViewer Component
 *
 * Displays NIP-60 Cashu wallet with proper state machine:
 * - discovering: Searching for wallet on network
 * - missing: No wallet found
 * - locked: Wallet found but encrypted
 * - unlocked: Wallet decrypted, showing balance and history
 */

import { useState, useMemo, useCallback } from "react";
import {
  Send,
  Download,
  RefreshCw,
  Coins,
  Loader2,
  Wallet,
  Lock,
  ChevronRight,
  ChevronDown,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Landmark,
  Radio,
} from "lucide-react";
import { toast } from "sonner";
import { use$ } from "applesauce-react/hooks";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  WalletBalance,
  WalletHeader,
  WalletHistoryList,
  type HistoryItem,
} from "@/components/wallet";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { useNip61Wallet } from "@/hooks/useNip61Wallet";
import { useGrimoire } from "@/core/state";
import { useAccount } from "@/hooks/useAccount";
import { formatTimestamp } from "@/hooks/useLocale";
import { UserName } from "@/components/nostr/UserName";
import { getTagValue } from "applesauce-core/helpers";
import type { WalletHistory } from "applesauce-wallet/casts";

/**
 * Component to display balance breakdown by mint
 */
function MintBalanceBreakdown({
  balance,
  blurred,
}: {
  balance: Record<string, number> | undefined;
  blurred: boolean;
}) {
  if (!balance || Object.keys(balance).length === 0) {
    return null;
  }

  return (
    <div className="px-4 pb-4">
      <div className="max-w-md mx-auto">
        <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
          <Coins className="size-3" />
          Balance by Mint
        </div>
        <div className="space-y-1">
          {Object.entries(balance).map(([mint, amount]) => (
            <div
              key={mint}
              className="flex justify-between items-center py-1.5 px-2 bg-muted/50 rounded text-sm"
            >
              <span className="font-mono text-xs truncate max-w-[200px] text-muted-foreground">
                {new URL(mint).hostname}
              </span>
              <span className="font-mono font-medium">
                {blurred ? "✦✦✦" : amount.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Discovering state view - searching for wallet
 */
function DiscoveringView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Search className="size-8 text-muted-foreground animate-pulse" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Searching for Wallet</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Looking for your NIP-60 Cashu wallet on the Nostr network...
      </p>
      <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Querying relays
      </div>
    </div>
  );
}

/**
 * Missing wallet state view
 */
function MissingWalletView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Wallet className="size-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-2">No Cashu Wallet Found</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        No NIP-60 Cashu wallet was found for your account. Wallet creation is
        not yet supported in Grimoire.
      </p>
    </div>
  );
}

/**
 * Locked wallet state view
 */
function LockedWalletView({
  onUnlock,
  unlocking,
}: {
  onUnlock: () => void;
  unlocking: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Lock className="size-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Wallet Locked</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Your Cashu wallet is encrypted. Unlock it to view your balance and
        transaction history.
      </p>
      <Button onClick={onUnlock} disabled={unlocking}>
        {unlocking ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Unlocking...
          </>
        ) : (
          <>
            <Lock className="mr-2 size-4" />
            Unlock Wallet
          </>
        )}
      </Button>
    </div>
  );
}

/**
 * Not logged in view
 */
function NotLoggedInView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Wallet className="size-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Not Logged In</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Log in with a Nostr account to access your Cashu wallet.
      </p>
    </div>
  );
}

/**
 * Transform WalletHistory into HistoryItem for the list
 */
function historyToItem(entry: WalletHistory): HistoryItem {
  return {
    id: entry.id,
    timestamp: entry.event.created_at,
    data: entry,
  };
}

/**
 * History entry row that subscribes to meta$ for amounts
 */
function HistoryEntryRow({
  entry,
  blurred,
  onClick,
}: {
  entry: WalletHistory;
  blurred: boolean;
  onClick: () => void;
}) {
  // Subscribe to meta$ observable to get direction and amount
  const meta = use$(() => entry.meta$, [entry]);

  const direction = meta?.direction || "in";
  const amount = meta?.amount || 0;

  // Check for p-tag to show username
  const pTagPubkey = getTagValue(entry.event, "p");

  // Build label: username if p-tagged, mint if available, or Received/Sent
  const getLabel = () => {
    if (pTagPubkey) {
      return <UserName pubkey={pTagPubkey} className="text-sm" />;
    }
    if (meta?.mint) {
      try {
        return <span className="text-sm">{new URL(meta.mint).hostname}</span>;
      } catch {
        // Invalid URL, fall through
      }
    }
    return (
      <span className="text-sm">
        {direction === "in" ? "Received" : "Sent"}
      </span>
    );
  };

  return (
    <div
      className="flex items-center justify-between border-b border-border px-4 py-2.5 hover:bg-muted/50 transition-colors flex-shrink-0 cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {direction === "in" ? (
          <ArrowDownLeft className="size-4 text-green-500 flex-shrink-0" />
        ) : (
          <ArrowUpRight className="size-4 text-red-500 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {getLabel()}
          {!entry.unlocked && (
            <span className="text-xs text-muted-foreground ml-2">(locked)</span>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 ml-4">
        <p className="text-sm font-semibold font-mono">
          {blurred ? "✦✦✦✦" : amount.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

export default function Nip61WalletViewer() {
  const { state, toggleWalletBalancesBlur } = useGrimoire();
  const { isLoggedIn } = useAccount();
  const {
    isDiscovering,
    isMissing,
    isLocked,
    balance,
    totalBalance,
    history,
    mints,
    relays,
    unlock,
    unlocking,
    error,
  } = useNip61Wallet();

  const [refreshing, setRefreshing] = useState(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<WalletHistory | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [showRawTransaction, setShowRawTransaction] = useState(false);
  const [copiedRawTx, setCopiedRawTx] = useState(false);

  const blurred = state.walletBalancesBlurred ?? false;

  // Transform history for the list component
  const historyItems = useMemo(() => {
    if (!history) return [];
    return history.map(historyToItem);
  }, [history]);

  // Refresh wallet data
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await unlock();
      toast.success("Wallet refreshed");
    } catch (err) {
      console.error("Failed to refresh wallet:", err);
      toast.error("Failed to refresh wallet");
    } finally {
      setRefreshing(false);
    }
  }, [unlock]);

  // Open transaction detail
  const handleTransactionClick = useCallback((entry: WalletHistory) => {
    setSelectedTransaction(entry);
    setDetailDialogOpen(true);
  }, []);

  // Render history entry
  const renderHistoryEntry = useCallback(
    (item: HistoryItem) => {
      const entry = item.data as WalletHistory;
      return (
        <HistoryEntryRow
          key={entry.id}
          entry={entry}
          blurred={blurred}
          onClick={() => handleTransactionClick(entry)}
        />
      );
    },
    [blurred, handleTransactionClick],
  );

  // Not logged in
  if (!isLoggedIn) {
    return (
      <div className="h-full w-full flex flex-col bg-background text-foreground">
        <NotLoggedInView />
      </div>
    );
  }

  // Discovering
  if (isDiscovering) {
    return (
      <div className="h-full w-full flex flex-col bg-background text-foreground">
        <DiscoveringView />
      </div>
    );
  }

  // Missing wallet
  if (isMissing) {
    return (
      <div className="h-full w-full flex flex-col bg-background text-foreground">
        <MissingWalletView />
      </div>
    );
  }

  // Locked wallet
  if (isLocked) {
    return (
      <div className="h-full w-full flex flex-col bg-background text-foreground">
        <LockedWalletView onUnlock={unlock} unlocking={unlocking} />
      </div>
    );
  }

  // Determine wallet status
  const walletStatus = unlocking || refreshing ? "loading" : "connected";

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <WalletHeader
        name="Cashu Wallet"
        status={walletStatus}
        actions={
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  aria-label="Refresh wallet"
                >
                  <RefreshCw
                    className={`size-3 ${refreshing ? "animate-spin" : ""}`}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>Refresh Wallet</TooltipContent>
            </Tooltip>

            {/* Relays dropdown */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Wallet relays"
                    >
                      <Radio className="size-3" />
                      <span className="text-xs">{relays?.length || 0}</span>
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Wallet Relays</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="max-w-xs">
                {relays && relays.length > 0 ? (
                  relays.map((relay) => (
                    <DropdownMenuItem key={relay} className="font-mono text-xs">
                      {relay.replace("wss://", "")}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled className="text-muted-foreground">
                    No relays configured
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Mints dropdown */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Wallet mints"
                    >
                      <Landmark className="size-3" />
                      <span className="text-xs">{mints?.length || 0}</span>
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Wallet Mints</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="max-w-xs">
                {mints && mints.length > 0 ? (
                  mints.map((mint) => (
                    <DropdownMenuItem key={mint} className="font-mono text-xs">
                      {new URL(mint).hostname}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled className="text-muted-foreground">
                    No mints configured
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Balance */}
      <WalletBalance
        balance={totalBalance}
        blurred={blurred}
        onToggleBlur={toggleWalletBalancesBlur}
      />

      {/* Balance by mint */}
      <MintBalanceBreakdown balance={balance} blurred={blurred} />

      {/* Send / Receive Buttons (Placeholders) */}
      <div className="px-4 pb-3">
        <div className="max-w-md mx-auto grid grid-cols-2 gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" disabled className="opacity-50">
                <Download className="mr-2 size-4" />
                Receive
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="default" disabled className="opacity-50">
                <Send className="mr-2 size-4" />
                Send
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Transaction History */}
      <div className="flex-1 overflow-hidden flex justify-center">
        <div className="w-full max-w-md">
          <WalletHistoryList
            items={historyItems}
            loading={false}
            loadFailed={false}
            hasMore={false}
            emptyMessage="No transaction history"
            renderItem={renderHistoryEntry}
          />
        </div>
      </div>

      {/* Transaction Detail Dialog */}
      <TransactionDetailDialog
        transaction={selectedTransaction}
        open={detailDialogOpen}
        onOpenChange={(open) => {
          setDetailDialogOpen(open);
          if (!open) {
            setShowRawTransaction(false);
            setCopiedRawTx(false);
          }
        }}
        showRaw={showRawTransaction}
        onToggleRaw={() => setShowRawTransaction(!showRawTransaction)}
        copiedRaw={copiedRawTx}
        onCopyRaw={() => {
          if (selectedTransaction) {
            navigator.clipboard.writeText(
              JSON.stringify(selectedTransaction.event, null, 2),
            );
            setCopiedRawTx(true);
            setTimeout(() => setCopiedRawTx(false), 2000);
          }
        }}
        blurred={blurred}
      />
    </div>
  );
}

/**
 * Transaction detail dialog component
 */
function TransactionDetailDialog({
  transaction,
  open,
  onOpenChange,
  showRaw,
  onToggleRaw,
  copiedRaw,
  onCopyRaw,
  blurred,
}: {
  transaction: WalletHistory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showRaw: boolean;
  onToggleRaw: () => void;
  copiedRaw: boolean;
  onCopyRaw: () => void;
  blurred: boolean;
}) {
  // Subscribe to meta$ for transaction details
  const meta = use$(() => transaction?.meta$, [transaction]);

  const direction = meta?.direction || "in";
  const amount = meta?.amount || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Transaction Details</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[calc(70vh-8rem)] pr-2">
          {transaction && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {direction === "in" ? (
                  <ArrowDownLeft className="size-6 text-green-500" />
                ) : (
                  <ArrowUpRight className="size-6 text-red-500" />
                )}
                <div>
                  <p className="text-lg font-semibold">
                    {direction === "in" ? "Received" : "Sent"}
                  </p>
                  <p className="text-2xl font-bold font-mono">
                    {blurred ? "✦✦✦✦✦✦" : amount.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Event ID
                  </Label>
                  <p className="text-xs font-mono break-all bg-muted p-2 rounded">
                    {transaction.event.id}
                  </p>
                </div>

                {meta?.mint && (
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Mint
                    </Label>
                    <p className="text-sm font-mono">
                      {new URL(meta.mint).hostname}
                    </p>
                  </div>
                )}

                <div>
                  <Label className="text-xs text-muted-foreground">
                    Status
                  </Label>
                  <p className="text-sm">
                    {transaction.unlocked ? "Unlocked" : "Locked"}
                  </p>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">
                    Created At
                  </Label>
                  <p className="text-sm font-mono">
                    {formatTimestamp(transaction.event.created_at, "absolute")}
                  </p>
                </div>
              </div>

              {/* Raw Transaction (expandable) */}
              <div className="border-t border-border pt-4 mt-4">
                <button
                  onClick={onToggleRaw}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  {showRaw ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                  <span>Show Raw Event</span>
                </button>

                {showRaw && (
                  <div className="mt-3 space-y-2">
                    <div className="relative">
                      <pre className="text-xs font-mono bg-muted p-3 rounded overflow-x-auto max-h-60 overflow-y-auto">
                        {JSON.stringify(transaction.event, null, 2)}
                      </pre>
                      <CodeCopyButton
                        copied={copiedRaw}
                        onCopy={onCopyRaw}
                        label="Copy event JSON"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
