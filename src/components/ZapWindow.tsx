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

import { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Zap,
  Wallet,
  Copy,
  ExternalLink,
  Loader2,
  CheckCircle2,
  LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import QRCode from "qrcode";
import { useProfile } from "@/hooks/useProfile";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { useWallet } from "@/hooks/useWallet";
import { getDisplayName } from "@/lib/nostr-utils";
import { KindRenderer } from "./nostr/kinds";
import { UserName } from "./nostr/UserName";
import type { EventPointer, AddressPointer } from "@/lib/open-parser";
import accountManager from "@/services/accounts";
import {
  MentionEditor,
  type MentionEditorHandle,
} from "./editor/MentionEditor";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import LoginDialog from "./nostr/LoginDialog";
import { resolveLightningAddress, validateZapSupport } from "@/lib/lnurl";
import {
  createZapRequest,
  serializeZapRequest,
} from "@/lib/create-zap-request";
import { fetchInvoiceFromCallback } from "@/lib/lnurl";

export interface ZapWindowProps {
  /** Recipient pubkey (who receives the zap) */
  recipientPubkey: string;
  /** Optional event being zapped (adds context) */
  eventPointer?: EventPointer | AddressPointer;
  /** Callback to close the window */
  onClose?: () => void;
}

// Default preset amounts in sats
const DEFAULT_PRESETS = [21, 420, 2100, 42000];

// LocalStorage keys
const STORAGE_KEY_CUSTOM_AMOUNTS = "grimoire_zap_custom_amounts";
const STORAGE_KEY_AMOUNT_USAGE = "grimoire_zap_amount_usage";

/**
 * Format amount with k/m suffix for large numbers
 */
function formatAmount(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(amount % 1000000 === 0 ? 0 : 1)}m`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}k`;
  }
  return amount.toString();
}

