import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getCurationSetName,
  getAppReferences,
  getAppName,
} from "@/lib/zapstore-helpers";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { Package } from "lucide-react";

/**
 * Individual app item - fetches and displays app info
 */
function AppItem({
  address,
}: {
  address: { kind: number; pubkey: string; identifier: string };
}) {
  const { addWindow } = useGrimoire();
  const appEvent = useNostrEvent(address);
  const appName = appEvent
    ? getAppName(appEvent)
    : address?.identifier || "Unknown App";

  const handleClick = () => {
    addWindow("open", { pointer: address });
  };

  return (
    <div className="flex items-center gap-2">
      <Package className="size-3 text-muted-foreground" />
      <button
        onClick={handleClick}
        className="text-sm hover:underline cursor-crosshair text-primary truncate"
      >
        {appName}
      </button>
    </div>
  );
}

/**
 * Renderer for Kind 30267 - Zapstore App Curation Set
 * Displays collection name and list of apps
 */
export function ZapstoreAppSetRenderer({ event }: BaseEventProps) {
  const setName = getCurationSetName(event);
  const apps = getAppReferences(event);

  // Show max 5 apps in feed view
  const MAX_APPS_IN_FEED = 5;
  const displayApps = apps.slice(0, MAX_APPS_IN_FEED);
  const remainingCount = apps.length - displayApps.length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Collection Name */}
        <ClickableEventTitle
          event={event}
          className="text-base font-semibold text-foreground"
        >
          {setName}
        </ClickableEventTitle>

        {/* App Count */}
        <p className="text-sm text-muted-foreground">
          {apps.length} {apps.length === 1 ? "app" : "apps"}
        </p>

        {/* App List */}
        {displayApps.length > 0 && (
          <div className="flex flex-col gap-1.5 pl-4 border-l-2 border-muted">
            {displayApps.map((ref, idx) => (
              <AppItem key={idx} address={ref.address} />
            ))}
            {remainingCount > 0 && (
              <span className="text-xs text-muted-foreground">
                +{remainingCount} more app{remainingCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
