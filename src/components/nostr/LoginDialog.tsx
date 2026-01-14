import { useState, useEffect, useRef, useCallback } from "react";
import {
  ExtensionSigner,
  NostrConnectSigner,
  PrivateKeySigner,
} from "applesauce-signers";
import {
  ExtensionAccount,
  NostrConnectAccount,
  PrivateKeyAccount,
} from "applesauce-accounts/accounts";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import QRCode from "qrcode";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Puzzle,
  QrCode,
  Copy,
  Check,
  AlertCircle,
  KeyRound,
  Shield,
} from "lucide-react";
import accounts from "@/services/accounts";
import pool from "@/services/relay-pool";

// Default relays for NIP-46 communication
const DEFAULT_NIP46_RELAYS = [
  "wss://relay.nsec.app",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

type LoginTab = "extension" | "nostr-connect" | "create-import";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const [tab, setTab] = useState<LoginTab>("extension");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // NIP-46 state
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [connectUri, setConnectUri] = useState<string | null>(null);
  const [waitingForSigner, setWaitingForSigner] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const signerRef = useRef<NostrConnectSigner | null>(null);

  // Create/Import state
  const [nsecInput, setNsecInput] = useState("");
  const [generatedNsec, setGeneratedNsec] = useState<string | null>(null);
  const [showNsecWarning, setShowNsecWarning] = useState(false);

  // Cleanup on unmount or dialog close
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      signerRef.current?.close();
    };
  }, []);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setLoading(false);
      setError(null);
      setBunkerUrl("");
      setQrDataUrl(null);
      setConnectUri(null);
      setWaitingForSigner(false);
      setCopied(false);
      setNsecInput("");
      setGeneratedNsec(null);
      setShowNsecWarning(false);
      abortControllerRef.current?.abort();
      signerRef.current?.close();
      signerRef.current = null;
    }
  }, [open]);

  const handleSuccess = useCallback(
    (
      account:
        | ExtensionAccount<unknown>
        | NostrConnectAccount<unknown>
        | PrivateKeyAccount<unknown>,
    ) => {
      accounts.addAccount(account);
      accounts.setActive(account);
      onOpenChange(false);
    },
    [onOpenChange],
  );

  // Extension login
  async function loginWithExtension() {
    setLoading(true);
    setError(null);

    try {
      const signer = new ExtensionSigner();
      const pubkey = await signer.getPublicKey();
      const account = new ExtensionAccount(pubkey, signer);
      handleSuccess(account);
    } catch (err) {
      console.error("Extension login error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to connect to extension",
      );
    } finally {
      setLoading(false);
    }
  }

  // Bunker URL login
  async function loginWithBunkerUrl() {
    if (!bunkerUrl.trim()) {
      setError("Please enter a bunker URL");
      return;
    }

    if (!bunkerUrl.startsWith("bunker://")) {
      setError("Invalid bunker URL. Must start with bunker://");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Set up pool methods for the signer
      NostrConnectSigner.pool = pool;

      // fromBunkerURI parses the URI, creates the signer, and connects automatically
      const signer = await NostrConnectSigner.fromBunkerURI(bunkerUrl);
      signerRef.current = signer;

      // Get the user's pubkey (signer is already connected)
      const pubkey = await signer.getPublicKey();

      const account = new NostrConnectAccount(pubkey, signer);
      handleSuccess(account);
    } catch (err) {
      console.error("Bunker login error:", err);
      signerRef.current?.close();
      signerRef.current = null;
      setError(
        err instanceof Error ? err.message : "Failed to connect to bunker",
      );
    } finally {
      setLoading(false);
    }
  }

  // Generate QR code for remote signer connection
  async function generateQrCode() {
    setLoading(true);
    setError(null);
    setQrDataUrl(null);
    setConnectUri(null);
    setWaitingForSigner(true);

    try {
      // Generate a new client key
      const secretKey = generateSecretKey();
      const clientSigner = new PrivateKeySigner(secretKey);

      // Set up pool methods for the signer
      NostrConnectSigner.pool = pool;

      // Create a new NostrConnectSigner
      const signer = new NostrConnectSigner({
        relays: DEFAULT_NIP46_RELAYS,
        signer: clientSigner,
      });
      signerRef.current = signer;

      // IMPORTANT: Open the connection FIRST before showing QR
      // This ensures we're listening when the signer responds
      await signer.open();

      // Generate the nostrconnect:// URI
      const uri = signer.getNostrConnectURI({
        name: "Grimoire",
        url: window.location.origin,
      });

      // Log for debugging
      console.log("[NIP-46] Generated nostrconnect URI:", uri);
      setConnectUri(uri);

      // Generate QR code with extra margin for better scanning
      const dataUrl = await QRCode.toDataURL(uri, {
        width: 280,
        margin: 4,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      setQrDataUrl(dataUrl);

      // Set up abort controller for cancellation
      abortControllerRef.current = new AbortController();

      setLoading(false);

      // Wait for the remote signer to connect
      console.log("[NIP-46] Waiting for remote signer...");
      await signer.waitForSigner(abortControllerRef.current.signal);
      console.log("[NIP-46] Remote signer connected!");

      // Get the user's pubkey
      const pubkey = await signer.getPublicKey();
      console.log("[NIP-46] Got pubkey:", pubkey);

      const account = new NostrConnectAccount(pubkey, signer);
      handleSuccess(account);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled, don't show error
        return;
      }
      console.error("QR login error:", err);
      signerRef.current?.close();
      signerRef.current = null;
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setLoading(false);
      setWaitingForSigner(false);
    }
  }

  // Copy connect URI to clipboard
  async function copyConnectUri() {
    if (!connectUri) return;

    try {
      await navigator.clipboard.writeText(connectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }

  // Cancel QR code waiting
  function cancelQrLogin() {
    abortControllerRef.current?.abort();
    signerRef.current?.close();
    signerRef.current = null;
    setQrDataUrl(null);
    setConnectUri(null);
    setWaitingForSigner(false);
  }

  // Generate new identity
  async function generateIdentity() {
    setLoading(true);
    setError(null);

    try {
      // Generate a new secret key
      const secretKey = generateSecretKey();
      const pubkey = getPublicKey(secretKey);

      // Convert to nsec for display
      const nsec = nip19.nsecEncode(secretKey);
      setGeneratedNsec(nsec);

      // Create signer and account
      const signer = new PrivateKeySigner(secretKey);
      const account = new PrivateKeyAccount(pubkey, signer);

      handleSuccess(account);
    } catch (err) {
      console.error("Generate identity error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate identity",
      );
    } finally {
      setLoading(false);
    }
  }

  // Login with nsec
  async function loginWithNsec() {
    if (!nsecInput.trim()) {
      setError("Please enter your nsec");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let secretKey: Uint8Array;

      // Try to decode as nsec first
      if (nsecInput.startsWith("nsec1")) {
        const decoded = nip19.decode(nsecInput.trim());
        if (decoded.type !== "nsec") {
          throw new Error("Invalid nsec format");
        }
        secretKey = decoded.data;
      } else {
        // Try to decode as hex
        secretKey = new Uint8Array(
          nsecInput
            .trim()
            .match(/.{1,2}/g)
            ?.map((byte) => parseInt(byte, 16)) || [],
        );
        if (secretKey.length !== 32) {
          throw new Error(
            "Invalid key format. Please enter a valid nsec or hex private key",
          );
        }
      }

      const pubkey = getPublicKey(secretKey);

      // Create signer and account
      const signer = new PrivateKeySigner(secretKey);
      const account = new PrivateKeyAccount(pubkey, signer);

      handleSuccess(account);
    } catch (err) {
      console.error("Nsec login error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to import private key. Please check your nsec and try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Copy generated nsec to clipboard
  async function copyGeneratedNsec() {
    if (!generatedNsec) return;

    try {
      await navigator.clipboard.writeText(generatedNsec);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }

  const hasExtension = typeof window !== "undefined" && "nostr" in window;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log in to Grimoire</DialogTitle>
          <DialogDescription>
            Choose a login method to access your Nostr identity
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as LoginTab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="extension" className="gap-2">
              <Puzzle className="size-4" />
              Extension
            </TabsTrigger>
            <TabsTrigger value="nostr-connect" className="gap-2">
              <QrCode className="size-4" />
              Nostr Connect
            </TabsTrigger>
            <TabsTrigger value="create-import" className="gap-2">
              <KeyRound className="size-4" />
              Create/Import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="extension" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Log in using a browser extension like nos2x, Alby, or similar
              NIP-07 compatible extensions.
            </p>

            {!hasExtension && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-600 dark:text-yellow-400">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  No extension detected. Please install a Nostr extension to use
                  this login method.
                </span>
              </div>
            )}

            {error && tab === "extension" && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              onClick={loginWithExtension}
              disabled={loading || !hasExtension}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect with Extension"
              )}
            </Button>
          </TabsContent>

          <TabsContent value="nostr-connect" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Log in using NIP-46 remote signing. Scan the QR code with a signer
              app or paste a bunker URL.
            </p>

            {error && tab === "nostr-connect" && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* QR Code Section */}
            <div className="space-y-3">
              {qrDataUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-lg bg-white p-2">
                    <img
                      src={qrDataUrl}
                      alt="Nostr Connect QR Code"
                      className="size-64"
                    />
                  </div>
                  <p className="text-center text-sm text-muted-foreground">
                    {waitingForSigner
                      ? "Scan with your signer app and approve the connection"
                      : "Waiting for connection..."}
                  </p>
                  {waitingForSigner && (
                    <div className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">
                        Waiting for approval...
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyConnectUri}
                      disabled={!connectUri}
                    >
                      {copied ? (
                        <>
                          <Check className="mr-2 size-4" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="mr-2 size-4" />
                          Copy URI
                        </>
                      )}
                    </Button>
                    <Button variant="outline" size="sm" onClick={cancelQrLogin}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={generateQrCode}
                  disabled={loading}
                  variant="outline"
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <QrCode className="mr-2 size-4" />
                      Generate QR Code
                    </>
                  )}
                </Button>
              )}
            </div>

            {/* Bunker URL Section */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or enter bunker URL
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="bunker-url"
                className="text-sm font-medium leading-none"
              >
                Bunker URL
              </label>
              <Input
                id="bunker-url"
                placeholder="bunker://..."
                value={bunkerUrl}
                onChange={(e) => setBunkerUrl(e.target.value)}
                disabled={loading || waitingForSigner}
              />
            </div>

            <Button
              onClick={loginWithBunkerUrl}
              disabled={loading || waitingForSigner || !bunkerUrl.trim()}
              className="w-full"
            >
              {loading && !waitingForSigner ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect with Bunker URL"
              )}
            </Button>
          </TabsContent>

          <TabsContent value="create-import" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create a new Nostr identity or import an existing private key.
            </p>

            {error && tab === "create-import" && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Generate Identity Section */}
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <KeyRound className="size-5 text-primary" />
                <h3 className="font-semibold">Generate New Identity</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Create a brand new Nostr identity with a randomly generated
                private key. Make sure to back up your key!
              </p>

              {generatedNsec && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-600 dark:text-yellow-400">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-semibold">
                        Save your private key (nsec)
                      </p>
                      <p className="mt-1">
                        This is your ONLY copy. Store it somewhere safe. Anyone
                        with this key can control your identity.
                      </p>
                    </div>
                  </div>
                  <div className="rounded-md bg-background p-3 font-mono text-xs break-all">
                    {generatedNsec}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyGeneratedNsec}
                    className="w-full"
                  >
                    {copied ? (
                      <>
                        <Check className="mr-2 size-4" />
                        Copied to Clipboard
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 size-4" />
                        Copy Private Key
                      </>
                    )}
                  </Button>
                </div>
              )}

              <Button
                onClick={generateIdentity}
                disabled={loading}
                className="w-full"
                variant="default"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 size-4" />
                    Generate New Identity
                  </>
                )}
              </Button>
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or import existing key
                </span>
              </div>
            </div>

            {/* Import nsec Section */}
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <Shield className="size-5 text-orange-500" />
                <h3 className="font-semibold">Import Private Key</h3>
              </div>

              {/* Security Warning */}
              {!showNsecWarning ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-sm text-orange-600 dark:text-orange-400">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Security Warning</p>
                      <p className="mt-1">
                        Never paste your private key into websites you don't
                        trust. This key gives full control over your Nostr
                        identity.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setShowNsecWarning(true)}
                    className="w-full"
                  >
                    I Understand, Continue
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Enter your private key in nsec or hex format.
                  </p>

                  <div className="space-y-2">
                    <label
                      htmlFor="nsec-input"
                      className="text-sm font-medium leading-none"
                    >
                      Private Key (nsec or hex)
                    </label>
                    <Input
                      id="nsec-input"
                      type="password"
                      placeholder="nsec1... or hex"
                      value={nsecInput}
                      onChange={(e) => setNsecInput(e.target.value)}
                      disabled={loading}
                      className="font-mono"
                    />
                  </div>

                  <Button
                    onClick={loginWithNsec}
                    disabled={loading || !nsecInput.trim()}
                    className="w-full"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      "Import Private Key"
                    )}
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
