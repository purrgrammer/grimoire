import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  Ban,
  Check,
  ClockAlert,
  Copy,
  Layers,
  Loader,
  Scale,
  Tickets,
} from "lucide-react";
import {
  getBitcoinLayer,
  getCurrency,
  getFiatAmount,
  getOrderStatus,
  getOrderType,
  getPaymentMethods,
  getPlatform,
  getPremium,
  getSatsAmount,
  getSource,
} from "@/lib/nip69-helpers";
import { toast } from "sonner";

/**
 * Renderer for Kind 38383 - P2P Order
 * Clean feed view with order details and links
 */
export function P2pOrderRenderer({ event }: BaseEventProps) {
  const orderType = getOrderType(event);
  const fiatAmount = getFiatAmount(event);
  const satsAmount = getSatsAmount(event);
  const currency = getCurrency(event);
  const paymentMethods = getPaymentMethods(event);
  const platform = getPlatform(event);
  const premium = getPremium(event);
  const orderStatus = getOrderStatus(event);
  const source = getSource(event);
  const bitcoinLayer = getBitcoinLayer(event);

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value);
    toast.success(`External link copied to clipboard`);
  };

  const getTradetitle: () => string = () => {
    let title = `${orderType?.toLocaleUpperCase()} `;

    const fiat = fiatAmount
      ? fiatAmount.length < 2
        ? fiatAmount[0]
        : `${fiatAmount[0]} - ${fiatAmount[1]}`
      : "";

    if (satsAmount) {
      if (fiat) {
        title += `${fiat} ${currency} (${satsAmount} sats)`;
      } else {
        title += `${fiat} sats (Premium ${premium}%)`;
      }
    } else {
      title += `${fiat} ${currency} (Premium ${premium}%)`;
    }

    return title;
  };

  const getStatusTag = () => {
    const className = "size-3";
    const icon = {
      pending: <Tickets className={className} />,
      canceled: <Ban className={className} />,
      "in-progress": <Loader className={className} />,
      success: <Check className={className} />,
      expired: <ClockAlert className={className} />,
    };

    return orderStatus ? (
      <>
        {icon[orderStatus]}
        <span className="text-xs text-muted-foreground">{orderStatus}</span>
      </>
    ) : (
      <></>
    );
  };

  return (
    <BaseEventContainer event={event}>
      {orderType && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <ClickableEventTitle
              event={event}
              className="text-base font-semibold text-foreground"
            >
              {getTradetitle()}
            </ClickableEventTitle>
            <div className="flex items-center gap-2">
              {orderStatus === "pending" && source && (
                <button
                  onClick={() => handleCopy(source)}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-primary border border-primary/20 rounded hover:bg-primary/10 transition-colors flex-shrink-0"
                  title={`Order profile in ${platform}`}
                >
                  <Copy className="size-3" />
                  {"Link"}
                </button>
              )}
            </div>
          </div>

          {orderType && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {paymentMethods?.join(" ")}
            </p>
          )}

          {(platform || bitcoinLayer) && (
            <div className="flex items-center gap-2">
              {platform && (
                <>
                  <Scale className="size-3" />
                  <span className="text-xs text-muted-foreground">
                    {platform}
                  </span>
                </>
              )}
              {bitcoinLayer && (
                <>
                  <Layers className="size-3" />
                  <span className="text-xs text-muted-foreground">
                    {bitcoinLayer}
                  </span>
                </>
              )}
              {getStatusTag()}
            </div>
          )}
        </div>
      )}
    </BaseEventContainer>
  );
}
