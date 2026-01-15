import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getAppName,
  getAppSummary,
  getAppIdentifier,
  detectPlatforms,
  getReleaseVersion,
  getReleaseFileEventId,
} from "@/lib/zapstore-helpers";
import { PlatformIcon } from "./zapstore/PlatformIcon";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import { useMemo } from "react";
import { useGrimoire } from "@/core/state";
import { FileDown } from "lucide-react";

/**
 * Renderer for Kind 32267 - App Metadata
 * Clean feed view with app name, summary, platform icons, and download button
 */
export function ZapstoreAppRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const appName = getAppName(event);
  const summary = getAppSummary(event);
  const identifier = getAppIdentifier(event);
  const platforms = detectPlatforms(event);

  // Query for releases that reference this app
  const releasesFilter = useMemo(() => {
    if (!identifier) {
      return { kinds: [30063], ids: [] };
    }
    return {
      kinds: [30063],
      "#a": [`32267:${event.pubkey}:${identifier}`],
    };
  }, [event.pubkey, identifier]);

  const releases = use$(
    () => eventStore.timeline(releasesFilter),
    [releasesFilter],
  );

  // Get the latest release (by version or created_at)
  const latestRelease = useMemo(() => {
    if (!releases || releases.length === 0) return null;
    return [...releases].sort((a, b) => {
      const versionA = getReleaseVersion(a);
      const versionB = getReleaseVersion(b);
      if (versionA && versionB) {
        return versionB.localeCompare(versionA, undefined, { numeric: true });
      }
      return b.created_at - a.created_at;
    })[0];
  }, [releases]);

  const latestFileEventId = latestRelease
    ? getReleaseFileEventId(latestRelease)
    : null;
  const latestVersion = latestRelease ? getReleaseVersion(latestRelease) : null;

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (latestFileEventId) {
      addWindow("open", { pointer: { id: latestFileEventId } });
    }
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <ClickableEventTitle
            event={event}
            className="text-base font-semibold text-foreground"
          >
            {appName}
          </ClickableEventTitle>

          {latestFileEventId && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-primary border border-primary/20 rounded hover:bg-primary/10 transition-colors flex-shrink-0"
              title={latestVersion ? `Download v${latestVersion}` : "Download"}
            >
              <FileDown className="size-3" />
              {latestVersion ? `v${latestVersion}` : "Download"}
            </button>
          )}
        </div>

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
