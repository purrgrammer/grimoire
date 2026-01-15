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
  getReleaseVersion,
  getReleaseFileEventId,
} from "@/lib/zapstore-helpers";
import type { Platform } from "@/lib/zapstore-helpers";
import { UserName } from "../UserName";
import { ExternalLink } from "@/components/ExternalLink";
import { MediaEmbed } from "../MediaEmbed";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";
import { useGrimoire } from "@/core/state";
import {
  Package,
  Globe,
  Smartphone,
  TabletSmartphone,
  Monitor,
  Laptop,
  FileDown,
} from "lucide-react";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { relayListCache } from "@/services/relay-list-cache";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { useLiveTimeline } from "@/hooks/useLiveTimeline";

interface ZapstoreAppDetailRendererProps {
  event: NostrEvent;
}

/**
 * Release item component showing version and download link
 */
function ReleaseItem({ release }: { release: NostrEvent }) {
  const { addWindow } = useGrimoire();
  const version = getReleaseVersion(release);
  const fileEventId = getReleaseFileEventId(release);

  // Get relay hints from the release event
  const releaseSeenRelays = getSeenRelays(release);
  const relayHints = releaseSeenRelays
    ? Array.from(releaseSeenRelays).slice(0, 3)
    : [];

  const handleClick = () => {
    addWindow("open", {
      pointer: {
        kind: release.kind,
        pubkey: release.pubkey,
        identifier: release.tags.find((t) => t[0] === "d")?.[1] || "",
        relays: relayHints,
      },
    });
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (fileEventId) {
      addWindow("open", {
        pointer: { id: fileEventId, relays: relayHints },
      });
    }
  };

  return (
    <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg hover:bg-muted/30 transition-colors">
      <button
        onClick={handleClick}
        className="flex items-center gap-2 hover:underline cursor-crosshair"
      >
        <Package className="size-4 text-muted-foreground" />
        <span className="font-medium">
          {version ? `Version ${version}` : "Release"}
        </span>
        {version && (
          <Badge variant="secondary" className="text-xs">
            v{version}
          </Badge>
        )}
      </button>

      {fileEventId && (
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 text-primary hover:underline text-sm"
        >
          <FileDown className="size-4" />
          <span>Download</span>
        </button>
      )}
    </div>
  );
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
 * Detail renderer for Kind 32267 - App
 * Shows comprehensive app information including screenshots, platforms, and releases
 */
export function ZapstoreAppDetailRenderer({
  event,
}: ZapstoreAppDetailRendererProps) {
  const { addWindow } = useGrimoire();
  const appName = getAppName(event);
  const summary = getAppSummary(event);
  const iconUrl = getAppIcon(event);
  const images = getAppImages(event);
  const platforms = detectPlatforms(event);
  const repository = getAppRepository(event);
  const license = getAppLicense(event);
  const identifier = getAppIdentifier(event);

  // Build relay list for fetching releases:
  // 1. Seen relays (where we received this app event)
  // 2. Publisher's outbox relays (NIP-65)
  // 3. Aggregator relays (fallback)
  const relays = useMemo(() => {
    const relaySet = new Set<string>();

    // Add seen relays from the app event
    const seenRelays = getSeenRelays(event);
    if (seenRelays) {
      for (const relay of seenRelays) {
        relaySet.add(relay);
      }
    }

    // Add publisher's outbox relays
    const outboxRelays = relayListCache.getOutboxRelaysSync(event.pubkey);
    if (outboxRelays) {
      for (const relay of outboxRelays.slice(0, 3)) {
        relaySet.add(relay);
      }
    }

    // Add aggregator relays
    for (const relay of AGGREGATOR_RELAYS) {
      relaySet.add(relay);
    }

    return Array.from(relaySet);
  }, [event]);

  // Query for releases that reference this app
  const releasesFilter = useMemo(() => {
    if (!identifier) {
      // Return a filter that matches nothing when no identifier
      return { kinds: [30063], ids: [] };
    }
    return {
      kinds: [30063],
      "#a": [`32267:${event.pubkey}:${identifier}`],
    };
  }, [event.pubkey, identifier]);

  // Use useLiveTimeline to fetch releases from relays with proper hints
  const { events: releases } = useLiveTimeline(
    `zapstore-releases-detail-${event.id}`,
    releasesFilter,
    relays,
    { limit: 50 },
  );

  // Sort releases by version (newest first) or created_at
  const sortedReleases = useMemo(() => {
    const releasesList = releases || [];
    return [...releasesList].sort((a, b) => {
      const versionA = getReleaseVersion(a);
      const versionB = getReleaseVersion(b);
      if (versionA && versionB) {
        return versionB.localeCompare(versionA, undefined, { numeric: true });
      }
      return b.created_at - a.created_at;
    });
  }, [releases]);

  // Get the latest release for the header download button
  const latestRelease = sortedReleases[0] || null;
  const latestFileEventId = latestRelease
    ? getReleaseFileEventId(latestRelease)
    : null;
  const latestVersion = latestRelease ? getReleaseVersion(latestRelease) : null;

  const handleDownloadLatest = () => {
    if (latestFileEventId && latestRelease) {
      // Get relay hints from the release event (where we found it)
      const releaseSeenRelays = getSeenRelays(latestRelease);
      const relayHints = releaseSeenRelays
        ? Array.from(releaseSeenRelays).slice(0, 3)
        : relays.slice(0, 3);

      addWindow("open", {
        pointer: { id: latestFileEventId, relays: relayHints },
      });
    }
  };

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
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl font-bold">{appName}</h1>
            {latestFileEventId && (
              <button
                onClick={handleDownloadLatest}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors flex-shrink-0"
              >
                <FileDown className="size-4" />
                {latestVersion ? `Download v${latestVersion}` : "Download"}
              </button>
            )}
          </div>
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

      {/* Releases Section */}
      {sortedReleases.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">
            Releases ({sortedReleases.length})
          </h2>
          <div className="flex flex-col gap-2">
            {sortedReleases.map((release) => (
              <ReleaseItem key={release.id} release={release} />
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
                type="image"
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
