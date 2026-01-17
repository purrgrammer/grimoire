import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getBadgeIdentifier,
  getBadgeName,
  getBadgeDescription,
} from "@/lib/nip58-helpers";

/**
 * Renderer for Kind 30009 - Badge (NIP-58)
 * Simple feed view with name and description
 */
export function BadgeDefinitionRenderer({ event }: BaseEventProps) {
  const identifier = getBadgeIdentifier(event);
  const name = getBadgeName(event);
  const description = getBadgeDescription(event);

  // Use name if available, fallback to identifier
  const displayTitle = name || identifier || "Badge";

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-1">
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
    </BaseEventContainer>
  );
}
