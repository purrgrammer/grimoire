import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getAppName,
  getAppSummary,
  getAppIcon,
  detectPlatforms,
} from "@/lib/zapstore-helpers";
import {
  Package,
  Globe,
  Smartphone,
  TabletSmartphone,
  Monitor,
  Laptop,
} from "lucide-react";
import type { Platform } from "@/lib/zapstore-helpers";

/**
 * Platform icon component with label
 */
function PlatformIcon({ platform }: { platform: Platform }) {
  const iconClass = "size-4 text-muted-foreground";

  const getPlatformLabel = () => {
    switch (platform) {
      case "android":
        return "Android";
      case "ios":
        return "iOS";
      case "web":
        return "Web";
      case "macos":
        return "macOS";
      case "windows":
        return "Windows";
      case "linux":
        return "Linux";
      default:
        return platform;
    }
  };

  const getIcon = () => {
    switch (platform) {
      case "android":
        return <TabletSmartphone className={iconClass} />;
      case "ios":
        return <Smartphone className={iconClass} />;
      case "web":
        return <Globe className={iconClass} />;
      case "macos":
        return <Laptop className={iconClass} />;
      case "windows":
      case "linux":
        return <Monitor className={iconClass} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {getIcon()}
      <span className="text-xs text-muted-foreground">
        {getPlatformLabel()}
      </span>
    </div>
  );
}

/**
 * Renderer for Kind 32267 - Zapstore App Metadata
 * Displays app name, icon, summary, and platform icons in feed
 */
export function ZapstoreAppRenderer({ event }: BaseEventProps) {
  const appName = getAppName(event);
  const summary = getAppSummary(event);
  const iconUrl = getAppIcon(event);
  const platforms = detectPlatforms(event);

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

          {/* Platform Icons */}
          {platforms.length > 0 && (
            <div className="flex items-center gap-2">
              {platforms.map((platform) => (
                <PlatformIcon key={platform} platform={platform} />
              ))}
            </div>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
