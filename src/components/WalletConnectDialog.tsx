import { useState } from "react";
import { Wallet, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import walletManager from "@/services/wallet";
import { toast } from "sonner";

interface WalletConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function WalletConnectDialog({
  open,
  onOpenChange,
}: WalletConnectDialogProps) {
  const [connectURI, setConnectURI] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  async function handleConnect() {
    if (!connectURI.trim()) {
      toast.error("Please enter a connection URI");
      return;
    }

    setIsConnecting(true);

    try {
      await walletManager.connect(connectURI);
      toast.success("Wallet connected successfully");
      onOpenChange(false);
      setConnectURI("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to connect wallet", {
        description: message,
      });
    } finally {
      setIsConnecting(false);
    }
  }

  function handleOpenChange(open: boolean) {
    if (!isConnecting) {
      onOpenChange(open);
      if (!open) {
        setConnectURI("");
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="size-5" />
            Connect Wallet
          </DialogTitle>
          <DialogDescription>
            Connect your Lightning wallet using Nostr Wallet Connect (NIP-47).
            Your wallet will stay connected across sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Connection URI</Label>
            <Input
              placeholder="nostr+walletconnect://..."
              value={connectURI}
              onChange={(e) => setConnectURI(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isConnecting) {
                  handleConnect();
                }
              }}
              disabled={isConnecting}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Get this from your wallet service (e.g., Alby, Mutiny, etc.)
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isConnecting}
          >
            Cancel
          </Button>
          <Button onClick={handleConnect} disabled={isConnecting}>
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Connecting...
              </>
            ) : (
              "Connect"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