export function ZapWindow({
  recipientPubkey: initialRecipientPubkey,
  eventPointer,
  onClose,
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

  const activeAccount = accountManager.active;
  const canSign = !!activeAccount?.signer;

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [invoice, setInvoice] = useState<string>("");
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [paymentTimedOut, setPaymentTimedOut] = useState(false);

  // Editor ref and search functions
  const editorRef = useRef<MentionEditorHandle>(null);
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();

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

  // Check if recipient has a lightning address
  const hasLightningAddress = !!(
    recipientProfile?.lud16 || recipientProfile?.lud06
  );

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

  // Generate QR code for invoice with optional profile picture overlay
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

      // If profile has picture, overlay it in the center
      const profilePicUrl = recipientProfile?.picture;
      if (!profilePicUrl) {
        return qrDataUrl;
      }

      // Create canvas to overlay profile picture
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return qrDataUrl;

      // Load QR code image
      const qrImage = new Image();
      await new Promise((resolve, reject) => {
        qrImage.onload = resolve;
        qrImage.onerror = reject;
        qrImage.src = qrDataUrl;
      });

      canvas.width = qrImage.width;
      canvas.height = qrImage.height;

      // Draw QR code
      ctx.drawImage(qrImage, 0, 0);

      // Load and draw profile picture
      const profileImage = new Image();
      profileImage.crossOrigin = "anonymous";

      await new Promise((resolve) => {
        profileImage.onload = resolve;
        profileImage.onerror = () => resolve(null); // Silently fail if image doesn't load
        profileImage.src = profilePicUrl;
      });

      // Only overlay if image loaded successfully
      if (profileImage.complete && profileImage.naturalHeight !== 0) {
        const size = canvas.width * 0.25; // 25% of QR code size
        const x = (canvas.width - size) / 2;
        const y = (canvas.height - size) / 2;

        // Draw white background circle
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(
          canvas.width / 2,
          canvas.height / 2,
          size / 2 + 4,
          0,
          2 * Math.PI,
        );
        ctx.fill();

        // Clip to circle for profile picture
        ctx.save();
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2, size / 2, 0, 2 * Math.PI);
        ctx.clip();
        ctx.drawImage(profileImage, x, y, size, size);
        ctx.restore();
      }

      return canvas.toDataURL();
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
      let lnurlData;
      if (lud16) {
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

      // Get comment and emoji tags from editor
      const serialized = editorRef.current?.getSerializedContent() || {
        text: "",
        emojiTags: [],
        blobAttachments: [],
      };
      const comment = serialized.text;
      const emojiTags = serialized.emojiTags;

      // Validate comment length if provided
      if (comment && lnurlData.commentAllowed) {
        if (comment.length > lnurlData.commentAllowed) {
          throw new Error(
            `Comment too long. Maximum ${lnurlData.commentAllowed} characters.`,
          );
        }
      }

      // Step 3: Create and sign zap request event (kind 9734)
      const zapRequest = await createZapRequest({
        recipientPubkey,
        amountMillisats,
        comment,
        eventPointer,
        lnurl: lud16 || undefined,
        emojiTags,
      });

      const serializedZapRequest = serializeZapRequest(zapRequest);

      // Step 4: Fetch invoice from LNURL callback
      const invoiceResponse = await fetchInvoiceFromCallback(
        lnurlData.callback,
        amountMillisats,
        serializedZapRequest,
        comment || undefined,
      );

      const invoiceText = invoiceResponse.pr;

      // Step 5: Pay or show QR code
      if (useWallet && wallet && walletInfo?.methods.includes("pay_invoice")) {
        // Pay with NWC wallet with timeout
        try {
          // Race between payment and 30 second timeout
          const paymentPromise = payInvoice(invoiceText);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("TIMEOUT")), 30000),
          );

          await Promise.race([paymentPromise, timeoutPromise]);
          await refreshBalance();

          setIsPaid(true);
          toast.success(`⚡ Zapped ${amount} sats to ${recipientName}!`);
        } catch (error) {
          if (error instanceof Error && error.message === "TIMEOUT") {
            // Payment timed out - show QR code with retry option
            setPaymentTimedOut(true);
            const qrUrl = await generateQrCode(invoiceText);
            setQrCodeUrl(qrUrl);
            setInvoice(invoiceText);
            setShowQrDialog(true);
          } else {
            // Other payment error - re-throw
            throw error;
          }
        }
      } else {
        // Show QR code and invoice
        const qrUrl = await generateQrCode(invoiceText);
        setQrCodeUrl(qrUrl);
        setInvoice(invoiceText);
        setShowQrDialog(true);
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

  // Open login dialog
  const handleLogin = () => {
    setShowLogin(true);
  };

  // Retry wallet payment
  const handleRetryWallet = async () => {
    if (!invoice || !wallet) return;

    setIsProcessing(true);
    setShowQrDialog(false);
    setPaymentTimedOut(false);

    try {
      // Try again with timeout
      const paymentPromise = payInvoice(invoice);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), 30000),
      );

      await Promise.race([paymentPromise, timeoutPromise]);
      await refreshBalance();

      setIsPaid(true);
      setShowQrDialog(false);
      toast.success("⚡ Payment successful!");
    } catch (error) {
      if (error instanceof Error && error.message === "TIMEOUT") {
        toast.error("Payment timed out. Please try manually.");
        setPaymentTimedOut(true);
        setShowQrDialog(true);
      } else {
        toast.error(
          error instanceof Error ? error.message : "Failed to retry payment",
        );
        setShowQrDialog(true);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-3">
          {/* Show QR Code View if invoice exists */}
          {showQrDialog ? (
            <div className="space-y-4">
              {/* Header */}
              <div className="text-center space-y-2">
                <div className="text-2xl font-semibold">
                  Zap <UserName pubkey={recipientPubkey} />
                </div>
                <div className="text-sm text-muted-foreground">
                  Scan with your Lightning wallet or copy the invoice
                </div>
              </div>

              {/* QR Code */}
              {qrCodeUrl && (
                <div className="flex justify-center p-4 bg-white rounded-lg">
                  <img
                    src={qrCodeUrl}
                    alt="Lightning Invoice QR Code"
                    className="w-64 h-64"
                  />
                </div>
              )}

              {/* Invoice */}
              <div className="space-y-2">
                <Label>Invoice</Label>
                <div className="flex gap-2">
                  <Input
                    value={invoice}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(invoice)}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>

              {/* Actions */}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => openInWallet(invoice)}
              >
                <ExternalLink className="size-4 mr-2" />
                Open in Wallet
              </Button>

              {/* Retry with wallet button if payment timed out */}
              {paymentTimedOut &&
                wallet &&
                walletInfo?.methods.includes("pay_invoice") && (
                  <Button
                    onClick={handleRetryWallet}
                    disabled={isProcessing}
                    className="w-full"
                    variant="default"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        Retrying...
                      </>
                    ) : (
                      <>
                        <Wallet className="size-4 mr-2" />
                        Retry with Wallet
                      </>
                    )}
                  </Button>
                )}
            </div>
          ) : (
            <>
              {/* Show event preview if zapping an event */}
              {event && <KindRenderer event={event} />}

              {/* Show recipient info if not zapping an event */}
              {!event && (
                <div className="text-center space-y-2 py-4">
                  <div className="text-2xl font-semibold">
                    <UserName pubkey={recipientPubkey} />
                  </div>
                  {recipientProfile?.lud16 && (
                    <div className="text-sm text-muted-foreground font-mono">
                      {recipientProfile.lud16}
                    </div>
                  )}
                </div>
              )}

              {/* Amount Selection */}
              <div className="space-y-2">
                {/* Preset amounts - single row */}
                <div className="flex flex-wrap gap-2">
                  {availableAmounts.map((amount) => (
                    <Button
                      key={amount}
                      size="default"
                      variant={
                        selectedAmount === amount ? "default" : "outline"
                      }
                      onClick={() => {
                        setSelectedAmount(amount);
                        setCustomAmount("");
                      }}
                      className="relative"
                      disabled={!hasLightningAddress}
                    >
                      {formatAmount(amount)}
                      {amountUsage[amount] && (
                        <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-yellow-500" />
                      )}
                    </Button>
                  ))}
                </div>

                {/* Custom amount - separate line */}
                <Input
                  type="number"
                  placeholder="Custom amount (sats)"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    setSelectedAmount(null);
                  }}
                  min="1"
                  disabled={!hasLightningAddress}
                  className="w-full"
                />

                {/* Comment with emoji support */}
                {hasLightningAddress && (
                  <MentionEditor
                    ref={editorRef}
                    placeholder="Say something nice..."
                    searchProfiles={searchProfiles}
                    searchEmojis={searchEmojis}
                    className="rounded-md border border-input bg-background px-3 py-2"
                  />
                )}
              </div>

              {/* No Lightning Address Warning */}
              {!hasLightningAddress && (
                <div className="text-sm text-muted-foreground text-center py-2 border border-dashed rounded-md">
                  This user has not configured a Lightning address
                </div>
              )}

              {/* Payment Button */}
              {!canSign ? (
                <Button
                  onClick={handleLogin}
                  className="w-full"
                  size="lg"
                  variant="default"
                  disabled={!hasLightningAddress}
                >
                  <LogIn className="size-4 mr-2" />
                  Log in to Zap
                </Button>
              ) : (
                <Button
                  onClick={() =>
                    isPaid
                      ? onClose?.()
                      : handleZap(
                          wallet && walletInfo?.methods.includes("pay_invoice"),
                        )
                  }
                  disabled={
                    !hasLightningAddress ||
                    isProcessing ||
                    (!isPaid && !selectedAmount && !customAmount)
                  }
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
                      Done
                    </>
                  ) : wallet && walletInfo?.methods.includes("pay_invoice") ? (
                    <>
                      <Wallet className="size-4 mr-2" />
                      Pay with Wallet (
                      {selectedAmount || parseInt(customAmount) || 0} sats)
                    </>
                  ) : (
                    <>
                      <Zap className="size-4 mr-2" />
                      Pay ({selectedAmount || parseInt(customAmount) || 0} sats)
                    </>
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Login Dialog */}
      <LoginDialog open={showLogin} onOpenChange={setShowLogin} />
    </div>
  );
}
