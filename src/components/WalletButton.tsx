import { useState } from "react";
import { Wallet, Zap, X } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ConnectWalletDialog from "@/components/ConnectWalletDialog";
import { toast } from "sonner";

export default function WalletButton() {
  const { state, disconnectNWC } = useGrimoire();
  const nwcConnection = state.nwcConnection;
  const [showConnectWallet, setShowConnectWallet] = useState(false);
  const [showWalletInfo, setShowWalletInfo] = useState(false);

  function formatBalance(millisats?: number): string {
    if (millisats === undefined) return "—";
    const sats = Math.floor(millisats / 1000);
    return sats.toLocaleString();
  }

  function handleDisconnect() {
    disconnectNWC();
    setShowWalletInfo(false);
    toast.success("Wallet disconnected");
  }

  function handleClick() {
    if (nwcConnection) {
      setShowWalletInfo(true);
    } else {
      setShowConnectWallet(true);
    }
  }

  return (
    <>
      <ConnectWalletDialog
        open={showConnectWallet}
        onOpenChange={setShowConnectWallet}
      />

      {/* Wallet Info Dialog */}
      {nwcConnection && (
        <Dialog open={showWalletInfo} onOpenChange={setShowWalletInfo}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Wallet Info</DialogTitle>
              <DialogDescription>
                Connected Lightning wallet details
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Balance */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Balance:</span>
                <span className="text-lg font-semibold">
                  {formatBalance(nwcConnection.balance)}
                </span>
              </div>

              {/* Wallet Alias */}
              {nwcConnection.info?.alias && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Wallet:</span>
                  <span className="text-sm font-medium">
                    {nwcConnection.info.alias}
                  </span>
                </div>
              )}

              {/* Lightning Address */}
              {nwcConnection.lud16 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Address:
                  </span>
                  <span className="text-sm font-mono">
                    {nwcConnection.lud16}
                  </span>
                </div>
              )}

              {/* Supported Methods */}
              {nwcConnection.info?.methods &&
                nwcConnection.info.methods.length > 0 && (
                  <div>
                    <span className="text-sm text-muted-foreground">
                      Supported Methods:
                    </span>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {nwcConnection.info.methods.map((method) => (
                        <span
                          key={method}
                          className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium"
                        >
                          {method}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              {/* Relays */}
              <div>
                <span className="text-sm text-muted-foreground">Relays:</span>
                <div className="mt-2 space-y-1">
                  {nwcConnection.relays.map((relay) => (
                    <div
                      key={relay}
                      className="text-xs font-mono text-muted-foreground"
                    >
                      {relay}
                    </div>
                  ))}
                </div>
              </div>

              {/* Disconnect Button */}
              <Button
                onClick={handleDisconnect}
                variant="destructive"
                className="w-full"
              >
                <X className="mr-2 size-4" />
                Disconnect Wallet
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Wallet Button */}
      {nwcConnection ? (
        <Button
          size="sm"
          variant="ghost"
          className="gap-2"
          onClick={handleClick}
          title={
            nwcConnection.info?.alias
              ? `${nwcConnection.info.alias} - ${formatBalance(nwcConnection.balance)} sats`
              : `${formatBalance(nwcConnection.balance)} sats`
          }
        >
          <Zap className="size-4 text-yellow-500" />
          <span className="text-sm font-medium">
            {formatBalance(nwcConnection.balance)}
          </span>
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={handleClick}
          title="Connect Wallet"
        >
          <Wallet className="size-4 text-muted-foreground" />
        </Button>
      )}
    </>
  );
}
