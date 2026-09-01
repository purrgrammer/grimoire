/**
 * The zap composer: amounts, comment, payment, and the QR fallback.
 *
 * Lifted out of `ZapWindow` so both zap surfaces share one UI and one payment
 * pipeline ({@link useZapPayment}):
 *
 * - **Public (NIP-57)** — `ZapWindow`, for profiles and public events. The
 *   provider publishes the receipt.
 * - **Private (CORD.md)** — the same window opened on a sealed channel message
 *   (`ZapWindow`'s `zapTarget`). `privateZap.onSettled` seals the proof into
 *   the channel instead, and no public event exists anywhere.
 *
 * Private mode drops what would leak: no kind-9734, no comment to the provider,
 * and no anonymous toggle (the seal carries the payer's real identity — that is
 * what makes the claim theirs).
 */

import {
  CheckCircle2,
  Copy,
  ExternalLink,
  EyeOff,
  Loader2,
  LogIn,
  Wallet,
  Zap,
} from "lucide-react";
import { PrivateKeySigner } from "applesauce-signers";
import { generateSecretKey } from "nostr-tools";
import { generateQrWithAvatar } from "@/lib/qr-avatar";
import { getAvatarShape } from "@/lib/avatar-shape";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import LoginDialog from "@/components/nostr/LoginDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MentionEditor,
  type MentionEditorHandle,
} from "@/components/editor/MentionEditor";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useLnurlCache } from "@/hooks/useLnurlCache";
import { useProfile } from "@/hooks/useProfile";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import { useWallet } from "@/hooks/useWallet";
import { useZapPayment } from "@/hooks/useZapPayment";
import accountManager from "@/services/accounts";

import type { ZapPayment } from "@/lib/chat/adapters/base-adapter";
import type { AddressPointer, EventPointer } from "@/lib/open-parser";

/** Default preset amounts in sats. */
const DEFAULT_PRESETS = [21, 420, 2100, 42000];

const STORAGE_KEY_CUSTOM_AMOUNTS = "grimoire_zap_custom_amounts";
const STORAGE_KEY_AMOUNT_USAGE = "grimoire_zap_amount_usage";

/** Format amount with k/m suffix for large numbers. */
function formatAmount(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(amount % 1000000 === 0 ? 0 : 1)}m`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}k`;
  }
  return amount.toString();
}

export interface ZapComposerProps {
  /** Who receives the sats. */
  recipientPubkey: string;
  /** Rendered above the amount picker: an event preview, a recipient card, … */
  header?: ReactNode;
  /** Public NIP-57 context for the kind-9734. Ignored in private mode. */
  publicContext?: {
    eventPointer?: EventPointer;
    addressPointer?: AddressPointer;
    customTags?: string[][];
    relays?: string[];
  };
  /**
   * Private mode (CORD.md): seal the settled payment into the protocol that
   * owns the message. Its presence selects the private flow.
   */
  privateZap?: {
    onSettled: (payment: ZapPayment) => Promise<void>;
  };
  /** Called when the user is done — after a paid zap, or on cancel. */
  onDone?: () => void;
}

