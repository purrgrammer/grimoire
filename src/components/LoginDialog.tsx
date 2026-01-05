import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Eye, Puzzle, Link2, QrCode, Keyboard } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
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
import pool from "@/services/relay-pool";
import { ExtensionSigner, NostrConnectSigner, PrivateKeySigner } from "applesauce-signers";
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

  // NIP-46 QR mode state
  const [useQrMode, setUseQrMode] = useState(true);
  const [nostrConnectUri, setNostrConnectUri] = useState("");
  const [remoteSigner, setRemoteSigner] = useState<NostrConnectSigner | null>(null);
  const [isWaitingForConnection, setIsWaitingForConnection] = useState(false);

  // Generate nostrconnect:// URI when dialog opens in QR mode
  useEffect(() => {
    if (open && useQrMode && !remoteSigner) {
      const initQrMode = async () => {
        try {
          // Create a temporary client signer
          const clientSigner = new PrivateKeySigner();

          // Create NostrConnectSigner with default relays
          const signer = new NostrConnectSigner({
            signer: clientSigner,
            relays: [
              "wss://relay.nsec.app",
              "wss://relay.damus.io",
              "wss://nos.lol",
            ],
            pool,
          });

          await signer.open();

          // Generate nostrconnect:// URI with app metadata and permissions
          const uri = signer.getNostrConnectURI({
            name: "Grimoire",
            url: window.location.origin,
            permissions: [
              "sign_event:1",  // Short text notes
              "sign_event:3",  // Contact list
              "sign_event:6",  // Reposts
              "sign_event:7",  // Reactions
              "sign_event:1984", // Reporting
              "sign_event:9734", // Zap requests
              "sign_event:9735", // Zap receipts
              "sign_event:10002", // Relay list
              "sign_event:30023", // Long-form content
              "nip04_encrypt",
              "nip04_decrypt",
              "nip44_encrypt",
              "nip44_decrypt",
            ],
          });

          setNostrConnectUri(uri);
          setRemoteSigner(signer);

          // Start waiting for connection
          setIsWaitingForConnection(true);

          // Wait for remote signer to connect (with 5 minute timeout)
          const abortController = new AbortController();
          const timeoutId = setTimeout(() => abortController.abort(), 5 * 60 * 1000);

          try {
            await signer.waitForSigner(abortController.signal);
            clearTimeout(timeoutId);

            // Connection established, get pubkey and create account
            const pubkey = await signer.getPublicKey();
            const account = new NostrConnectAccount(pubkey, signer);
            accountManager.addAccount(account);
            accountManager.setActive(account.id);

            toast.success("Connected to remote signer");
            onOpenChange(false);

            // Cleanup
            setRemoteSigner(null);
            setNostrConnectUri("");
            setIsWaitingForConnection(false);
          } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
              toast.error("Connection timeout. Please try again.");
            }
            // Reset on error but keep dialog open
            setIsWaitingForConnection(false);
          }
        } catch (error) {
          console.error("Failed to initialize QR mode:", error);
          toast.error("Failed to generate connection code");
        }
      };

      initQrMode();
    }

    // Cleanup when dialog closes
    return () => {
      if (remoteSigner && !isWaitingForConnection) {
        remoteSigner.close();
        setRemoteSigner(null);
        setNostrConnectUri("");
      }
    };
  }, [open, useQrMode]);

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
      const signer = await NostrConnectSigner.fromBunkerURI(bunkerInput, { pool });
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
            {/* Toggle between QR and manual input */}
            <div className="flex gap-2">
              <Button
                variant={useQrMode ? "default" : "outline"}
                size="sm"
                onClick={() => setUseQrMode(true)}
                className="flex-1"
              >
                <QrCode className="size-4 mr-2" />
                QR Code
              </Button>
              <Button
                variant={!useQrMode ? "default" : "outline"}
                size="sm"
                onClick={() => setUseQrMode(false)}
                className="flex-1"
              >
                <Keyboard className="size-4 mr-2" />
                Manual
              </Button>
            </div>

            {useQrMode ? (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-4 p-4 bg-muted/50 rounded-lg">
                  {nostrConnectUri ? (
                    <>
                      <QRCodeSVG
                        value={nostrConnectUri}
                        size={256}
                        level="M"
                        className="border-4 border-white rounded"
                      />
                      {isWaitingForConnection && (
                        <div className="text-center">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            Waiting for remote signer...
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      Generating connection code...
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Scan this QR code with your remote signer app (like Amber,
                  nsec.app, or any NIP-46 compatible app)
                </p>
              </div>
            ) : (
              <div className="space-y-4">
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
                    Paste your bunker:// URI from your remote signer app
                  </p>
                </div>

                <Button
                  onClick={handleRemoteSignerLogin}
                  disabled={loading || !bunkerInput.trim()}
                  className="w-full"
                >
                  {loading ? "Connecting..." : "Connect Remote Signer"}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
