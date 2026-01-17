import { useState, useEffect, useRef, useCallback } from "react";
import {
  ExtensionSigner,
  NostrConnectSigner,
  PrivateKeySigner,
} from "applesauce-signers";
import {
  ExtensionAccount,
  NostrConnectAccount,
  ReadonlyAccount,
  PrivateKeyAccount,
} from "applesauce-accounts/accounts";
import { generateSecretKey, nip19 } from "nostr-tools";
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
  Eye,
  Key,
  ShieldAlert,
} from "lucide-react";
import accounts from "@/services/accounts";
import pool from "@/services/relay-pool";
import { resolveNip05, isNip05 } from "@/lib/nip05";
import { isValidHexPubkey, normalizeHex } from "@/lib/nostr-validation";

// Default relays for NIP-46 communication
const DEFAULT_NIP46_RELAYS = [
  "wss://relay.nsec.app",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

type LoginTab = "extension" | "readonly" | "nsec" | "nostr-connect";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const [tab, setTab] = useState<LoginTab>("extension");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read-only login state
  const [readonlyInput, setReadonlyInput] = useState("");

  // Private key (nsec) login state
  const [nsecInput, setNsecInput] = useState("");

  // NIP-46 state
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [connectUri, setConnectUri] = useState<string | null>(null);
  const [waitingForSigner, setWaitingForSigner] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const signerRef = useRef<NostrConnectSigner | null>(null);

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
      setReadonlyInput("");
      setNsecInput("");
      setBunkerUrl("");
      setQrDataUrl(null);
      setConnectUri(null);
      setWaitingForSigner(false);
      setCopied(false);
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
        | ReadonlyAccount<unknown>
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

  // Read-only login
  async function loginWithReadonly() {
    if (!readonlyInput.trim()) {
      setError("Please enter a pubkey, npub, nprofile, or NIP-05 address");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let pubkey: string;

      // Try npub/nprofile decode
      if (
        readonlyInput.startsWith("npub") ||
        readonlyInput.startsWith("nprofile")
      ) {
        try {
          const decoded = nip19.decode(readonlyInput);
          if (decoded.type === "npub") {
            pubkey = decoded.data;
          } else if (decoded.type === "nprofile") {
            pubkey = decoded.data.pubkey;
          } else {
            throw new Error("Invalid format");
          }
        } catch (err) {
          throw new Error(
            `Invalid bech32 identifier: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        }
      }
      // Try hex pubkey
      else if (isValidHexPubkey(readonlyInput)) {
        pubkey = normalizeHex(readonlyInput);
      }
      // Try NIP-05
      else if (isNip05(readonlyInput)) {
        const resolved = await resolveNip05(readonlyInput);
        if (!resolved) {
          throw new Error(
            `Failed to resolve NIP-05 identifier: ${readonlyInput}`,
          );
        }
        pubkey = resolved;
      } else {
        throw new Error(
          "Invalid format. Supported: npub1..., nprofile1..., hex pubkey, or user@domain.com",
        );
      }

      const account = ReadonlyAccount.fromPubkey(pubkey);
      handleSuccess(account);
    } catch (err) {
      console.error("Read-only login error:", err);
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setLoading(false);
    }
  }

  // Private key (nsec) login
  async function loginWithNsec() {
    if (!nsecInput.trim()) {
      setError("Please enter a private key");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let account: PrivateKeyAccount<unknown>;

      // Try nsec decode
      if (nsecInput.startsWith("nsec")) {
        try {
          account = PrivateKeyAccount.fromKey(nsecInput);
        } catch (err) {
          throw new Error(
            `Invalid nsec: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        }
      }
      // Try hex private key
      else if (/^[0-9a-f]{64}$/i.test(nsecInput)) {
        account = PrivateKeyAccount.fromKey(nsecInput);
      } else {
        throw new Error(
          "Invalid format. Supported: nsec1... or 64-character hex private key",
        );
      }

      handleSuccess(account);
    } catch (err) {
      console.error("Nsec login error:", err);
      setError(err instanceof Error ? err.message : "Failed to create account");
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="extension" className="gap-2">
              <Puzzle className="size-4" />
              <span className="hidden sm:inline">Extension</span>
            </TabsTrigger>
            <TabsTrigger value="readonly" className="gap-2">
              <Eye className="size-4" />
              <span className="hidden sm:inline">Read-Only</span>
            </TabsTrigger>
            <TabsTrigger value="nsec" className="gap-2">
              <Key className="size-4" />
              <span className="hidden sm:inline">Private Key</span>
            </TabsTrigger>
            <TabsTrigger value="nostr-connect" className="gap-2">
              <QrCode className="size-4" />
              <span className="hidden sm:inline">Remote</span>
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

          <TabsContent value="readonly" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Browse Nostr in read-only mode. You can view content but cannot
              sign events or post.
            </p>

            {error && tab === "readonly" && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <label
                htmlFor="readonly-input"
                className="text-sm font-medium leading-none"
              >
                Public Key or Identifier
              </label>
              <Input
                id="readonly-input"
                placeholder="npub1..., nprofile1..., hex pubkey, or user@domain.com"
                value={readonlyInput}
                onChange={(e) => setReadonlyInput(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Supports npub, nprofile, hex pubkey, or NIP-05 addresses
              </p>
            </div>

            <Button
              onClick={loginWithReadonly}
              disabled={loading || !readonlyInput.trim()}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <Eye className="mr-2 size-4" />
                  Continue in Read-Only Mode
                </>
              )}
            </Button>
          </TabsContent>

          <TabsContent value="nsec" className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Security Warning</p>
                <p>
                  Entering your private key is not recommended. Your key will be
                  stored in browser localStorage and could be exposed. Consider
                  using an extension or remote signer instead.
                </p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              Log in by pasting your private key (nsec or hex format). Only use
              this on trusted devices.
            </p>

            {error && tab === "nsec" && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <label
                htmlFor="nsec-input"
                className="text-sm font-medium leading-none"
              >
                Private Key
              </label>
              <Input
                id="nsec-input"
                type="password"
                placeholder="nsec1... or hex private key"
                value={nsecInput}
                onChange={(e) => setNsecInput(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Supports nsec or 64-character hex private key
              </p>
            </div>

            <Button
              onClick={loginWithNsec}
              disabled={loading || !nsecInput.trim()}
              className="w-full"
              variant="destructive"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <Key className="mr-2 size-4" />
                  Log in with Private Key
                </>
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
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
