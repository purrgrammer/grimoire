import { useEventStore, use$ } from "applesauce-react/hooks";
import { useGrimoire } from "@/core/state";
import {
  Wallet,
  Lock,
  Download,
  AlertCircle,
  Coins,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMemo, useState } from "react";
import type { NostrEvent } from "nostr-tools";

export interface WalletViewerProps {
  pubkey: string;
}

/**
 * WalletViewer - NIP-60 Cashu Wallet Display
 * Shows wallet configuration, balance, and transaction history
 *
 * NIP-60 Event Kinds:
 * - kind:17375 - Wallet config (replaceable, encrypted)
 * - kind:7375  - Unspent tokens (multiple allowed, encrypted)
 * - kind:7376  - Transaction history (optional, encrypted)
 */
export function WalletViewer({ pubkey }: WalletViewerProps) {
  const { state } = useGrimoire();
  const eventStore = useEventStore();
  const [unlocked, setUnlocked] = useState(false);

  // Resolve $me alias
  const resolvedPubkey =
    pubkey === "$me" ? state.activeAccount?.pubkey : pubkey;

  // Fetch wallet config event (kind:17375)
  const walletConfigEvent = use$(
    () =>
      resolvedPubkey
        ? eventStore.replaceable(17375, resolvedPubkey)
        : undefined,
    [resolvedPubkey, eventStore],
  );

  // Fetch token events (kind:7375)
  const tokenEvents = use$(
    () =>
      resolvedPubkey
        ? eventStore.timeline([
            {
              kinds: [7375],
              authors: [resolvedPubkey],
            },
          ])
        : undefined,
    [resolvedPubkey, eventStore],
  );

  // Fetch history events (kind:7376)
  const historyEvents = use$(
    () =>
      resolvedPubkey
        ? eventStore.timeline([
            {
              kinds: [7376],
              authors: [resolvedPubkey],
            },
          ])
        : undefined,
    [resolvedPubkey, eventStore],
  );

  const isOwnWallet = resolvedPubkey === state.activeAccount?.pubkey;

  // Check if wallet exists
  const walletExists = walletConfigEvent !== undefined;

  if (!resolvedPubkey) {
    return (
      <div className="p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No active account. Please log in to view your wallet.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!walletExists) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Wallet className="h-5 w-5" />
          <h2 className="text-lg font-semibold">NIP-60 Cashu Wallet</h2>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {isOwnWallet
              ? "No NIP-60 wallet found for your account. You can create a wallet using a compatible Cashu wallet application."
              : "No NIP-60 wallet found for this user."}
          </AlertDescription>
        </Alert>

        {isOwnWallet && (
          <Card>
            <CardHeader>
              <CardTitle>What is NIP-60?</CardTitle>
              <CardDescription>
                NIP-60 is a protocol for storing Cashu ecash wallets on Nostr
                relays
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                <strong>Cashu</strong> is a privacy-preserving ecash system
                backed by Bitcoin via Lightning Network.
              </p>
              <p>
                <strong>NIP-60</strong> stores your wallet data encrypted on
                Nostr relays, making it accessible across applications.
              </p>
              <p className="pt-2">
                To create a wallet, use a NIP-60 compatible application like{" "}
                <a
                  href="https://nostrudel.ninja"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  noStrudel
                </a>{" "}
                or{" "}
                <a
                  href="https://cashu.me"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Cashu.me
                </a>
                .
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          <h2 className="text-lg font-semibold">
            {isOwnWallet ? "Your" : "User"} Cashu Wallet
          </h2>
        </div>

        {!isOwnWallet && (
          <div className="text-sm text-muted-foreground">
            Viewing another user's wallet (encrypted)
          </div>
        )}
      </div>

      {/* Wallet Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Wallet Status
            </CardTitle>
            {isOwnWallet && !unlocked && (
              <Button size="sm" variant="outline" disabled>
                <Download className="h-4 w-4 mr-2" />
                Unlock Wallet
              </Button>
            )}
          </div>
          <CardDescription>
            NIP-60 wallet stored on Nostr relays
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              {isOwnWallet ? (
                <>
                  <strong>Wallet Encrypted:</strong> Your wallet data is
                  encrypted with NIP-44. Decryption functionality will be added
                  in a future update.
                </>
              ) : (
                <>
                  <strong>Privacy Protected:</strong> This wallet's data is
                  encrypted and cannot be viewed without the owner's private
                  key.
                </>
              )}
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Config Event</div>
              <div className="font-mono text-xs">
                {walletConfigEvent ? "✓ Found (kind:17375)" : "✗ Not found"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Token Events</div>
              <div className="font-mono text-xs">
                {tokenEvents && tokenEvents.length > 0
                  ? `✓ ${tokenEvents.length} event(s) (kind:7375)`
                  : "✗ No tokens"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">History Events</div>
              <div className="font-mono text-xs">
                {historyEvents && historyEvents.length > 0
                  ? `✓ ${historyEvents.length} event(s) (kind:7376)`
                  : "○ No history"}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Created</div>
              <div className="font-mono text-xs">
                {walletConfigEvent
                  ? new Date(
                      walletConfigEvent.created_at * 1000,
                    ).toLocaleDateString()
                  : "Unknown"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Balance Card (Encrypted) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-4 w-4" />
            Balance
          </CardTitle>
          <CardDescription>
            Total unspent tokens across all mints
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8 border-2 border-dashed rounded-lg">
            <div className="text-center space-y-2">
              <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Balance encrypted</p>
              <p className="text-xs text-muted-foreground">
                {tokenEvents && tokenEvents.length > 0
                  ? `${tokenEvents.length} token event(s) found`
                  : "No token events"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transaction History (Encrypted) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Transaction History
          </CardTitle>
          <CardDescription>Recent wallet activity</CardDescription>
        </CardHeader>
        <CardContent>
          {historyEvents && historyEvents.length > 0 ? (
            <div className="flex items-center justify-center p-8 border-2 border-dashed rounded-lg">
              <div className="text-center space-y-2">
                <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Transaction history encrypted
                </p>
                <p className="text-xs text-muted-foreground">
                  {historyEvents.length} transaction(s) found
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No transaction history</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Developer Info */}
      {isOwnWallet && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Raw Events (For Developers)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Wallet Config Event (kind:17375)
              </summary>
              <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-x-auto">
                {walletConfigEvent
                  ? JSON.stringify(walletConfigEvent, null, 2)
                  : "Not found"}
              </pre>
            </details>

            {tokenEvents && tokenEvents.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Token Events (kind:7375) - {tokenEvents.length} event(s)
                </summary>
                <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-x-auto">
                  {JSON.stringify(tokenEvents, null, 2)}
                </pre>
              </details>
            )}

            {historyEvents && historyEvents.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  History Events (kind:7376) - {historyEvents.length} event(s)
                </summary>
                <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-x-auto">
                  {JSON.stringify(historyEvents, null, 2)}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* Help Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">About NIP-60 Cashu Wallets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <strong className="text-foreground">What you're seeing:</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>
                kind:17375 - Encrypted wallet configuration (mint URLs, wallet
                private key)
              </li>
              <li>kind:7375 - Encrypted unspent Cashu proofs (ecash tokens)</li>
              <li>kind:7376 - Encrypted transaction history (optional)</li>
            </ul>
          </div>

          <div>
            <strong className="text-foreground">Privacy & Security:</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>All wallet data is encrypted with NIP-44</li>
              <li>Only the owner can decrypt and spend the funds</li>
              <li>Wallet follows you across Nostr applications</li>
            </ul>
          </div>

          <div>
            <strong className="text-foreground">Compatible Apps:</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>
                <a
                  href="https://nostrudel.ninja"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  noStrudel
                </a>{" "}
                - Full-featured Nostr client with NIP-60 wallet
              </li>
              <li>
                <a
                  href="https://cashu.me"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Cashu.me
                </a>{" "}
                - Cashu ecash wallet
              </li>
            </ul>
          </div>

          <div className="pt-2 border-t">
            <p className="text-xs">
              📚 Learn more:{" "}
              <a
                href="https://github.com/nostr-protocol/nips/blob/master/60.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                NIP-60 Specification
              </a>
              {" | "}
              <a
                href="https://cashu.space"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Cashu Protocol
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
