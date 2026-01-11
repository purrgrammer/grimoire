import { NostrEvent } from "@/types/nostr";
import {
  getAppName,
  getAppSummary,
  getAppIcon,
  getAppImages,
  detectPlatforms,
  getAppRepository,
  getAppLicense,
  getAppIdentifier,
} from "@/lib/zapstore-helpers";
import type { Platform } from "@/lib/zapstore-helpers";
import { UserName } from "../UserName";
import { ExternalLink } from "@/components/ExternalLink";
import { MediaEmbed } from "../MediaEmbed";
import {
  Package,
  Globe,
  Smartphone,
  TabletSmartphone,
  Monitor,
  Laptop,
} from "lucide-react";

interface ZapstoreAppDetailRendererProps {
  event: NostrEvent;
}

/**
 * Platform icon and label component
 */
function PlatformItem({ platform }: { platform: Platform }) {
  const iconClass = "size-5";

  const getPlatformName = () => {
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
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-lg">
      {getIcon()}
      <span className="text-sm font-medium">{getPlatformName()}</span>
    </div>
  );
}

/**
 * Detail renderer for Kind 32267 - Zapstore App Metadata
 * Shows comprehensive app information including screenshots
 * Note: Zapstore helpers wrap getTagValue which caches internally
 */
export function ZapstoreAppDetailRenderer({
  event,
}: ZapstoreAppDetailRendererProps) {
  const appName = getAppName(event);
  const summary = getAppSummary(event);
  const iconUrl = getAppIcon(event);
  const images = getAppImages(event);
  const platforms = detectPlatforms(event);
  const repository = getAppRepository(event);
  const license = getAppLicense(event);
  const identifier = getAppIdentifier(event);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header Section */}
      <div className="flex gap-4">
        {/* App Icon */}
        {iconUrl ? (
          <img
            src={iconUrl}
            alt={appName}
            className="size-20 rounded-lg object-cover flex-shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="size-20 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <Package className="size-10 text-muted-foreground" />
          </div>
        )}

        {/* App Title & Summary */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <h1 className="text-3xl font-bold">{appName}</h1>
          {summary && (
            <p className="text-muted-foreground text-base">{summary}</p>
          )}
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        {/* Publisher */}
        <div className="flex flex-col gap-1">
          <h3 className="text-muted-foreground">Publisher</h3>
          <UserName pubkey={event.pubkey} />
        </div>

        {/* Identifier */}
        {identifier && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Package ID</h3>
            <code className="font-mono text-sm truncate" title={identifier}>
              {identifier}
            </code>
          </div>
        )}

        {/* License */}
        {license && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">License</h3>
            <code className="font-mono text-sm">{license}</code>
          </div>
        )}

        {/* Repository */}
        {repository && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Repository</h3>
            <ExternalLink href={repository} className="truncate">
              {repository}
            </ExternalLink>
          </div>
        )}
      </div>

      {/* Platforms Section */}
      {platforms.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Available On</h2>
          <div className="flex flex-wrap gap-2">
            {platforms.map((platform) => (
              <PlatformItem key={platform} platform={platform} />
            ))}
          </div>
        </div>
      )}

      {/* Screenshots Section */}
      {images.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">
            Screenshots ({images.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {images.map((imageUrl, idx) => (
              <MediaEmbed
                key={idx}
                url={imageUrl}
                preset="preview"
                enableZoom
                className="w-full rounded-lg overflow-hidden aspect-video"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
