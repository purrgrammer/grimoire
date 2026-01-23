/**
 * Nip61WalletViewer Component
 *
 * Displays NIP-60 Cashu wallet information:
 * - Wallet balance (total and per-mint)
 * - Transaction history
 * - Placeholder send/receive buttons
 */

import { useState, useMemo, useCallback } from "react";
import { Send, Download, RefreshCw, Settings, Coins } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  WalletBalance,
  WalletHeader,
  WalletHistoryList,
  TransactionRow,
  NoWalletView,
  WalletLockedView,
  type HistoryItem,
} from "@/components/wallet";
import { useNip61Wallet } from "@/hooks/useNip61Wallet";
import { useGrimoire } from "@/core/state";
import { useAccount } from "@/hooks/useAccount";
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
                {blurred ? "✦✦✦" : amount.toLocaleString()} sats
              </span>
            </div>
          ))}
        </div>
      </div>
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
    hasWallet,
    isUnlocked,
    balance,
    totalBalance,
    history,
    mints,
    unlock,
    unlocking,
    error,
  } = useNip61Wallet();

  const [refreshing, setRefreshing] = useState(false);

  // Transform history for the list component
  const historyItems = useMemo(() => {
    if (!history) return [];
    return history.map(historyToItem);
  }, [history]);

  // Refresh wallet data
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Re-unlock to refresh encrypted content
      await unlock();
      toast.success("Wallet refreshed");
    } catch (err) {
      console.error("Failed to refresh wallet:", err);
      toast.error("Failed to refresh wallet");
    } finally {
      setRefreshing(false);
    }
  }, [unlock]);

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
          />
        );
      }

      // Get meta synchronously if available
      // Note: In a real implementation, we'd need to handle the observable
      // For now, we'll show a simplified view
      return (
        <TransactionRow
          key={entry.id}
          direction="in" // TODO: Get from meta$
          amount={0} // TODO: Get from meta$
          blurred={state.walletBalancesBlurred ?? false}
          label={
            <span className="text-sm">
              {entry.event.created_at
                ? new Date(entry.event.created_at * 1000).toLocaleTimeString()
                : "Transaction"}
            </span>
          }
        />
      );
    },
    [state.walletBalancesBlurred],
  );

  // Not logged in
  if (!isLoggedIn) {
    return (
      <NoWalletView
        title="Not Logged In"
        message="Log in with a Nostr account to access your Cashu wallet."
      />
    );
  }

  // No wallet found
  if (!hasWallet) {
    return (
      <NoWalletView
        title="No Cashu Wallet"
        message="No NIP-60 Cashu wallet found for your account. Wallet creation is not yet supported in Grimoire."
      />
    );
  }

  // Wallet locked
  if (!isUnlocked) {
    return (
      <WalletLockedView
        message="Your Cashu wallet is encrypted. Unlock it to view your balance and history."
        loading={unlocking}
        onUnlock={unlock}
      />
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
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors opacity-50 cursor-not-allowed"
                  aria-label="Settings (coming soon)"
                  disabled
                >
                  <Settings className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Settings (coming soon)</TooltipContent>
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
        blurred={state.walletBalancesBlurred ?? false}
        onToggleBlur={toggleWalletBalancesBlur}
        label="sats"
      />

      {/* Balance by mint */}
      <MintBalanceBreakdown
        balance={balance}
        blurred={state.walletBalancesBlurred ?? false}
      />

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
    </div>
  );
}
