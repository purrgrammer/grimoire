import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getAppName,
  getSupportedKinds,
  getAvailablePlatforms,
  getAppWebsite,
} from "@/lib/nip89-helpers";
import { KindBadge } from "@/components/KindBadge";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "@/components/ExternalLink";
import { Globe, Smartphone, TabletSmartphone } from "lucide-react";

/**
 * Get icon for platform name
 */
function PlatformIcon({ platform }: { platform: string }) {
  const lowerPlatform = platform.toLowerCase();

  if (lowerPlatform === "web") {
    return <Globe className="size-3" />;
  }
  if (lowerPlatform === "ios") {
    return <Smartphone className="size-3" />;
  }
  if (lowerPlatform === "android") {
    return <TabletSmartphone className="size-3" />;
  }

  // Default icon for other platforms
  return <span className="text-[10px] font-mono">{platform}</span>;
}

/**
 * Renderer for Kind 31990 - Application Handler
 * Displays app name, supported kinds, and available platforms
 */
export function ApplicationHandlerRenderer({ event }: BaseEventProps) {
  const appName = getAppName(event);
  const supportedKinds = getSupportedKinds(event);
  const platforms = getAvailablePlatforms(event);
  const website = getAppWebsite(event);

  // Show max 8 kinds in feed view
  const MAX_KINDS_IN_FEED = 8;
  const displayKinds = supportedKinds.slice(0, MAX_KINDS_IN_FEED);
  const remainingCount = supportedKinds.length - displayKinds.length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* App Name */}
        <ClickableEventTitle
          event={event}
          className="text-lg font-semibold text-foreground"
        >
          {appName}
        </ClickableEventTitle>

        {/* Website */}
        {website && <ExternalLink href={website}>{website}</ExternalLink>}

        {/* Supported Kinds */}
        {displayKinds.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Handles:</span>
            {displayKinds.map((kind) => (
              <KindBadge
                key={kind}
                kind={kind}
                className="text-[10px]"
                showName
                clickable
              />
            ))}
            {remainingCount > 0 && (
              <Badge variant="outline" className="text-[10px] px-2 py-0">
                +{remainingCount} more
              </Badge>
            )}
          </div>
        )}

        {/* Platforms */}
        {platforms.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {platforms.map((platform) => (
              <Badge
                key={platform}
                variant="secondary"
                className="text-[10px] gap-1 px-2 py-0.5"
              >
                <PlatformIcon platform={platform} />
                {platform}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
