import type { NostrEvent } from "@/types/nostr";
import { Zap } from "lucide-react";
import { useMemo } from "react";
import {
  getZapAmount,
  getZapEventPointer,
  getZapAddressPointer,
  getZapRequest,
  getZapRecipient,
} from "applesauce-common/helpers/zap";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { RichText } from "../RichText";

/**
 * Compact preview for Kind 9735 (Zap Receipt)
 * Layout: [amount] [recipient] [zap message] [preview]
 */
export function ZapCompactPreview({ event }: { event: NostrEvent }) {
  const zapAmount = useMemo(() => getZapAmount(event), [event]);
  const zapRequest = useMemo(() => getZapRequest(event), [event]);
  const zapRecipient = useMemo(() => getZapRecipient(event), [event]);

  // Get zap comment from request
  const zapMessage = useMemo(() => {
    if (!zapRequest) return null;
    return zapRequest.content || null;
  }, [zapRequest]);

  // Get zapped content pointers
  const eventPointer = useMemo(() => getZapEventPointer(event), [event]);
  const addressPointer = useMemo(() => getZapAddressPointer(event), [event]);

  // Fetch the zapped event (prefer address pointer for replaceable events)
  const zappedByEvent = useNostrEvent(eventPointer || undefined);
  const zappedByAddress = useNostrEvent(addressPointer || undefined);
  const zappedEvent = zappedByAddress || zappedByEvent;

  // Convert from msats to sats
  const amountInSats = useMemo(() => {
    if (!zapAmount) return 0;
    return Math.floor(zapAmount / 1000);
  }, [zapAmount]);

  return (
    <span className="flex items-center gap-1 text-sm truncate">
      <Zap className="size-3 fill-yellow-500 text-yellow-500 shrink-0" />
      <span className="text-yellow-500 font-medium shrink-0">
        {amountInSats.toLocaleString("en", { notation: "compact" })}
      </span>
      {zapRecipient && <UserName pubkey={zapRecipient} />}
      {zapMessage && (
        <span className="truncate line-clamp-1 flex-shrink-0">
          <RichText
            content={zapMessage}
            className="inline text-sm leading-none"
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        </span>
      )}
      {zappedEvent && (
        <span className="text-muted-foreground truncate line-clamp-1">
          <RichText
            event={zappedEvent}
            className="inline text-sm leading-none"
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        </span>
      )}
    </span>
  );
}
