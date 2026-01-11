import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getAppName,
  getAppSummary,
  detectPlatforms,
} from "@/lib/zapstore-helpers";
import { PlatformIcon } from "./zapstore/PlatformIcon";

/**
 * Renderer for Kind 32267 - App Metadata
 * Clean feed view with app name, summary, and platform icons
 */
export function ZapstoreAppRenderer({ event }: BaseEventProps) {
  const appName = getAppName(event);
  const summary = getAppSummary(event);
  const platforms = detectPlatforms(event);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="text-base font-semibold text-foreground"
        >
          {appName}
        </ClickableEventTitle>

        {summary && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {summary}
          </p>
        )}

        {platforms.length > 0 && (
          <div className="flex items-center gap-2">
            {platforms.map((platform) => (
              <PlatformIcon key={platform} platform={platform} />
            ))}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
