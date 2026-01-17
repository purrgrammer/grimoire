import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getBadgeIdentifier,
  getBadgeName,
  getBadgeDescription,
  getBadgeImageUrl,
} from "@/lib/nip58-helpers";
import { Award } from "lucide-react";

/**
 * Renderer for Kind 30009 - Badge (NIP-58)
 * Feed view with image, name and description
 */
export function BadgeDefinitionRenderer({ event }: BaseEventProps) {
  const identifier = getBadgeIdentifier(event);
  const name = getBadgeName(event);
  const description = getBadgeDescription(event);
  const imageUrl = getBadgeImageUrl(event);

  // Use name if available, fallback to identifier
  const displayTitle = name || identifier || "Badge";

  return (
    <BaseEventContainer event={event}>
      <div className="flex gap-3">
        {/* Badge Image */}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={displayTitle}
            className="size-16 rounded-lg object-cover flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="size-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Award className="size-8 text-muted-foreground" />
          </div>
        )}

        {/* Badge Info */}
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <ClickableEventTitle
            event={event}
            className="text-base font-semibold text-foreground"
          >
            {displayTitle}
          </ClickableEventTitle>

          {description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {description}
            </p>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
