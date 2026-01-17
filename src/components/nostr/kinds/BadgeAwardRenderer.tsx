import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { getAwardBadgeAddress, getAwardedPubkeys } from "@/lib/nip58-helpers";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { AddressPointer } from "nostr-tools/nip19";
import {
  getBadgeName,
  getBadgeIdentifier,
  getBadgeImageUrl,
} from "@/lib/nip58-helpers";
import { Award } from "lucide-react";

/**
 * Parse an address pointer from an a tag value
 * Format: "kind:pubkey:identifier"
 */
function parseAddress(aTagValue: string): AddressPointer | null {
  const parts = aTagValue.split(":");
  if (parts.length !== 3) return null;

  const kind = parseInt(parts[0], 10);
  const pubkey = parts[1];
  const identifier = parts[2];

  if (isNaN(kind) || !pubkey || identifier === undefined) return null;

  return { kind, pubkey, identifier };
}

/**
 * Renderer for Kind 8 - Badge Award (NIP-58)
 * Shows badge thumbnail, name, and number of recipients
 */
export function BadgeAwardRenderer({ event }: BaseEventProps) {
  const badgeAddress = getAwardBadgeAddress(event);
  const awardedPubkeys = getAwardedPubkeys(event);

  // Parse the badge address (30009:pubkey:identifier)
  const coordinate = badgeAddress ? parseAddress(badgeAddress) : null;

  // Fetch the badge event
  const badgeEvent = use$(
    () =>
      coordinate
        ? eventStore.replaceable(
            coordinate.kind,
            coordinate.pubkey,
            coordinate.identifier,
          )
        : undefined,
    [coordinate?.kind, coordinate?.pubkey, coordinate?.identifier],
  );

  // Get badge metadata
  const badgeName = badgeEvent ? getBadgeName(badgeEvent) : null;
  const badgeIdentifier = badgeEvent ? getBadgeIdentifier(badgeEvent) : null;
  const badgeImageUrl = badgeEvent ? getBadgeImageUrl(badgeEvent) : null;

  const displayTitle = badgeName || badgeIdentifier || "Badge";
  const recipientCount = awardedPubkeys.length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex gap-3 items-start">
        {/* Badge Thumbnail */}
        {badgeImageUrl ? (
          <img
            src={badgeImageUrl}
            alt={displayTitle}
            className="size-12 rounded-lg object-cover flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="size-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Award className="size-6 text-muted-foreground" />
          </div>
        )}

        {/* Badge Info */}
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          {badgeEvent ? (
            <ClickableEventTitle
              event={badgeEvent}
              className="text-sm font-semibold text-foreground"
            >
              {displayTitle}
            </ClickableEventTitle>
          ) : (
            <span className="text-sm font-semibold text-foreground">
              {displayTitle}
            </span>
          )}

          <p className="text-xs text-muted-foreground">
            Awarded to {recipientCount}{" "}
            {recipientCount === 1 ? "person" : "people"}
          </p>
        </div>
      </div>
    </BaseEventContainer>
  );
}
