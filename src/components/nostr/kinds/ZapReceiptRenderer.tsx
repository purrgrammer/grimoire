import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { Zap } from "lucide-react";
import { useMemo } from "react";
import { NostrEvent } from "@/types/nostr";
import {
  getZapAmount,
  getZapRequest,
  getZapEventPointer,
  getZapAddressPointer,
  getZapSender,
  getZapRecipient,
  isValidZap,
} from "applesauce-common/helpers/zap";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./index";
import { RichText } from "../RichText";
import { EventCardSkeleton } from "@/components/ui/skeleton";
import { UserName } from "../UserName";

/**
 * Renderer for Kind 9735 - Zap Receipts
 * Displays zap amount, sender, and zapped content
 */
export function Kind9735Renderer({ event }: BaseEventProps) {
  // Validate zap
  const isValid = useMemo(() => isValidZap(event), [event]);

  // Get zap details using applesauce helpers
  const zapSender = useMemo(() => getZapSender(event), [event]);
  const zapRecipient = useMemo(() => getZapRecipient(event), [event]);
  const zapAmount = useMemo(() => getZapAmount(event), [event]);
  const zapRequest = useMemo(() => getZapRequest(event), [event]);

  // Get zapped content pointers (e tag and/or a tag)
  const eventPointer = useMemo(() => getZapEventPointer(event), [event]);
  const addressPointer = useMemo(() => getZapAddressPointer(event), [event]);

  // Fetch both events separately
  const zappedEvent = useNostrEvent(eventPointer || undefined);
  const zappedAddress = useNostrEvent(addressPointer || undefined);

  // Format amount (convert from msats to sats)
  const amountInSats = useMemo(() => {
    if (!zapAmount) return 0;
    return Math.floor(zapAmount / 1000);
  }, [zapAmount]);

  if (!isValid) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground">Invalid zap receipt</div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer
      event={event}
      authorOverride={
        zapSender ? { pubkey: zapSender, label: "Zapper" } : undefined
      }
    >
      <div className="flex flex-col gap-2">
        {/* Zap indicator */}
        <div className="flex items-center gap-2">
          <Zap className="size-5 fill-zap text-zap" />
          <span className="text-lg font-light text-zap">
            {amountInSats.toLocaleString("en", {
              notation: "compact",
            })}
          </span>
          <span className="text-xs text-muted-foreground">sats</span>
          {zapRecipient && <UserName pubkey={zapRecipient} />}
        </div>

        {/* Zap comment */}
        {zapRequest && zapRequest.content && (
          <div className="text-sm">
            <RichText event={zapRequest} />
          </div>
        )}

        {/* Zapped content with loading states */}
        {addressPointer && !zappedAddress && (
          <div className="border border-muted p-2">
            <EventCardSkeleton variant="compact" showActions={false} />
          </div>
        )}
        {addressPointer && zappedAddress && (
          <div className="border border-muted">
            <EmbeddedEvent event={zappedAddress} />
          </div>
        )}
        {!addressPointer && eventPointer && !zappedEvent && (
          <div className="border border-muted p-2">
            <EventCardSkeleton variant="compact" showActions={false} />
          </div>
        )}
        {!addressPointer && eventPointer && zappedEvent && (
          <div className="border border-muted">
            <EmbeddedEvent event={zappedEvent} />
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Embedded event renderer - uses KindRenderer for recursive rendering
 */
function EmbeddedEvent({ event }: { event: NostrEvent }) {
  return <KindRenderer event={event} />;
}
