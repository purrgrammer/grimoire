import { useState } from "react";
import { Wallet, Zap, RefreshCw, Copy, Check } from "lucide-react";
import { use$ } from "applesauce-react/hooks";
import walletManager from "@/services/wallet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import WalletConnectDialog from "./WalletConnectDialog";
import { npubEncode } from "applesauce-core/helpers";

export default function WalletViewer() {
  const walletState = use$(walletManager.state$);
  const [showConnect, setShowConnect] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedPubkey, setCopiedPubkey] = useState(false);

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
