import { useState, useRef } from "react";
import { NostrConnectSigner, ExtensionSigner } from "applesauce-signers";
import {
  ExtensionAccount,
  NostrConnectAccount,
} from "applesauce-accounts/accounts";
import accounts from "@/services/accounts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, QrCode, Puzzle } from "lucide-react";

const QRCode = ({ data }: { data: string }) => (
  <div className="flex items-center justify-center p-4 bg-white rounded-lg">
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`}
      alt="QR Code"
      className="w-48 h-48"
    />
  </div>
);

const ErrorAlert = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
    <AlertCircle className="h-4 w-4 text-destructive" />
    <p className="text-sm text-destructive">{children}</p>
  </div>
);

const LoginCard = ({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) => (
  <div className="bg-card rounded-lg border border-border p-6">
    <div className="flex items-center gap-3 mb-4">
      {icon}
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
    {children}
  </div>
);

const Nip07Login = ({ onLogin }: { onLogin: (pubkey: string) => void }) => {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setLoading(true);
      setError(null);

      const signer = new ExtensionSigner();
      const pubkey = await signer.getPublicKey();
      const account = new ExtensionAccount(pubkey, signer);

      accounts.addAccount(account);
      accounts.setActive(account);
      onLogin(pubkey);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect to extension",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <LoginCard
      icon={
        <div className="p-2 bg-primary/10 rounded-lg">
          <Puzzle className="h-5 w-5 text-primary" />
        </div>
      }
      title="Browser Extension"
      subtitle="Login with NIP-07 extension"
    >
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <Button className="w-full mt-4" onClick={handleLogin} disabled={loading}>
        {loading ? "Connecting..." : "Connect Extension"}
      </Button>
    </LoginCard>
  );
};

const NostrConnectLogin = ({
  onSuccess,
}: {
  onSuccess: (pubkey: string) => void;
}) => {
  const [bunkerUrl, setBunkerUrl] = useState("");
  const [nostrConnectUri, setNostrConnectUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleBunkerConnect = async () => {
    if (!bunkerUrl) return;

    try {
      setLoading(true);
      setError(null);
      const signer = await NostrConnectSigner.fromBunkerURI(bunkerUrl);
      const pubkey = await signer.getPublicKey();
      const account = new NostrConnectAccount(pubkey, signer);
      accounts.addAccount(account);
      accounts.setActive(account);
      onSuccess(pubkey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  const handleQrCodeLogin = async () => {
    try {
      setLoading(true);
      setError(null);

      const signer = new NostrConnectSigner({
        relays: ["wss://relay.nsec.app"],
      });
      const uri = signer.getNostrConnectURI({ name: "Grimoire" });
      setNostrConnectUri(uri);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      await signer.waitForSigner(controller.signal);
      clearTimeout(timeoutId);

      const pubkey = await signer.getPublicKey();
      const account = new NostrConnectAccount(pubkey, signer);
      accounts.addAccount(account);
      accounts.setActive(account);
      onSuccess(pubkey);
    } catch (err) {
      if (err instanceof Error && err.message === "Aborted") {
        setError("Something went wrong. Please try again.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to connect");
      }
    } finally {
      setLoading(false);
      setNostrConnectUri(null);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setNostrConnectUri(null);
    setLoading(false);
  };

  if (nostrConnectUri) {
    return (
      <LoginCard
        icon={
          <div className="p-2 bg-accent/10 rounded-lg">
            <QrCode className="h-5 w-5 text-accent" />
          </div>
        }
        title="Scan QR Code"
        subtitle="Use your mobile signer"
      >
        <div className="flex flex-col items-center space-y-4">
          <a target="_parent" href={nostrConnectUri}>
            <QRCode data={nostrConnectUri} />
          </a>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          {error && <ErrorAlert>{error}</ErrorAlert>}
        </div>
      </LoginCard>
    );
  }

  return (
    <LoginCard
      icon={
        <div className="p-2 bg-accent/10 rounded-lg">
          <QrCode className="h-5 w-5 text-accent" />
        </div>
      }
      title="Remote Signer"
      subtitle="Nostr Connect (NIP-46)"
    >
      <div className="space-y-3">
        <Button
          className="w-full"
          onClick={handleQrCodeLogin}
          disabled={loading}
        >
          {loading ? "Connecting..." : "Login with QR Code"}
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">Or</span>
          </div>
        </div>

        <Input
          type="text"
          placeholder="bunker://..."
          value={bunkerUrl}
          onChange={(e) => setBunkerUrl(e.target.value)}
        />
        <Button
          className="w-full"
          onClick={handleBunkerConnect}
          disabled={!bunkerUrl || loading}
        >
          {loading ? "Connecting..." : "Connect Bunker URL"}
        </Button>
      </div>

      {error && <ErrorAlert>{error}</ErrorAlert>}
    </LoginCard>
  );
};

export default function LoginViewer() {
  const [connectedPubkey, setConnectedPubkey] = useState<string | null>(null);

  const handleSuccess = (pubkey: string) => {
    setConnectedPubkey(pubkey);
  };

  const handleDisconnect = () => {
    const account = accounts.active;
    if (account instanceof NostrConnectAccount) {
      account.signer?.close();
    }
    setConnectedPubkey(null);
  };

  if (connectedPubkey) {
    return (
      <div className="h-full w-full flex items-center justify-center p-8">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold">Connected</h1>
            <p className="text-sm text-muted-foreground">
              Successfully logged in to Grimoire
            </p>
          </div>

          <div className="bg-card rounded-lg border border-border p-6">
            <h3 className="font-semibold mb-3">Account</h3>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Public Key</p>
              <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                {connectedPubkey.slice(0, 16)}...{connectedPubkey.slice(-8)}
              </code>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleDisconnect}
          >
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex items-center justify-center p-8">
      <div className="max-w-3xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Login to Grimoire</h1>
          <p className="text-sm text-muted-foreground">
            Choose your authentication method
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Nip07Login onLogin={handleSuccess} />
          <NostrConnectLogin onSuccess={handleSuccess} />
        </div>
      </div>
    </div>
  );
}
