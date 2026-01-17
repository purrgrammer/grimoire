import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Wallet, AlertCircle } from "lucide-react";
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
import { createWalletFromURI } from "@/services/nwc";

interface ConnectWalletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ConnectWalletDialog({
  open,
  onOpenChange,
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
        methods: info.methods,
        notifications: info.notifications,
      });

      // Show success toast
      toast.success("Wallet Connected", {
        description: info.alias
          ? `Connected to ${info.alias}`
          : "Successfully connected to wallet",
      });

      // Close dialog
      onOpenChange(false);
    } catch (err) {
      console.error("Wallet connection error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
      toast.error("Connection Failed", {
        description:
          err instanceof Error ? err.message : "Failed to connect wallet",
      });
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
            Enter your wallet connection string. You can get this from your
            wallet provider (Alby, Mutiny, etc.)
          </p>

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
            <p className="text-xs text-muted-foreground">
              Format: nostr+walletconnect://pubkey?relay=...&secret=...
            </p>
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
