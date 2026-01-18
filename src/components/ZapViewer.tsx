import { useState, useEffect, useMemo } from "react";
import { useProfile } from "@/hooks/useProfile";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useWallet } from "@/hooks/useWallet";
import { useGrimoire } from "@/core/state";
import { UserName } from "./nostr/UserName";
import { KindRenderer } from "./nostr/kinds";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Zap, Copy, CopyCheck, Wallet, QrCode, Loader2 } from "lucide-react";
import QRCodeLib from "qrcode";
import { getZapEndpoint } from "@/lib/lnurl-helpers";
import type { EventPointer } from "nostr-tools/nip19";
import { useCopy } from "@/hooks/useCopy";
import { Card } from "./ui/card";
import pool from "@/services/relay-pool";
import eventStore from "@/services/event-store";
import accountManager from "@/services/accounts";

export interface ZapViewerProps {
  pubkey: string;
  eventId?: string;
  address?: {
    kind: number;
    pubkey: string;
    identifier: string;
  };
}

interface ZapPreset {
  amount: number;
  count: number; // How many times this amount has been used
}

const DEFAULT_PRESETS = [21, 100, 500, 1000, 5000, 10000];
const ZAP_HISTORY_KEY = "grimoire:zapAmountHistory";

/**
 * ZapViewer - Interactive Lightning zap interface
 * Supports zapping users, events, and addressable events via NIP-57
 */
