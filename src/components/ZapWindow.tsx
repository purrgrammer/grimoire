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
import { getDisplayName } from "@/lib/nostr-utils";
import { KindRenderer } from "./nostr/kinds";
import type { EventPointer, AddressPointer } from "@/lib/open-parser";
import { useGrimoire } from "@/core/state";
import accountManager from "@/services/accounts";
import {
  MentionEditor,
  type MentionEditorHandle,
} from "./editor/MentionEditor";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useProfileSearch } from "@/hooks/useProfileSearch";

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

  const { addWindow } = useGrimoire();
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

  // Editor ref and search functions
  const editorRef = useRef<MentionEditorHandle>(null);
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis, service: emojiService } = useEmojiSearch();

  // Debug emoji search on mount
  useEffect(() => {
    console.log("[Zap] Emoji search service initialized:", emojiService);
    searchEmojis("fire").then((results) => {
      console.log("[Zap] Test emoji search for 'fire':", results);
    });
  }, [searchEmojis, emojiService]);

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

      console.log("[Zap] Recipient profile:", {
        pubkey: recipientPubkey,
        lud16,
        lud06,
        profile: recipientProfile,
      });

      if (!lud16 && !lud06) {
        throw new Error(
          "Recipient has no Lightning address configured in their profile",
        );
      }

      // Step 2: Resolve LNURL to get callback URL and nostrPubkey
      toast.info("Resolving Lightning address...");

      let lnurlData;
      if (lud16) {
        console.log("[Zap] Resolving Lightning address:", lud16);
        const { resolveLightningAddress, validateZapSupport } =
          await import("@/lib/lnurl");
        lnurlData = await resolveLightningAddress(lud16);
        console.log("[Zap] LNURL data:", lnurlData);
        validateZapSupport(lnurlData);
        console.log("[Zap] Zap support validated");
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
      toast.info("Creating zap request...");
      const { createZapRequest, serializeZapRequest } =
        await import("@/lib/create-zap-request");

      const zapRequest = await createZapRequest({
        recipientPubkey,
        amountMillisats,
        comment,
        eventPointer,
        lnurl: lud16 || undefined,
        emojiTags,
      });
      console.log("[Zap] Zap request created:", zapRequest);

      const serializedZapRequest = serializeZapRequest(zapRequest);
      console.log(
        "[Zap] Serialized zap request length:",
        serializedZapRequest.length,
      );

      // Step 4: Fetch invoice from LNURL callback
      toast.info("Fetching invoice...");
      const { fetchInvoiceFromCallback } = await import("@/lib/lnurl");

      console.log("[Zap] Fetching invoice from callback:", lnurlData.callback);
      const invoiceResponse = await fetchInvoiceFromCallback(
        lnurlData.callback,
        amountMillisats,
        serializedZapRequest,
        comment || undefined,
      );
      console.log("[Zap] Invoice response:", invoiceResponse);

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

  // Open account selector for login
  const handleLogin = () => {
    addWindow("conn", {});
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-3">
          {/* Show event preview if zapping an event */}
          {event && <KindRenderer event={event} />}

          {/* Amount Selection */}
          <div className="space-y-2">
            {/* Preset amounts - single row */}
            <div className="flex flex-wrap gap-1.5">
              {availableAmounts.map((amount) => (
                <Button
                  key={amount}
                  size="sm"
                  variant={selectedAmount === amount ? "default" : "outline"}
                  onClick={() => {
                    setSelectedAmount(amount);
                    setCustomAmount("");
                  }}
                  className="relative"
                >
                  {formatAmount(amount)}
                  {amountUsage[amount] && (
                    <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-yellow-500" />
                  )}
                </Button>
              ))}
              {/* Custom amount inline */}
              <Input
                type="number"
                placeholder="Custom"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setSelectedAmount(null);
                }}
                min="1"
                className="w-24 h-9"
              />
            </div>

            {/* Comment with emoji support - single row */}
            <MentionEditor
              ref={editorRef}
              placeholder="Say something nice..."
              searchProfiles={searchProfiles}
              searchEmojis={searchEmojis}
              className="rounded-md border border-input bg-background px-3 py-2"
            />
          </div>

          {/* Payment Button */}
          {!canSign ? (
            <Button
              onClick={handleLogin}
              className="w-full"
              size="lg"
              variant="default"
            >
              <LogIn className="size-4 mr-2" />
              Log in to Zap
            </Button>
          ) : (
            <Button
              onClick={() =>
                handleZap(wallet && walletInfo?.methods.includes("pay_invoice"))
              }
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
