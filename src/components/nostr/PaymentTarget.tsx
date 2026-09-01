import { useEffect, useState } from "react";
import { generateQrWithAvatar } from "@/lib/qr-avatar";
import { Copy, CopyCheck, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useCopy } from "@/hooks/useCopy";
import { cn } from "@/lib/utils";
import {
  buildPaymentUri,
  getPaymentBareAddress,
  getPaymentDisplayAddress,
  getPaymentLabel,
  getPaymentType,
  isWebPaymentTarget,
  UNKNOWN_PAYMENT_ICON,
  type PaytoTarget,
} from "@/lib/payto";

/**
 * A symbol-capable stack, so ₿ / Ӿ / ⓩ / ɱ resolve on Windows, Linux and
 * Android instead of rendering as tofu.
 */
const SYMBOL_FONT_STACK =
  'ui-sans-serif, system-ui, "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols 2", sans-serif';

/**
 * The network's glyph where one exists and reads as text, an icon otherwise.
 * Never rendered without the type label beside it — ◎, ɱ and Ð/Đ are all
 * ambiguous on their own.
 */
export function PaymentTargetSymbol({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const entry = getPaymentType(type);

  // Both branches render into the same 1rem box, so a glyph and an icon sit on
  // the same baseline and every address in a list starts at the same x.
  // `className` comes last so a caller can resize the box and the glyph.
  const box = (...defaults: string[]) =>
    cn(
      "inline-flex size-4 shrink-0 items-center justify-center leading-none",
      ...defaults,
      className,
      entry?.markClassName,
    );

  if (entry?.symbol) {
    return (
      <span
        aria-hidden
        style={{ fontFamily: SYMBOL_FONT_STACK }}
        // ɱ is indistinguishable from a plain "m" at text-xs.
        className={box("text-base")}
      >
        {entry.symbol}
      </span>
    );
  }

  const Icon = entry?.icon ?? UNKNOWN_PAYMENT_ICON;
  return (
    <span aria-hidden className={box()}>
      <Icon className="size-full" />
    </span>
  );
}

/**
 * QR handoff for a payment target. Most desktops have no handler registered
 * for `monero:` and friends, so the QR — not the URI — is what actually gets
 * the address onto a phone.
 */
export function PaymentTargetDialog({
  target,
  open,
  onOpenChange,
  pictureUrl,
  pictureShape,
}: {
  target: PaytoTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recipient's picture, punched into the middle of the QR. */
  pictureUrl?: string;
  /** Their avatar shape emoji, so the cut-out matches the app's avatars. */
  pictureShape?: string;
}) {
  // Keyed by payload, so a stale QR is never shown for a different target and
  // switching targets needs no synchronous reset.
  const [qr, setQr] = useState<{ payload: string; url: string } | null>(null);
  const { copy, copied } = useCopy();

  const uri = target ? buildPaymentUri(target) : undefined;
  const displayAddress = target ? getPaymentDisplayAddress(target) : "";
  // The QR carries what a wallet can act on — the URI when there is one, the
  // bare address otherwise — never the decorated display form.
  const qrPayload = target ? (uri ?? target.address) : null;
  const qrDataUrl = qr?.payload === qrPayload ? qr.url : null;

  useEffect(() => {
    if (!qrPayload) return;

    let cancelled = false;
    generateQrWithAvatar(qrPayload, pictureUrl, pictureShape)
      .then((url) => {
        if (!cancelled) setQr({ payload: qrPayload, url });
      })
      .catch((err) => {
        console.debug("[PaymentTarget] Failed to render QR code:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [qrPayload, pictureUrl, pictureShape]);

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 leading-none">
            <PaymentTargetSymbol
              type={target.type}
              className="size-5 text-xl"
            />
            <span className="leading-none">{getPaymentLabel(target.type)}</span>
          </DialogTitle>
          <DialogDescription>
            Scan or copy this address to pay.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          {/* Always on a white plate — an inverted QR does not scan. */}
          <div className="bg-white p-2 rounded">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`${getPaymentLabel(target.type)} address QR code`}
                className="size-[240px]"
              />
            ) : (
              <div className="size-[240px]" />
            )}
          </div>

          {/* A grid, so a wrapped address keeps a straight left edge instead of
              running back under the copy icon, which is centred on the block. */}
          <button
            onClick={() => copy(displayAddress)}
            title="Copy address"
            className="grid grid-cols-[1rem_1fr] items-center gap-2 w-full text-left hover:bg-muted/50 rounded px-2 py-1 transition-colors"
          >
            {/* Sized just under the column so the icon's ink matches the
                optical weight of the 12px text beside it. */}
            <span className="flex items-center justify-center">
              {copied ? (
                <CopyCheck className="size-3.5 text-green-500" />
              ) : (
                <Copy className="size-3.5 text-muted-foreground" />
              )}
            </span>
            <code className="text-xs font-mono leading-4 break-all">
              {displayAddress}
            </code>
          </button>

          {uri && (
            <Button asChild variant="outline" className="w-full">
              <a href={uri} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
                Open in wallet
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One payment target row, shared by the kind renderers and the profile. */
export function PaymentTargetRow({
  target,
  onClick,
  href,
  truncate = true,
  showLabel = true,
}: {
  target: PaytoTarget;
  onClick?: () => void;
  /** Renders the row as a link instead of a dialog trigger. */
  href?: string;
  truncate?: boolean;
  /** When false, the network is named on hover instead of inline. */
  showLabel?: boolean;
}) {
  const label = getPaymentLabel(target.type);
  // The mark column already carries a BIP-353 name's ₿; repeating it in the
  // text reads as a typo.
  const address = getPaymentBareAddress(target);

  const className =
    "grid grid-cols-[0.875rem_auto_1fr] items-start gap-1 w-full text-left py-1 px-1 -mx-1 rounded hover:bg-muted/30 transition-colors";
  const title = showLabel ? address : `${label} — ${address}`;

  const content = (
    <>
      <PaymentTargetSymbol
        type={target.type}
        className="size-3.5 text-muted-foreground"
      />
      {showLabel ? <Label>{label}</Label> : <span />}
      <code
        className={cn(
          "text-xs font-mono leading-4 min-w-0",
          truncate ? "truncate" : "break-all",
        )}
      >
        {address}
      </code>
    </>
  );

  // A Cash App handle or a Geyser project is a page, not something to hand a
  // wallet — a QR of a profile URL helps nobody, so those rows are just links.
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        className={className}
      >
        {content}
      </a>
    );
  }

  return (
    <button onClick={onClick} title={title} className={className}>
      {content}
    </button>
  );
}

/** A list of targets that owns the dialog state. */
export function PaymentTargetList({
  targets,
  truncate = true,
  showLabels = true,
  pictureUrl,
  pictureShape,
  onLightningClick,
}: {
  targets: PaytoTarget[];
  truncate?: boolean;
  /** When false, each row names its network on hover instead of inline. */
  showLabels?: boolean;
  /** Recipient's picture, punched into the middle of the QR. */
  pictureUrl?: string;
  /** Their avatar shape emoji, so the cut-out matches the app's avatars. */
  pictureShape?: string;
  /** When set, a lightning target uses this instead of the QR dialog. */
  onLightningClick?: (target: PaytoTarget) => void;
}) {
  const [selected, setSelected] = useState<PaytoTarget | null>(null);

  return (
    <div className="flex flex-col gap-1">
      {targets.map((target, index) => (
        <PaymentTargetRow
          key={`${target.type}:${target.address}:${index}`}
          target={target}
          truncate={truncate}
          showLabel={showLabels}
          href={
            isWebPaymentTarget(target) ? buildPaymentUri(target) : undefined
          }
          onClick={() => {
            if (target.type === "lightning" && onLightningClick) {
              onLightningClick(target);
              return;
            }
            setSelected(target);
          }}
        />
      ))}

      <PaymentTargetDialog
        target={selected}
        pictureUrl={pictureUrl}
        pictureShape={pictureShape}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