export function ZapViewer({ pubkey, eventId, address }: ZapViewerProps) {
  const { state } = useGrimoire();
  const profile = useProfile(pubkey);
  const { wallet, balance, payInvoice } = useWallet();
  const { copy, copied } = useCopy();

  // Fetch the event/address being zapped if provided
  const eventPointer: EventPointer | undefined = eventId
    ? { id: eventId }
    : undefined;
  const addressPointer = address
    ? {
        kind: address.kind,
        pubkey: address.pubkey,
        identifier: address.identifier,
      }
    : undefined;

  const zappedEvent = useNostrEvent(eventPointer);
  const zappedAddress = useNostrEvent(addressPointer);

  // Amount state
  const [amount, setAmount] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  // Payment state
  const [invoice, setInvoice] = useState<string>("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [paymentStatus, setPaymentStatus] = useState<
    "idle" | "pending" | "success" | "failed"
  >("idle");

  // Load amount history
  const [amountHistory, setAmountHistory] = useState<ZapPreset[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(ZAP_HISTORY_KEY);
    if (stored) {
      try {
        setAmountHistory(JSON.parse(stored));
      } catch {
        setAmountHistory([]);
      }
    }
  }, []);

  // Get sorted presets (most frequent first, then defaults)
  const sortedPresets = useMemo(() => {
    const historyAmounts = amountHistory
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((p) => p.amount);

    const combinedSet = new Set([...historyAmounts, ...DEFAULT_PRESETS]);
    return Array.from(combinedSet).slice(0, 8);
  }, [amountHistory]);

  // Save amount to history
  const saveAmountToHistory = (amt: number) => {
    const existing = amountHistory.find((p) => p.amount === amt);
    let updated: ZapPreset[];

    if (existing) {
      updated = amountHistory.map((p) =>
        p.amount === amt ? { ...p, count: p.count + 1 } : p,
      );
    } else {
      updated = [...amountHistory, { amount: amt, count: 1 }];
    }

    setAmountHistory(updated);
    localStorage.setItem(ZAP_HISTORY_KEY, JSON.stringify(updated));
  };

  // Get Lightning address from profile
  const lud16 = useMemo(() => {
    if (!profile) return null;
    return profile.lud16 || profile.lud06 || null;
  }, [profile]);

  // Generate invoice
  const handleGenerateInvoice = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (!lud16) {
      setError("Recipient has no Lightning address configured");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const amountMsats = Number(amount) * 1000;

      // Get active account for signing zap request
      const account = accountManager.active;
      if (!account) {
        throw new Error("No active account. Please login first.");
      }

      // Get zap endpoint from LNURL
      const zapEndpoint = await getZapEndpoint(lud16);
      if (!zapEndpoint) {
        throw new Error("Failed to fetch LNURL endpoint");
      }

      // Create zap request
      const relays = state.activeAccount?.relays?.map((r) => r.url) || [
        "wss://relay.damus.io",
        "wss://nos.lol",
      ];

      const zapRequestTemplate = {
        kind: 9734,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["p", pubkey],
          ["amount", String(amountMsats)],
          ["relays", ...relays],
        ],
        content: message,
      };

      // Add event or address tag if zapping content
      if (eventId) {
        zapRequestTemplate.tags.push(["e", eventId]);
      } else if (address) {
        zapRequestTemplate.tags.push([
          "a",
          `${address.kind}:${address.pubkey}:${address.identifier}`,
        ]);
      }

      // Sign the zap request
      const signedZapRequest =
        await account.signer.signEvent(zapRequestTemplate);

      // Request invoice from LNURL endpoint
      const params = new URLSearchParams({
        amount: String(amountMsats),
        nostr: JSON.stringify(signedZapRequest),
      });

      const response = await fetch(`${zapEndpoint}?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`LNURL request failed: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.status === "ERROR") {
        throw new Error(data.reason || "LNURL error");
      }

      if (!data.pr) {
        throw new Error("No invoice returned from LNURL endpoint");
      }

      setInvoice(data.pr);

      // Generate QR code
      const qrDataUrl = await QRCodeLib.toDataURL(data.pr.toUpperCase(), {
        width: 300,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });
      setQrCodeDataUrl(qrDataUrl);

      // Save amount to history
      saveAmountToHistory(Number(amount));
    } catch (err) {
      console.error("Failed to generate invoice:", err);
      setError(
        err instanceof Error ? err.message : "Failed to generate invoice",
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Pay with NWC
  const handlePayWithWallet = async () => {
    if (!wallet || !invoice) return;

    setIsLoading(true);
    setPaymentStatus("pending");
    setError("");

    try {
      await payInvoice(invoice);
      setPaymentStatus("success");

      // Start monitoring for zap receipt
      monitorForZapReceipt();
    } catch (err) {
      console.error("Payment failed:", err);
      setError(err instanceof Error ? err.message : "Payment failed");
      setPaymentStatus("failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Monitor for zap receipt (kind 9735)
  const monitorForZapReceipt = () => {
    const relays = state.activeAccount?.relays?.map((r) => r.url) || [
      "wss://relay.damus.io",
      "wss://nos.lol",
    ];

    // Subscribe to zap receipts for this user
    const observable = pool.subscription(
      relays,
      [
        {
          kinds: [9735],
          "#p": [pubkey],
          since: Math.floor(Date.now() / 1000) - 60, // Last minute
        },
      ],
      { eventStore },
    );

    const sub = observable.subscribe({
      next: (event) => {
        console.log("[ZapViewer] Zap receipt received:", event);
      },
      error: (err) => {
        console.error("[ZapViewer] Subscription error:", err);
      },
    });

    // Clean up after 30 seconds
    setTimeout(() => {
      sub.unsubscribe();
    }, 30000);
  };

  // Reset to create new zap
  const handleReset = () => {
    setInvoice("");
    setQrCodeDataUrl("");
    setPaymentStatus("idle");
    setError("");
  };

  // Format balance
  const balanceInSats = balance ? Math.floor(balance / 1000) : 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      {/* Recipient header */}
      <div className="flex items-center gap-3">
        <Zap className="size-6 text-zap" />
        <h2 className="text-2xl font-light">
          Zap <UserName pubkey={pubkey} />
        </h2>
      </div>

      {/* Zapped content preview */}
      {(zappedEvent || zappedAddress) && (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Zapping
          </div>
          {zappedAddress && <KindRenderer event={zappedAddress} />}
          {!zappedAddress && zappedEvent && (
            <KindRenderer event={zappedEvent} />
          )}
        </Card>
      )}

      {/* Error display */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Success display */}
      {paymentStatus === "success" && (
        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
          Payment sent! Waiting for zap receipt...
        </div>
      )}

      {/* Invoice not generated yet - show amount selection */}
      {!invoice && (
        <>
          {/* Amount presets */}
          <div>
            <label className="mb-2 block text-sm font-medium">
              Quick amounts (sats)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {sortedPresets.map((preset) => (
                <Button
                  key={preset}
                  variant="outline"
                  size="sm"
                  onClick={() => setAmount(String(preset))}
                  className={amount === String(preset) ? "border-primary" : ""}
                >
                  {preset.toLocaleString()}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom amount input */}
          <div>
            <label htmlFor="amount" className="mb-2 block text-sm font-medium">
              Amount (sats)
            </label>
            <Input
              id="amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter custom amount..."
              className="font-mono"
            />
          </div>

          {/* Message input */}
          <div>
            <label htmlFor="message" className="mb-2 block text-sm font-medium">
              Message (optional)
            </label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a comment to your zap..."
              rows={3}
            />
          </div>

          {/* Generate invoice button */}
          <Button
            onClick={handleGenerateInvoice}
            disabled={!amount || isLoading || !lud16}
            className="w-full"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Generating invoice...
              </>
            ) : (
              <>
                <Zap className="mr-2 size-4" />
                Create Zap
              </>
            )}
          </Button>

          {!lud16 && (
            <p className="text-sm text-muted-foreground">
              This user has not configured a Lightning address (lud16) in their
              profile.
            </p>
          )}
        </>
      )}

      {/* Invoice generated - show payment options */}
      {invoice && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">
              {Number(amount).toLocaleString()} sats
            </h3>
            <Button variant="outline" size="sm" onClick={handleReset}>
              New Zap
            </Button>
          </div>

          {/* Wallet payment option */}
          {wallet && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Wallet className="size-5" />
                  <span className="font-medium">Nostr Wallet Connect</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {balanceInSats.toLocaleString()} sats
                </div>
              </div>
              <Button
                onClick={handlePayWithWallet}
                disabled={
                  isLoading ||
                  paymentStatus === "pending" ||
                  !wallet ||
                  !invoice
                }
                className="w-full"
                variant="default"
              >
                {isLoading || paymentStatus === "pending" ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Paying...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 size-4" />
                    Pay with Wallet
                  </>
                )}
              </Button>
            </Card>
          )}

          {/* QR code payment option */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <QrCode className="size-5" />
              <span className="font-medium">Scan with wallet</span>
            </div>

            {qrCodeDataUrl && (
              <div className="flex flex-col items-center gap-3">
                <img
                  src={qrCodeDataUrl}
                  alt="Lightning Invoice QR Code"
                  className="rounded-md border"
                />

                <div className="w-full space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copy(invoice)}
                    className="w-full"
                  >
                    {copied ? (
                      <>
                        <CopyCheck className="mr-2 size-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 size-4" />
                        Copy Invoice
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(`lightning:${invoice}`, "_blank")
                    }
                    className="w-full"
                  >
                    Open in Wallet
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
