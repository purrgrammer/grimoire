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
  isValidZap,
} from "applesauce-core/helpers/zap";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./index";
import { RichText } from "../RichText";

/**
 * Renderer for Kind 9735 - Zap Receipts
 * Displays zap amount, sender, and zapped content
 */
export function Kind9735Renderer({ event }: BaseEventProps) {
  // Validate zap
  const isValid = useMemo(() => isValidZap(event), [event]);

  // Get zap details using applesauce helpers
  const zapSender = useMemo(() => getZapSender(event), [event]);
  const zapAmount = useMemo(() => getZapAmount(event), [event]);
  const zapRequest = useMemo(() => getZapRequest(event), [event]);

  // Get zapped content pointer (e tag or a tag)
  const eventPointer = useMemo(() => getZapEventPointer(event), [event]);
  const addressPointer = useMemo(() => getZapAddressPointer(event), [event]);
  const pointer = eventPointer || addressPointer;

  // Fetch the zapped event
  const zappedEvent = useNostrEvent(pointer || undefined);

  // Get zap comment from request
  const zapComment = useMemo(() => {
    if (!zapRequest) return null;
    return zapRequest.content || null;
  }, [zapRequest]);

  // Format amount (convert from msats to sats)
  const amountInSats = useMemo(() => {
    if (!zapAmount) return 0;
    return Math.floor(zapAmount / 1000);
  }, [zapAmount]);

  // Override event.pubkey to show zap sender instead of receipt pubkey
  const displayEvent = useMemo(
    () => ({
      ...event,
      pubkey: zapSender || event.pubkey,
    }),
    [event, zapSender],
  );

  if (!isValid) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground">Invalid zap receipt</div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={displayEvent}>
      <div className="flex flex-col gap-2">
        {/* Zap indicator */}
        <div className="flex items-center gap-2">
          <Zap className="size-5 fill-yellow-500 text-yellow-500" />
          <span className="text-lg font-light text-yellow-500">
            {amountInSats.toLocaleString("en", {
              notation: "compact",
            })}
          </span>
          <span className="text-xs text-muted-foreground">sats</span>
        </div>

        {/* Zap comment */}
        {zapComment && (
          <div className="text-sm">
            <RichText content={zapComment} />
          </div>
        )}

        {/* Embedded zapped event (if loaded) */}
        {zappedEvent && (
          <div className="border border-muted">
            <EmbeddedEvent event={zappedEvent} />
          </div>
        )}

        {/* Loading state */}
        {pointer && !zappedEvent && (
          <div className="border border-muted p-2 text-xs text-muted-foreground">
            Loading zapped event...
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
