import type { NostrEvent } from "@/types/nostr";
import {
  BaseEventContainer,
  ClickableEventTitle,
  type BaseEventProps,
} from "./BaseEventRenderer";
import { PaymentTargetList } from "../PaymentTarget";
import { getPaytoTargets } from "@/lib/payto";
import { useProfile } from "@/hooks/useProfile";
import { useAddWindow } from "@/core/state";
import { getAvatarShape } from "@/lib/avatar-shape";

/**
 * The list, wired to the event's author: their picture goes in the middle of
 * the QR, and a lightning target opens the zap window the way it does on the
 * profile. The network is named on hover here rather than inline — the glyph
 * plus the address is enough in a feed.
 */
function AuthorPaymentTargets({
  event,
  truncate,
}: {
  event: NostrEvent;
  truncate: boolean;
}) {
  const addWindow = useAddWindow();
  const profile = useProfile(event.pubkey);

  return (
    <PaymentTargetList
      targets={getPaytoTargets(event)}
      truncate={truncate}
      showLabels={false}
      pictureUrl={profile?.picture}
      pictureShape={getAvatarShape(profile)}
      onLightningClick={() =>
        addWindow("zap", { recipientPubkey: event.pubkey })
      }
    />
  );
}

/**
 * Kind 10133 — Payment Targets (NIP-A3).
 *
 * A replaceable list of `["payto", "<type>", "<address>"]` tags. Clicking a
 * target opens a QR handoff; unknown types still render, since the spec's own
 * example carries one.
 */
export function PaymentTargetsRenderer({ event }: BaseEventProps) {
  const targets = getPaytoTargets(event);

  return (
    <BaseEventContainer event={event}>
      {targets.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">
          No payment targets
        </div>
      ) : (
        <AuthorPaymentTargets event={event} truncate />
      )}
    </BaseEventContainer>
  );
}

export function PaymentTargetsDetailRenderer({ event }: { event: NostrEvent }) {
  const targets = getPaytoTargets(event);

  return (
    <div className="flex flex-col gap-3 p-4">
      <ClickableEventTitle event={event} className="text-lg font-semibold">
        Payment Targets
      </ClickableEventTitle>

      {targets.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">
          No payment targets
        </div>
      ) : (
        <AuthorPaymentTargets event={event} truncate={false} />
      )}
    </div>
  );
}
