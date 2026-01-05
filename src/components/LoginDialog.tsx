import { useState } from "react";
import { toast } from "sonner";
import { Eye, Puzzle, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import accountManager from "@/services/accounts";
import { ExtensionSigner, NostrConnectSigner } from "applesauce-signers";
import { ExtensionAccount, NostrConnectAccount } from "applesauce-accounts/accounts";
import { createAccountFromInput } from "@/lib/login-parser";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const [readonlyInput, setReadonlyInput] = useState("");
  const [bunkerInput, setBunkerInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleReadonlyLogin = async () => {
    if (!readonlyInput.trim()) {
      toast.error("Please enter an identifier");
      return;
    }

    setLoading(true);
    try {
      const account = await createAccountFromInput(readonlyInput);
      accountManager.addAccount(account);
      accountManager.setActive(account.id);
      toast.success("Account added successfully");
      onOpenChange(false);
      setReadonlyInput("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add account",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleExtensionLogin = async () => {
    setLoading(true);
    try {
      const signer = new ExtensionSigner();
      const pubkey = await signer.getPublicKey();
      const account = new ExtensionAccount(pubkey, signer);
      accountManager.addAccount(account);
      accountManager.setActive(account.id);
      toast.success("Connected to extension");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to connect to extension",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRemoteSignerLogin = async () => {
    if (!bunkerInput.trim()) {
      toast.error("Please enter a bunker URI");
      return;
    }

    if (!bunkerInput.startsWith("bunker://")) {
      toast.error("Invalid bunker URI. Must start with bunker://");
      return;
    }

    setLoading(true);
    try {
      const signer = await NostrConnectSigner.fromBunkerURI(bunkerInput);
      await signer.open();
      const pubkey = await signer.getPublicKey();
      const account = new NostrConnectAccount(pubkey, signer);
      accountManager.addAccount(account);
      accountManager.setActive(account.id);
      toast.success("Connected to remote signer");
      onOpenChange(false);
      setBunkerInput("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to connect to remote signer",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Account</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="readonly" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="readonly" className="gap-2">
              <Eye className="size-4" />
              Read-only
            </TabsTrigger>
            <TabsTrigger value="extension" className="gap-2">
              <Puzzle className="size-4" />
              Extension
            </TabsTrigger>
            <TabsTrigger value="remote" className="gap-2">
              <Link2 className="size-4" />
              Remote
            </TabsTrigger>
          </TabsList>

          <TabsContent value="readonly" className="space-y-4 pt-4">
            <div className="space-y-2">
              <label htmlFor="identifier" className="text-sm font-medium">
                Identifier
              </label>
              <Input
                id="identifier"
                placeholder="npub1..., user@domain.com, hex, or nprofile1..."
                value={readonlyInput}
                onChange={(e) => setReadonlyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleReadonlyLogin();
                }}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Supports npub, NIP-05, hex pubkey, or nprofile
              </p>
            </div>

            <Button
              onClick={handleReadonlyLogin}
              disabled={loading || !readonlyInput.trim()}
              className="w-full"
            >
              {loading ? "Adding..." : "Add Read-only Account"}
            </Button>
          </TabsContent>

          <TabsContent value="extension" className="space-y-4 pt-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Connect to your browser extension to sign events and encrypt
                messages.
              </p>
              <p className="text-xs text-muted-foreground">
                Supports Alby, nos2x, and other NIP-07 compatible extensions.
              </p>
            </div>

            <Button
              onClick={handleExtensionLogin}
              disabled={loading}
              className="w-full"
            >
              {loading ? "Connecting..." : "Connect Extension"}
            </Button>
          </TabsContent>

          <TabsContent value="remote" className="space-y-4 pt-4">
            <div className="space-y-2">
              <label htmlFor="bunker-uri" className="text-sm font-medium">
                Bunker URI
              </label>
              <Input
                id="bunker-uri"
                placeholder="bunker://..."
                value={bunkerInput}
                onChange={(e) => setBunkerInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRemoteSignerLogin();
                }}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Connect to a remote signer using NIP-46 (Nostr Connect). Paste
                your bunker:// URI from your remote signer app.
              </p>
            </div>

            <Button
              onClick={handleRemoteSignerLogin}
              disabled={loading || !bunkerInput.trim()}
              className="w-full"
            >
              {loading ? "Connecting..." : "Connect Remote Signer"}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
