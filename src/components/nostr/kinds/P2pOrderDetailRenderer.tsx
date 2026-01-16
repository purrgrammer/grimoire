import { NostrEvent } from "@/types/nostr";
import { UserName } from "../UserName";
import { Copy } from "lucide-react";
import {
  getOrderType,
  getFiatAmount,
  getSatsAmount,
  getCurrency,
  getPaymentMethods,
  getPlatform,
  getPremium,
  getOrderStatus,
  getSource,
  getBitcoinLayer,
  getBitcoinNetwork,
  getUsername,
  getExpiration,
} from "@/lib/nip69-helpers";
import { toast } from "sonner";

interface P2pOrderDetailRendererProps {
  event: NostrEvent;
}

/**
 * Detail renderer for Kind 38383 - P2P Order
 * Shows order details and links
 */
export function P2pOrderDetailRenderer({ event }: P2pOrderDetailRendererProps) {
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
  const bitcoinNetwork = getBitcoinNetwork(event);
  const username = getUsername(event);
  const expiration = getExpiration(event);

  const handleCopy = (value: string) => {
    navigator.clipboard.writeText(value);
    toast.success(`External link copied to clipboard`);
  };

  const getTradetitle: () => string = () => {
    if (!orderType) return "-";

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

  const getExpirationDate = () => {
    if (!expiration) return "-";

    const date = new Date(expiration * 1000);

    return date.toLocaleString();
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header Section */}
      <div className="flex gap-4">
        {/* Order Title */}
        <div className="flex flex-col g4p-2 flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl font-bold">{getTradetitle()}</h1>
            {orderStatus === "pending" && source && (
              <button
                onClick={() => handleCopy(source)}
                title={`Order profile in ${platform}`}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors flex-shrink-0"
              >
                <Copy className="size-3" />
                {"Link"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        {/* Publisher */}
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground">Profile</h3>
          <UserName pubkey={event.pubkey} />
        </div>

        {/* Host */}
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground">Host</h3>
          <code className="font-mono text-sm truncate" title={platform}>
            {platform ?? "-"}
          </code>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground">Username</h3>
          <code className="font-mono text-sm truncate" title={username}>
            {username ?? "-"}
          </code>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground">Status</h3>
          <code className="font-mono text-sm truncate" title={orderStatus}>
            {orderStatus ?? "-"}
          </code>
        </div>

        {/* Layer */}
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground">Layer</h3>
          <code className="font-mono text-sm truncate" title={bitcoinLayer}>
            {bitcoinLayer ?? "-"}
          </code>
        </div>

        {/* Network */}
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground">Network</h3>
          <code className="font-mono text-sm truncate" title={bitcoinNetwork}>
            {bitcoinNetwork ?? "-"}
          </code>
        </div>
      </div>

      {/* Platforms Section */}
      {paymentMethods && paymentMethods.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Payment Methods</h2>
          <div className="flex flex-wrap gap-2">
            {paymentMethods.map((pm) => (
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-lg">
                <span className="text-sm font-medium">{pm}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expiration */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Expiration Date</h2>
        <div className="flex flex-wrap gap-2">{getExpirationDate()}</div>
      </div>
    </div>
  );
}