export function ZapComposer({
  recipientPubkey,
  header,
  publicContext,
  privateZap,
  onDone,
}: ZapComposerProps) {
  const isPrivate = Boolean(privateZap);
  const recipientProfile = useProfile(recipientPubkey);
  const activeAccount = accountManager.active;
  const canSign = !!activeAccount?.signer;

  const { wallet, walletMethods } = useWallet();
  const canPayWithWallet = !!wallet && walletMethods.includes("pay_invoice");

  const { data: lnurlData } = useLnurlCache(recipientProfile?.lud16);

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [paymentTimedOut, setPaymentTimedOut] = useState(false);
  const [zapAnonymously, setZapAnonymously] = useState(false);
  const [pastedPreimage, setPastedPreimage] = useState("");

  const editorRef = useRef<MentionEditorHandle>(null);
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();

  const {
    zap,
    payPending,
    status,
    invoice,
    // A settled payment still missing its proof. Owned by the hook, because the
    // background recovery can seal it minutes after this component gave up.
    awaitingProof,
    recordPreimage,
  } = useZapPayment({
    recipientPubkey,
    lnurlData,
    ...(recipientProfile?.lud16
      ? { lightningAddress: recipientProfile.lud16 }
      : {}),
    ...(publicContext && !isPrivate ? { publicContext } : {}),
    ...(privateZap ? { onSettled: privateZap.onSettled } : {}),
  });
  const isPayingWithWallet = status === "paying";

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
    return unique.sort((a, b) => {
      const usageA = amountUsage[a] || 0;
      const usageB = amountUsage[b] || 0;
      if (usageA !== usageB) return usageB - usageA;
      return a - b;
    });
  }, [customAmounts, amountUsage]);

  const hasLightningAddress = !!(
    recipientProfile?.lud16 || recipientProfile?.lud06
  );

  const amount = selectedAmount || parseInt(customAmount) || 0;

  const trackAmountUsage = (used: number) => {
    const newUsage = { ...amountUsage, [used]: (amountUsage[used] || 0) + 1 };
    setAmountUsage(newUsage);
    localStorage.setItem(STORAGE_KEY_AMOUNT_USAGE, JSON.stringify(newUsage));

    if (!DEFAULT_PRESETS.includes(used) && !customAmounts.includes(used)) {
      const newCustomAmounts = [...customAmounts, used];
      setCustomAmounts(newCustomAmounts);
      localStorage.setItem(
        STORAGE_KEY_CUSTOM_AMOUNTS,
        JSON.stringify(newCustomAmounts),
      );
    }
  };

  /** QR for the invoice, with the recipient's picture in the middle. */
  const generateQrCode = async (invoiceText: string) => {
    try {
      return await generateQrWithAvatar(
        invoiceText,
        recipientProfile?.picture,
        getAvatarShape(recipientProfile),
      );
    } catch (error) {
      console.error("QR code generation error:", error);
      throw new Error("Failed to generate QR code");
    }
  };

  /** Report a settled-but-unproven private payment as the success it is. */
  const reportUnproven = () => {
    setIsPaid(true);
    toast.success(`⚡ Sent ${formatAmount(amount)} sats`, {
      description: isPrivate
        ? "The payment went through, but your wallet hasn't handed over the proof this channel needs. We'll keep asking for a couple of minutes — or paste the preimage below."
        : undefined,
    });
  };

  const handleZap = async (withWallet: boolean) => {
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
      trackAmountUsage(amount);
      const serialized = editorRef.current?.getSerializedContent() ?? {
        text: "",
        emojiTags: [],
        blobAttachments: [],
      };

      const { outcome, bolt11 } = await zap({
        amountSats: amount,
        comment: serialized.text,
        emojiTags: serialized.emojiTags,
        withWallet,
        ...(zapAnonymously && !isPrivate
          ? { anonymousSigner: new PrivateKeySigner(generateSecretKey()) }
          : {}),
      });

      if (outcome === "manual") {
        setQrCodeUrl(await generateQrCode(bolt11));
        setShowQrDialog(true);
      } else if (outcome === "unproven") {
        reportUnproven();
      } else {
        setIsPaid(true);
        toast.success(`⚡ Zapped ${formatAmount(amount)} sats!`);
      }
    } catch (error) {
      console.error("Zap error:", error);
      // The invoice is in hand whenever the failure was the payment rather than
      // the invoice itself: show it, so an external wallet can still pay it.
      if (invoice) {
        try {
          setQrCodeUrl(await generateQrCode(invoice));
        } catch {
          // A missing QR must not swallow the payment error below.
        }
        setShowQrDialog(true);
        setPaymentTimedOut(true);
      }
      toast.error(
        error instanceof Error
          ? error.message === "TIMEOUT"
            ? "Payment timed out. Use the QR code or retry."
            : error.message
          : "Failed to send zap",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetryWallet = async () => {
    if (!invoice || !canPayWithWallet) return;
    setIsProcessing(true);
    setShowQrDialog(false);
    setPaymentTimedOut(false);
    try {
      const { outcome } = await payPending();
      if (outcome === "unproven") reportUnproven();
      else {
        setIsPaid(true);
        toast.success("⚡ Payment successful!");
      }
    } catch (error) {
      setShowQrDialog(true);
      setPaymentTimedOut(true);
      toast.error(
        error instanceof Error && error.message === "TIMEOUT"
          ? "Payment timed out. Please try manually."
          : error instanceof Error
            ? error.message
            : "Failed to retry payment",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePastedPreimage = async () => {
    try {
      await recordPreimage(pastedPreimage);
      setPastedPreimage("");
      // A recorded zap is a finished one: leave the QR behind rather than
      // leaving live pay buttons under a payment that already settled.
      setShowQrDialog(false);
      setIsPaid(true);
      toast.success("⚡ Zap recorded");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not record the zap",
      );
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const openInWallet = (bolt11: string) => {
    window.open(`lightning:${bolt11}`, "_blank");
  };

  /** The paste-the-proof affordance, private mode only. */
  const preimageField = awaitingProof && isPrivate && (
    <div className="space-y-2 border border-dashed rounded-md p-3">
      <Label>Payment preimage</Label>
      <p className="text-xs text-muted-foreground">
        Paste it to record the zap — your wallet shows one per payment.
      </p>
      <div className="flex gap-2">
        <Input
          aria-label="Payment preimage"
          value={pastedPreimage}
          onChange={(e) => setPastedPreimage(e.target.value)}
          placeholder="64 hex characters"
          className="font-mono text-xs"
        />
        <Button
          variant="outline"
          onClick={handlePastedPreimage}
          disabled={!pastedPreimage.trim()}
        >
          Record
        </Button>
      </div>
    </div>
  );

  if (showQrDialog) {
    return (
      <div className="space-y-4">
        <div className="text-center text-sm text-muted-foreground">
          Scan with your Lightning wallet or copy the invoice
        </div>

        {/* Load-bearing, not decoration: an externally paid zap settles but
            cannot be proven, so it never reaches the channel unless its
            preimage is pasted below. */}
        {isPrivate && (
          <div className="text-xs text-muted-foreground text-center">
            Paid elsewhere, it can't be proven — record the preimage below or it
            won't appear in the channel.
          </div>
        )}

        {qrCodeUrl && (
          <div className="flex justify-center p-4 bg-white rounded-lg">
            <img
              src={qrCodeUrl}
              alt="Lightning Invoice QR Code"
              className="w-64 h-64"
            />
          </div>
        )}

        {amount > 0 && (
          <div className="text-center">
            <div className="text-3xl font-bold text-foreground">
              {formatAmount(amount)}
            </div>
            <div className="text-sm text-muted-foreground">sats</div>
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

        <div className="space-y-2">
          {paymentTimedOut && canPayWithWallet && (
            <Button
              onClick={handleRetryWallet}
              disabled={isProcessing}
              className="w-full"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {isPayingWithWallet ? "Paying with wallet..." : "Retrying..."}
                </>
              ) : (
                <>
                  <Wallet className="size-4 mr-2" />
                  Retry with NWC Wallet
                </>
              )}
            </Button>
          )}

          <Button
            variant={paymentTimedOut ? "outline" : "default"}
            className="w-full"
            onClick={() => openInWallet(invoice)}
          >
            <ExternalLink className="size-4 mr-2" />
            Open in External Wallet
          </Button>
        </div>

        {isPrivate && (
          <div className="space-y-2 border border-dashed rounded-md p-3">
            <Label>Payment preimage</Label>
            <div className="flex gap-2">
              <Input
                aria-label="Payment preimage"
                value={pastedPreimage}
                onChange={(e) => setPastedPreimage(e.target.value)}
                placeholder="64 hex characters"
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                onClick={handlePastedPreimage}
                disabled={!pastedPreimage.trim()}
              >
                Record
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {header}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {availableAmounts.map((preset) => (
            <Button
              key={preset}
              size="default"
              variant={selectedAmount === preset ? "default" : "outline"}
              onClick={() => {
                setSelectedAmount(preset);
                setCustomAmount("");
              }}
              className="relative"
              disabled={!hasLightningAddress}
            >
              {formatAmount(preset)}
              {amountUsage[preset] && (
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-yellow-500" />
              )}
            </Button>
          ))}
        </div>

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

        {hasLightningAddress && (
          <MentionEditor
            ref={editorRef}
            placeholder="Say something nice..."
            searchProfiles={searchProfiles}
            searchEmojis={searchEmojis}
            className="w-full"
          />
        )}

        {/* Anonymity is a public-zap affordance only: a private zap's claim IS
            the payer's signature on the seal, so there is nobody to hide from
            except the members who can already see the message. */}
        {hasLightningAddress && !isPrivate && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="zap-anonymously"
              checked={zapAnonymously}
              onCheckedChange={(checked) => setZapAnonymously(checked === true)}
            />
            <label
              htmlFor="zap-anonymously"
              className="text-sm text-muted-foreground cursor-pointer flex items-center gap-1.5"
            >
              <EyeOff className="size-3.5" />
              Zap anonymously
            </label>
          </div>
        )}
      </div>

      {!hasLightningAddress && (
        <div className="text-sm text-muted-foreground text-center py-2 border border-dashed rounded-md">
          This user has not configured a Lightning address
        </div>
      )}

      {preimageField}

      {!canSign && !zapAnonymously ? (
        <Button
          onClick={() => setShowLogin(true)}
          className="w-full"
          size="lg"
          disabled={!hasLightningAddress}
        >
          <LogIn className="size-4 mr-2" />
          Log in to Zap
        </Button>
      ) : (
        <Button
          // Once anything has settled this button only closes. An "unproven"
          // zap is a PAID zap missing its proof: offering to pay again here
          // would fetch a second invoice and take the sats twice. Recording it
          // is the preimage field's job, or the background recovery's.
          onClick={() => (isPaid ? onDone?.() : handleZap(canPayWithWallet))}
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
              {isPayingWithWallet ? "Paying with wallet..." : "Processing..."}
            </>
          ) : isPaid ? (
            <>
              <CheckCircle2 className="size-4 mr-2" />
              Done
            </>
          ) : canPayWithWallet ? (
            <>
              <Wallet className="size-4 mr-2" />
              Pay with Wallet ({amount} sats)
            </>
          ) : zapAnonymously ? (
            <>
              <EyeOff className="size-4 mr-2" />
              Zap Anonymously ({amount} sats)
            </>
          ) : (
            <>
              <Zap className="size-4 mr-2" />
              Pay ({amount} sats)
            </>
          )}
        </Button>
      )}

      <LoginDialog open={showLogin} onOpenChange={setShowLogin} />
    </>
  );
}
