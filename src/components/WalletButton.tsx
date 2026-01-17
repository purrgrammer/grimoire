import { useState } from "react";
import { Wallet, Zap } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { Button } from "@/components/ui/button";
import ConnectWalletDialog from "@/components/ConnectWalletDialog";

export default function WalletButton() {
  const { state } = useGrimoire();
  const nwcConnection = state.nwcConnection;
  const [showConnectWallet, setShowConnectWallet] = useState(false);

  function formatBalance(millisats?: number): string {
    if (millisats === undefined) return "—";
    const sats = Math.floor(millisats / 1000);
    return sats.toLocaleString();
  }

  return (
    <>
      <ConnectWalletDialog
        open={showConnectWallet}
        onOpenChange={setShowConnectWallet}
      />

      {nwcConnection ? (
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          onClick={() => setShowConnectWallet(true)}
          title={
            nwcConnection.info?.alias
              ? `${nwcConnection.info.alias} - ${formatBalance(nwcConnection.balance)} sats`
              : `${formatBalance(nwcConnection.balance)} sats`
          }
        >
          <Zap className="size-4 text-yellow-500" />
          <span className="text-sm font-medium">
            {formatBalance(nwcConnection.balance)} sats
          </span>
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowConnectWallet(true)}
          title="Connect Wallet"
        >
          <Wallet className="size-4 text-muted-foreground" />
        </Button>
      )}
    </>
  );
}
