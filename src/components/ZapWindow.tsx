/**
 * ZapWindow Component
 *
 * UI for sending Lightning zaps to Nostr users and events (NIP-57)
 *
 * Features:
 * - Send zaps to profiles or events
 * - Preset and custom amounts
 * - Remembers most-used amounts
 * - NWC wallet payment or QR code fallback
 * - Shows feed render of zapped event
 */

import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import {
  Zap,
  Wallet,
  QrCode,
  Copy,
  ExternalLink,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import QRCode from "qrcode";
import { useProfile } from "@/hooks/useProfile";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { useWallet } from "@/hooks/useWallet";
import { getProfileContent } from "applesauce-core/helpers";
import { getDisplayName } from "@/lib/nostr-utils";
import { KindRenderer } from "./nostr/kinds";
import type { EventPointer, AddressPointer } from "@/lib/open-parser";

export interface ZapWindowProps {
  /** Recipient pubkey (who receives the zap) */
  recipientPubkey: string;
  /** Optional event being zapped (adds context) */
  eventPointer?: EventPointer | AddressPointer;
}

// Default preset amounts in sats
const DEFAULT_PRESETS = [21, 100, 500, 1000, 5000, 10000];

// LocalStorage keys
const STORAGE_KEY_CUSTOM_AMOUNTS = "grimoire_zap_custom_amounts";
const STORAGE_KEY_AMOUNT_USAGE = "grimoire_zap_amount_usage";

export function ZapWindow({
  recipientPubkey: initialRecipientPubkey,
  eventPointer,
}: ZapWindowProps) {
  // Load event if we have a pointer and no recipient pubkey (derive from event author)
  const event = use$(() => {
    if (!eventPointer) return undefined;
    if ("id" in eventPointer) {
      return eventStore.event(eventPointer.id);
    }
    // AddressPointer
    return eventStore.replaceable(
      eventPointer.kind,
      eventPointer.pubkey,
      eventPointer.identifier,
    );
  }, [eventPointer]);

  // Resolve recipient: use provided pubkey or derive from event author
  const recipientPubkey = initialRecipientPubkey || event?.pubkey || "";

  const recipientProfile = useProfile(recipientPubkey);

  const { wallet, payInvoice, refreshBalance, getInfo } = useWallet();

  // Fetch wallet info
  const [walletInfo, setWalletInfo] = useState<any>(null);
  useEffect(() => {
    if (wallet) {
      getInfo()
        .then((info) => setWalletInfo(info))
        .catch((error) => console.error("Failed to get wallet info:", error));
    }
  }, [wallet, getInfo]);

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [comment, setComment] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [invoice, setInvoice] = useState<string>("");
  const [showQrDialog, setShowQrDialog] = useState(false);

  // Load custom amounts and usage stats from localStorage
  const [customAmounts, setCustomAmounts] = useState<number[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_CUSTOM_AMOUNTS);
    return stored ? JSON.parse(stored) : [];
  });

  const [amountUsage, setAmountUsage] = useState<Record<string, number>>(() => {
    const stored = localStorage.getItem(STORAGE_KEY_AMOUNT_USAGE);
    return stored ? JSON.parse(stored) : {};
  });

  // Combine preset and custom amounts, sort by usage
  const availableAmounts = useMemo(() => {
    const all = [...DEFAULT_PRESETS, ...customAmounts];
    const unique = Array.from(new Set(all));
    // Sort by usage count (descending), then by amount
    return unique.sort((a, b) => {
      const usageA = amountUsage[a] || 0;
      const usageB = amountUsage[b] || 0;
      if (usageA !== usageB) return usageB - usageA;
      return a - b;
    });
  }, [customAmounts, amountUsage]);

  // Get recipient name for display
  const recipientName = useMemo(() => {
    return recipientProfile
      ? getDisplayName(recipientPubkey, recipientProfile)
      : recipientPubkey.slice(0, 8);
  }, [recipientPubkey, recipientProfile]);

  // Get event author name if zapping an event
  const eventAuthorName = useMemo(() => {
    if (!event) return null;
    const authorProfile = eventStore.getReplaceable(0, event.pubkey);
    if (authorProfile) {
      const content = getProfileContent(authorProfile);
      return getDisplayName(event.pubkey, content);
    }
    return event.pubkey.slice(0, 8);
  }, [event]);

  // Track amount usage
  const trackAmountUsage = (amount: number) => {
    const newUsage = {
      ...amountUsage,
      [amount]: (amountUsage[amount] || 0) + 1,
    };
    setAmountUsage(newUsage);
    localStorage.setItem(STORAGE_KEY_AMOUNT_USAGE, JSON.stringify(newUsage));

    // If it's a custom amount not in our list, add it
    if (!DEFAULT_PRESETS.includes(amount) && !customAmounts.includes(amount)) {
      const newCustomAmounts = [...customAmounts, amount];
      setCustomAmounts(newCustomAmounts);
      localStorage.setItem(
        STORAGE_KEY_CUSTOM_AMOUNTS,
        JSON.stringify(newCustomAmounts),
      );
    }
  };

  // Generate QR code for invoice
  const generateQrCode = async (invoiceText: string) => {
    try {
      const qrDataUrl = await QRCode.toDataURL(invoiceText, {
        width: 300,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });
      return qrDataUrl;
    } catch (error) {
      console.error("QR code generation error:", error);
      throw new Error("Failed to generate QR code");
    }
  };

  // Handle zap payment flow
  const handleZap = async (useWallet: boolean) => {
    const amount = selectedAmount || parseInt(customAmount);
    if (!amount || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (!recipientPubkey) {
      toast.error("No recipient specified");
      return;
    }

    setIsProcessing(true);
    try {
      // Track usage
      trackAmountUsage(amount);

      // Step 1: Get Lightning address from recipient profile
      const lud16 = recipientProfile?.lud16;
      const lud06 = recipientProfile?.lud06;

      if (!lud16 && !lud06) {
        throw new Error(
          "Recipient has no Lightning address configured in their profile",
        );
      }

      // Step 2: Resolve LNURL to get callback URL and nostrPubkey
      toast.info("Resolving Lightning address...");

      let lnurlData;
      if (lud16) {
        const { resolveLightningAddress, validateZapSupport } =
          await import("@/lib/lnurl");
        lnurlData = await resolveLightningAddress(lud16);
        validateZapSupport(lnurlData);
      } else if (lud06) {
        throw new Error(
          "LNURL (lud06) not supported. Recipient should use a Lightning address (lud16) instead.",
        );
      }

      if (!lnurlData) {
        throw new Error("Failed to resolve Lightning address");
      }

      // Validate amount is within acceptable range
      const amountMillisats = amount * 1000;
      if (amountMillisats < lnurlData.minSendable) {
        throw new Error(
          `Amount too small. Minimum: ${Math.ceil(lnurlData.minSendable / 1000)} sats`,
        );
      }
      if (amountMillisats > lnurlData.maxSendable) {
        throw new Error(
          `Amount too large. Maximum: ${Math.floor(lnurlData.maxSendable / 1000)} sats`,
        );
      }

      // Validate comment length if provided
      if (comment && lnurlData.commentAllowed) {
        if (comment.length > lnurlData.commentAllowed) {
          throw new Error(
            `Comment too long. Maximum ${lnurlData.commentAllowed} characters.`,
          );
        }
      }

      // Step 3: Create and sign zap request event (kind 9734)
      toast.info("Creating zap request...");
      const { createZapRequest, serializeZapRequest } =
        await import("@/lib/create-zap-request");

      const zapRequest = await createZapRequest({
        recipientPubkey,
        amountMillisats,
        comment,
        eventPointer,
        lnurl: lud16 || undefined,
      });

      const serializedZapRequest = serializeZapRequest(zapRequest);

      // Step 4: Fetch invoice from LNURL callback
      toast.info("Fetching invoice...");
      const { fetchInvoiceFromCallback } = await import("@/lib/lnurl");

      const invoiceResponse = await fetchInvoiceFromCallback(
        lnurlData.callback,
        amountMillisats,
        serializedZapRequest,
        comment || undefined,
      );

      const invoiceText = invoiceResponse.pr;

      // Step 5: Pay or show QR code
      if (useWallet && wallet && walletInfo?.methods.includes("pay_invoice")) {
        // Pay with NWC wallet
        toast.info("Paying invoice with wallet...");
        await payInvoice(invoiceText);
        await refreshBalance();

        setIsPaid(true);
        toast.success(
          `⚡ Zapped ${amount} sats to ${recipientProfile?.name || recipientName}!`,
        );

        // Show success message from LNURL service if available
        if (invoiceResponse.successAction?.message) {
          toast.info(invoiceResponse.successAction.message);
        }
      } else {
        // Show QR code and invoice
        const qrUrl = await generateQrCode(invoiceText);
        setQrCodeUrl(qrUrl);
        setInvoice(invoiceText);
        setShowQrDialog(true);
        toast.success("Invoice ready! Scan or copy to pay.");
      }
    } catch (error) {
      console.error("Zap error:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to send zap",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Copy to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  // Open in wallet
  const openInWallet = (invoice: string) => {
    window.open(`lightning:${invoice}`, "_blank");
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex-none border-b border-border p-4">
        <div className="flex items-center gap-3">
          <Zap className="size-5 text-yellow-500" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold">
              Zap {eventAuthorName || recipientName}
            </h2>
            {event && (
              <p className="text-sm text-muted-foreground">
                For their{" "}
                {event.kind === 1 ? "note" : `kind ${event.kind} event`}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          {/* Show event preview if zapping an event */}
          {event && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Zapping Event
                </CardTitle>
              </CardHeader>
              <CardContent>
                <KindRenderer event={event} />
              </CardContent>
            </Card>
          )}

          {/* Amount Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Amount (sats)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Preset amounts */}
              <div className="grid grid-cols-3 gap-2">
                {availableAmounts.map((amount) => (
                  <Button
                    key={amount}
                    variant={selectedAmount === amount ? "default" : "outline"}
                    onClick={() => {
                      setSelectedAmount(amount);
                      setCustomAmount("");
                    }}
                    className="relative"
                  >
                    {amount.toLocaleString()}
                    {amountUsage[amount] && (
                      <span className="absolute top-1 right-1 size-1.5 rounded-full bg-yellow-500" />
                    )}
                  </Button>
                ))}
              </div>

              {/* Custom amount */}
              <div className="space-y-2">
                <Label>Custom Amount</Label>
                <Input
                  id="custom-amount"
                  type="number"
                  placeholder="Enter amount in sats"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    setSelectedAmount(null);
                  }}
                  min="1"
                />
              </div>

              {/* Comment */}
              <div className="space-y-2">
                <Label>Comment (optional)</Label>
                <Input
                  id="comment"
                  placeholder="Say something nice..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={200}
                />
              </div>
            </CardContent>
          </Card>

          {/* Payment Methods */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Method</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {wallet && walletInfo?.methods.includes("pay_invoice") ? (
                <Button
                  onClick={() => handleZap(true)}
                  disabled={isProcessing || (!selectedAmount && !customAmount)}
                  className="w-full"
                  size="lg"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : isPaid ? (
                    <>
                      <CheckCircle2 className="size-4 mr-2" />
                      Zap Sent!
                    </>
                  ) : (
                    <>
                      <Wallet className="size-4 mr-2" />
                      Pay with Wallet (
                      {selectedAmount || parseInt(customAmount) || 0} sats)
                    </>
                  )}
                </Button>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-2">
                  Connect a wallet to pay directly
                </div>
              )}

              <Button
                onClick={() => handleZap(false)}
                disabled={isProcessing || (!selectedAmount && !customAmount)}
                variant="outline"
                className="w-full"
                size="lg"
              >
                <QrCode className="size-4 mr-2" />
                Show QR Code / Copy Invoice
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* QR Code Dialog */}
      <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lightning Invoice</DialogTitle>
            <DialogDescription>
              Scan with your Lightning wallet or copy the invoice
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {qrCodeUrl && (
              <div className="flex justify-center p-4 bg-white rounded-lg">
                <img
                  src={qrCodeUrl}
                  alt="Lightning Invoice QR Code"
                  className="w-64 h-64"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Invoice</Label>
              <div className="flex gap-2">
                <Input value={invoice} readOnly className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(invoice)}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => openInWallet(invoice)}
              >
                <ExternalLink className="size-4 mr-2" />
                Open in Wallet
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => copyToClipboard(invoice)}
              >
                <Copy className="size-4 mr-2" />
                Copy Invoice
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
