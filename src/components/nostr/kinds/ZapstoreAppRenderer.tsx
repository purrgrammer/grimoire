import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getAppName,
  getAppSummary,
  getAppIcon,
  getAppPlatforms,
  getAppRepository,
  getAppLicense,
} from "@/lib/zapstore-helpers";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "@/components/ExternalLink";
import { Package } from "lucide-react";

/**
 * Renderer for Kind 32267 - Zapstore App Metadata
 * Displays app name, icon, summary, and platforms in feed
 */
export function ZapstoreAppRenderer({ event }: BaseEventProps) {
  const appName = getAppName(event);
  const summary = getAppSummary(event);
  const iconUrl = getAppIcon(event);
  const platforms = getAppPlatforms(event);
  const repository = getAppRepository(event);
  const license = getAppLicense(event);

  return (
    <BaseEventContainer event={event}>
      <div className="flex gap-3">
        {/* App Icon */}
        {iconUrl ? (
          <img
            src={iconUrl}
            alt={appName}
            className="size-12 rounded-lg object-cover flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="size-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Package className="size-6 text-muted-foreground" />
          </div>
        )}

        {/* App Info */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          {/* App Name */}
          <ClickableEventTitle
            event={event}
            className="text-base font-semibold text-foreground"
          >
            {appName}
          </ClickableEventTitle>

          {/* Summary */}
          {summary && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {summary}
            </p>
          )}

          {/* Platforms & License */}
          <div className="flex items-center gap-2 flex-wrap">
            {platforms.length > 0 && (
              <>
                {platforms.slice(0, 4).map((platform) => (
                  <Badge
                    key={platform}
                    variant="secondary"
                    className="text-[10px] px-2 py-0.5"
                  >
                    {platform}
                  </Badge>
                ))}
                {platforms.length > 4 && (
                  <Badge variant="outline" className="text-[10px] px-2 py-0">
                    +{platforms.length - 4} more
                  </Badge>
                )}
              </>
            )}
            {license && (
              <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                {license}
              </Badge>
            )}
          </div>

          {/* Repository Link */}
          {repository && (
            <ExternalLink
              href={repository}
              className="text-xs truncate max-w-full"
            >
              {repository}
            </ExternalLink>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
