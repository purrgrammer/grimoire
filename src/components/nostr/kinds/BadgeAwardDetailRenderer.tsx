import { NostrEvent } from "@/types/nostr";
import { getAwardBadgeAddress, getAwardedPubkeys } from "@/lib/nip58-helpers";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { AddressPointer } from "nostr-tools/nip19";
import {
  getBadgeName,
  getBadgeIdentifier,
  getBadgeImageUrl,
} from "@/lib/nip58-helpers";
import { UserName } from "../UserName";
import { Award } from "lucide-react";
import { ClickableEventTitle } from "./BaseEventRenderer";

interface BadgeAwardDetailRendererProps {
  event: NostrEvent;
}

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
 * Detail renderer for Kind 8 - Badge Award (NIP-58)
 * Shows badge information and list of recipients
 */
export function BadgeAwardDetailRenderer({
  event,
}: BadgeAwardDetailRendererProps) {
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

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Badge Header */}
      <div className="flex gap-4 items-start">
        {/* Badge Image */}
        {badgeImageUrl ? (
          <img
            src={badgeImageUrl}
            alt={displayTitle}
            className="size-24 rounded-lg object-cover flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="size-24 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Award className="size-12 text-muted-foreground" />
          </div>
        )}

        {/* Badge Title */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          {badgeEvent ? (
            <ClickableEventTitle
              event={badgeEvent}
              className="text-2xl font-bold text-foreground"
            >
              {displayTitle}
            </ClickableEventTitle>
          ) : (
            <h1 className="text-2xl font-bold">{displayTitle}</h1>
          )}
          <p className="text-sm text-muted-foreground">Badge Award</p>
        </div>
      </div>

      {/* Metadata */}
      <div className="flex flex-col gap-1">
        <h3 className="text-sm text-muted-foreground">Issued By</h3>
        <UserName pubkey={event.pubkey} />
      </div>

      {/* Recipients List */}
      {awardedPubkeys.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">
            Awarded to {awardedPubkeys.length}{" "}
            {awardedPubkeys.length === 1 ? "Person" : "People"}
          </h2>
          <div className="flex flex-col gap-2">
            {awardedPubkeys.map((pubkey) => (
              <div
                key={pubkey}
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <Award className="size-4 text-muted-foreground flex-shrink-0" />
                <UserName pubkey={pubkey} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Award Comment */}
      {event.content && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm text-muted-foreground">Comment</h3>
          <p className="text-sm">{event.content}</p>
        </div>
      )}
    </div>
  );
}
