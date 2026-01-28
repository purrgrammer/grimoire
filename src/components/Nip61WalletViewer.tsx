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
  Settings,
  Coins,
  Loader2,
  Wallet,
  Lock,
  ChevronRight,
  ChevronDown,
  ArrowDownLeft,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  WalletBalance,
  WalletHeader,
  WalletHistoryList,
  TransactionRow,
  type HistoryItem,
} from "@/components/wallet";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { useNip61Wallet } from "@/hooks/useNip61Wallet";
import { useGrimoire } from "@/core/state";
import { useAccount } from "@/hooks/useAccount";
import { formatTimestamp } from "@/hooks/useLocale";
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
    unlock,
    unlocking,
    error,
    syncEnabled,
    toggleSyncEnabled,
  } = useNip61Wallet();

  const [refreshing, setRefreshing] = useState(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<WalletHistory | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [showRawTransaction, setShowRawTransaction] = useState(false);
  const [copiedRawTx, setCopiedRawTx] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

      // If not unlocked, show placeholder
      if (!entry.unlocked) {
        return (
          <TransactionRow
            key={entry.id}
            direction="in"
            amount={0}
            blurred={true}
            label={
              <span className="text-sm text-muted-foreground">Locked</span>
            }
            onClick={() => handleTransactionClick(entry)}
          />
        );
      }

      return (
        <TransactionRow
          key={entry.id}
          direction="in" // TODO: Determine from meta$
          amount={0} // TODO: Get from meta$
          blurred={blurred}
          label={
            <span className="text-sm">
              {formatTimestamp(entry.event.created_at, "datetime")}
            </span>
          }
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
        info={
          mints && mints.length > 0 ? (
            <span className="text-muted-foreground ml-2">
              {mints.length} mint{mints.length !== 1 ? "s" : ""}
            </span>
          ) : undefined
        }
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

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Settings"
                >
                  <Settings className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
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
                  <ArrowDownLeft className="size-6 text-green-500" />
                  <div>
                    <p className="text-lg font-semibold">Transaction</p>
                    <p className="text-sm text-muted-foreground">
                      {formatTimestamp(
                        selectedTransaction.event.created_at,
                        "datetime",
                      )}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Event ID
                    </Label>
                    <p className="text-xs font-mono break-all bg-muted p-2 rounded">
                      {selectedTransaction.event.id}
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Status
                    </Label>
                    <p className="text-sm">
                      {selectedTransaction.unlocked ? "Unlocked" : "Locked"}
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">
                      Created At
                    </Label>
                    <p className="text-sm font-mono">
                      {formatTimestamp(
                        selectedTransaction.event.created_at,
                        "absolute",
                      )}
                    </p>
                  </div>
                </div>

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
                    <span>Show Raw Event</span>
                  </button>

                  {showRawTransaction && (
                    <div className="mt-3 space-y-2">
                      <div className="relative">
                        <pre className="text-xs font-mono bg-muted p-3 rounded overflow-x-auto max-h-60 overflow-y-auto">
                          {JSON.stringify(selectedTransaction.event, null, 2)}
                        </pre>
                        <CodeCopyButton
                          copied={copiedRawTx}
                          onCopy={() => {
                            navigator.clipboard.writeText(
                              JSON.stringify(
                                selectedTransaction.event,
                                null,
                                2,
                              ),
                            );
                            setCopiedRawTx(true);
                            setTimeout(() => setCopiedRawTx(false), 2000);
                          }}
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
            <Button
              variant="outline"
              onClick={() => {
                setDetailDialogOpen(false);
                setShowRawTransaction(false);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Wallet Settings</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Keep Wallet Synced</Label>
                <p className="text-xs text-muted-foreground">
                  Keep wallet unlocked and sync history automatically
                </p>
              </div>
              <Switch
                checked={syncEnabled}
                onCheckedChange={toggleSyncEnabled}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Blur Balances</Label>
                <p className="text-xs text-muted-foreground">
                  Hide balance amounts for privacy
                </p>
              </div>
              <Switch
                checked={blurred}
                onCheckedChange={toggleWalletBalancesBlur}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
