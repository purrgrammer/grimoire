import { NostrEvent } from "@/types/nostr";
import {
  getCurationSetName,
  getAppReferences,
  getAppName,
  getAppSummary,
  getAppIcon,
  detectPlatforms,
  getCurationSetIdentifier,
} from "@/lib/zapstore-helpers";
import type { Platform } from "@/lib/zapstore-helpers";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { UserName } from "../UserName";
import {
  Package,
  Globe,
  Smartphone,
  TabletSmartphone,
  Monitor,
  Laptop,
} from "lucide-react";

interface ZapstoreAppSetDetailRendererProps {
  event: NostrEvent;
}

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
 * Expanded app card showing full app details
 */
function AppCard({
  address,
}: {
  address: { kind: number; pubkey: string; identifier: string };
}) {
  const { addWindow } = useGrimoire();
  const appEvent = useNostrEvent(address);

  if (!appEvent) {
    return (
      <div className="p-4 bg-muted/20 rounded-lg border border-border">
        <div className="flex items-center gap-2">
          <Package className="size-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Loading {address?.identifier || "app"}...
          </span>
        </div>
      </div>
    );
  }

  const appName = getAppName(appEvent);
  const summary = getAppSummary(appEvent);
  const iconUrl = getAppIcon(appEvent);
  const platforms = detectPlatforms(appEvent);

  const handleClick = () => {
    addWindow("open", { pointer: address });
  };

  return (
    <div className="p-4 bg-muted/20 rounded-lg border border-border flex gap-4 hover:bg-muted/30 transition-colors">
      {/* App Icon */}
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={appName}
          className="size-16 rounded-lg object-cover flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="size-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Package className="size-8 text-muted-foreground" />
        </div>
      )}

      {/* App Info */}
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        {/* App Name */}
        <button
          onClick={handleClick}
          className="text-lg font-semibold hover:underline cursor-crosshair text-left"
        >
          {appName}
        </button>

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
  );
}

/**
 * Detail renderer for Kind 30267 - Zapstore App Curation Set
 * Shows comprehensive view of all apps in the collection
 */
export function ZapstoreAppSetDetailRenderer({
  event,
}: ZapstoreAppSetDetailRendererProps) {
  const setName = getCurationSetName(event);
  const apps = getAppReferences(event);
  const identifier = getCurationSetIdentifier(event);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header Section */}
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">{setName}</h1>

        {/* Metadata */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          {/* Curator */}
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Curated by</h3>
            <UserName pubkey={event.pubkey} />
          </div>

          {/* Identifier */}
          {identifier && (
            <div className="flex flex-col gap-1">
              <h3 className="text-muted-foreground">Collection ID</h3>
              <code className="font-mono text-sm truncate" title={identifier}>
                {identifier}
              </code>
            </div>
          )}
        </div>

        {/* App Count */}
        <p className="text-muted-foreground">
          {apps.length} {apps.length === 1 ? "app" : "apps"} in this collection
        </p>
      </div>

      {/* Apps Section */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Apps</h2>

        {apps.length === 0 ? (
          <p className="text-muted-foreground">
            No apps in this collection yet.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {apps.map((ref, idx) => (
              <AppCard key={idx} address={ref.address} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
