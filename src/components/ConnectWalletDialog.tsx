import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Wallet, AlertCircle, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGrimoire } from "@/core/state";
import { createWalletFromURI, balance$ } from "@/services/nwc";

interface ConnectWalletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
}

export default function ConnectWalletDialog({
  open,
  onOpenChange,
  onConnected,
}: ConnectWalletDialogProps) {
  const [connectionString, setConnectionString] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setNWCConnection, updateNWCBalance, updateNWCInfo } = useGrimoire();

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setConnectionString("");
      setLoading(false);
      setError(null);
    }
  }, [open]);

  async function handleConnect() {
    if (!connectionString.trim()) {
      setError("Please enter a connection string");
      return;
    }

    if (!connectionString.startsWith("nostr+walletconnect://")) {
      setError(
        "Invalid connection string. Must start with nostr+walletconnect://",
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create wallet instance from connection string
      const wallet = createWalletFromURI(connectionString);

      // Test the connection by getting wallet info
      const info = await wallet.getInfo();

      // Get initial balance
      let balance: number | undefined;
      try {
        const balanceResult = await wallet.getBalance();
        balance = balanceResult.balance;
        // Update the observable immediately so WalletViewer shows correct balance
        balance$.next(balance);
      } catch (err) {
        console.warn("[NWC] Failed to get balance:", err);
        // Balance is optional, continue anyway
      }

      // Get connection details from the wallet instance
      const serialized = wallet.toJSON();

      // Save connection to state
      setNWCConnection({
        service: serialized.service,
        relays: serialized.relays,
        secret: serialized.secret,
        lud16: serialized.lud16,
        balance,
        info: {
          alias: info.alias,
          network: info.network,
          methods: info.methods,
          notifications: info.notifications,
        },
      });

      // Update balance if we got it
      if (balance !== undefined) {
        updateNWCBalance(balance);
      }

      // Update info
      updateNWCInfo({
        alias: info.alias,
        network: info.network,
        methods: info.methods,
        notifications: info.notifications,
      });

      // Show success toast
      toast.success("Wallet Connected");

      // Close dialog
      onOpenChange(false);

      // Call onConnected callback
      onConnected?.();
    } catch (err) {
      console.error("Wallet connection error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
      toast.error("Failed to connect wallet");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Wallet</DialogTitle>
          <DialogDescription>
            Connect to a Nostr Wallet Connect (NWC) enabled Lightning wallet
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter your wallet connection string. You can get this from your NWC
            wallet provider.
          </p>

          {/* Security warning */}
          <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
            <div className="space-y-1">
              <p className="font-medium text-yellow-900 dark:text-yellow-200">
                Security Notice
              </p>
              <p className="text-yellow-800 dark:text-yellow-300">
                Your wallet connection will be stored in browser storage. Only
                connect on trusted devices.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor="connection-string"
              className="text-sm font-medium leading-none"
            >
              Connection String
            </label>
            <Input
              id="connection-string"
              placeholder="nostr+walletconnect://..."
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
              disabled={loading}
              autoComplete="off"
            />
          </div>

          <Button
            onClick={handleConnect}
            disabled={loading || !connectionString.trim()}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Wallet className="mr-2 size-4" />
                Connect Wallet
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
