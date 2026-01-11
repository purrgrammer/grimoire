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
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { UserName } from "../UserName";
import { Package } from "lucide-react";
import { PlatformIcon } from "./zapstore/PlatformIcon";

interface ZapstoreAppSetDetailRendererProps {
  event: NostrEvent;
}

/**
 * App card showing app details with icon, summary, and platforms
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

      <div className="flex-1 flex flex-col gap-2 min-w-0">
        <button
          onClick={handleClick}
          className="text-lg font-semibold hover:underline cursor-crosshair text-left"
        >
          {appName}
        </button>

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
    </div>
  );
}

/**
 * Detail renderer for Kind 30267 - App Collection
 * Displays all apps in the collection with comprehensive metadata
 */
export function ZapstoreAppSetDetailRenderer({
  event,
}: ZapstoreAppSetDetailRendererProps) {
  const setName = getCurationSetName(event);
  const apps = getAppReferences(event);
  const identifier = getCurationSetIdentifier(event);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">{setName}</h1>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Curated by</h3>
            <UserName pubkey={event.pubkey} />
          </div>

          {identifier && (
            <div className="flex flex-col gap-1">
              <h3 className="text-muted-foreground">Collection ID</h3>
              <code className="font-mono text-sm truncate" title={identifier}>
                {identifier}
              </code>
            </div>
          )}
        </div>

        <p className="text-muted-foreground">
          {apps.length} {apps.length === 1 ? "app" : "apps"} in this collection
        </p>
      </div>

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
