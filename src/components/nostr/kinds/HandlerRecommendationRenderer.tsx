import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getRecommendedKind,
  getHandlerReferences,
  getAppName,
} from "@/lib/nip89-helpers";
import { KindBadge } from "@/components/KindBadge";
import { Badge } from "@/components/ui/badge";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { Globe, Smartphone, TabletSmartphone, Package } from "lucide-react";

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

  return null;
}

/**
 * Individual handler item - fetches and displays handler info
 */
function HandlerItem({
  address,
  platform,
}: {
  address: { kind: number; pubkey: string; identifier: string };
  platform?: string;
  relayHint?: string;
}) {
  const { addWindow } = useGrimoire();
  const handlerEvent = useNostrEvent(address);
  const appName = handlerEvent
    ? getAppName(handlerEvent)
    : address?.identifier || "Unknown Handler";

  const handleClick = () => {
    addWindow("open", { pointer: address });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Package className="size-3 text-muted-foreground" />
      <button
        onClick={handleClick}
        className="text-sm hover:underline cursor-crosshair text-primary"
      >
        {appName}
      </button>
      {platform && (
        <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0">
          <PlatformIcon platform={platform} />
          {platform}
        </Badge>
      )}
    </div>
  );
}

/**
 * Renderer for Kind 31989 - Handler Recommendation
 * Displays which event kind is being recommended and the handlers
 */
export function HandlerRecommendationRenderer({ event }: BaseEventProps) {
  const recommendedKind = getRecommendedKind(event);
  const handlers = getHandlerReferences(event);

  // Show max 3 handlers in feed view
  const MAX_HANDLERS_IN_FEED = 3;
  const displayHandlers = handlers.slice(0, MAX_HANDLERS_IN_FEED);
  const remainingCount = handlers.length - displayHandlers.length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title with recommended kind */}
        <ClickableEventTitle
          event={event}
          className="text-base font-semibold text-foreground flex items-center gap-2 flex-wrap"
        >
          <span>Recommends handlers for</span>
          {recommendedKind !== undefined && (
            <KindBadge
              kind={recommendedKind}
              showIcon
              showName
              clickable
              className="text-sm"
            />
          )}
        </ClickableEventTitle>

        {/* Handler List */}
        {displayHandlers.length > 0 && (
          <div className="flex flex-col gap-1.5 pl-4 border-l-2 border-muted">
            {displayHandlers.map((ref, idx) => (
              <HandlerItem
                key={idx}
                address={ref.address}
                platform={ref.platform}
                relayHint={ref.relayHint}
              />
            ))}
            {remainingCount > 0 && (
              <span className="text-xs text-muted-foreground">
                +{remainingCount} more handler{remainingCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
