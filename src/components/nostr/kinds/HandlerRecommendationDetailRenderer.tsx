import { NostrEvent } from "@/types/nostr";
import {
  getRecommendedKind,
  getHandlerReferences,
  getRecommendedPlatforms,
  getAppName,
  getAppDescription,
  getSupportedKinds,
  getPlatformUrls,
} from "@/lib/nip89-helpers";
import { KindBadge } from "@/components/KindBadge";
import { Badge } from "@/components/ui/badge";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useGrimoire } from "@/core/state";
import { UserName } from "../UserName";
import { Globe, Smartphone, TabletSmartphone, Package } from "lucide-react";
import { useState } from "react";

interface HandlerRecommendationDetailRendererProps {
  event: NostrEvent;
}

/**
 * Get icon for platform name
 */
function PlatformIcon({ platform }: { platform: string }) {
  const lowerPlatform = platform.toLowerCase();

  if (lowerPlatform === "web") {
    return <Globe className="size-4" />;
  }
  if (lowerPlatform === "ios") {
    return <Smartphone className="size-4" />;
  }
  if (lowerPlatform === "android") {
    return <TabletSmartphone className="size-4" />;
  }

  return <span className="text-sm font-mono">{platform}</span>;
}

/**
 * Expanded handler card showing full app details
 */
function HandlerCard({
  address,
  platform,
}: {
  address: { kind: number; pubkey: string; identifier: string };
  platform?: string;
}) {
  const { addWindow } = useGrimoire();
  const handlerEvent = useNostrEvent(address);

  if (!handlerEvent) {
    return (
      <div className="p-4 bg-muted/20 rounded-lg border border-border">
        <div className="flex items-center gap-2">
          <Package className="size-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Loading {address?.identifier || "handler"}...
          </span>
        </div>
      </div>
    );
  }

  const appName = getAppName(handlerEvent);
  const description = getAppDescription(handlerEvent);
  const supportedKinds = getSupportedKinds(handlerEvent);
  const platformUrls = getPlatformUrls(handlerEvent);

  const handleClick = () => {
    addWindow("open", { pointer: address });
  };

  return (
    <div className="p-4 bg-muted/20 rounded-lg border border-border flex flex-col gap-3">
      {/* App Header */}
      <div className="flex items-start gap-3">
        <Package className="size-6 text-primary mt-1" />
        <div className="flex-1 flex flex-col gap-1">
          <button
            onClick={handleClick}
            className="text-lg font-semibold hover:underline cursor-crosshair text-left"
          >
            {appName}
          </button>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>

      {/* Supported Kinds Preview */}
      {supportedKinds.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
            Handles {supportedKinds.length} kind
            {supportedKinds.length > 1 ? "s" : ""}
          </h4>
          <div className="flex flex-wrap gap-1">
            {supportedKinds.slice(0, 10).map((kind) => (
              <KindBadge
                key={kind}
                kind={kind}
                variant="compact"
                clickable
                className="text-[10px]"
              />
            ))}
            {supportedKinds.length > 10 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                +{supportedKinds.length - 10}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Platform URLs */}
      {Object.keys(platformUrls).length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
            Platforms
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(platformUrls).map(([plat]) => (
              <Badge
                key={plat}
                variant="secondary"
                className="text-[10px] gap-1 px-2 py-0.5 capitalize"
              >
                <PlatformIcon platform={plat} />
                {plat}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Recommendation Context */}
      {platform && (
        <div className="flex flex-col gap-1 pt-2 border-t border-border text-xs text-muted-foreground">
          <div>
            Recommended for:{" "}
            <Badge variant="outline" className="text-[10px] ml-1">
              {platform}
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Detail renderer for Kind 31989 - Handler Recommendation
 * Shows comprehensive view of recommended handlers with platform filtering
 */
export function HandlerRecommendationDetailRenderer({
  event,
}: HandlerRecommendationDetailRendererProps) {
  const recommendedKind = getRecommendedKind(event);
  const allHandlers = getHandlerReferences(event);
  const platforms = getRecommendedPlatforms(event);

  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);

  // Filter handlers by selected platform
  const displayHandlers = selectedPlatform
    ? allHandlers.filter((h) => h.platform === selectedPlatform)
    : allHandlers;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header Section */}
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">Handler Recommendation</h1>

        {/* Recommended Kind */}
        {recommendedKind !== undefined && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-lg text-muted-foreground">For:</span>
            <KindBadge
              kind={recommendedKind}
              variant="full"
              showIcon
              showName
              showKindNumber
              clickable
              className="text-lg"
            />
          </div>
        )}

        {/* Recommender */}
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Recommended by:</span>
          <UserName pubkey={event.pubkey} className="text-base" />
        </div>
      </div>

      {/* Platform Filter Tabs */}
      {platforms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedPlatform(null)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              selectedPlatform === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            All Platforms ({allHandlers.length})
          </button>
          {platforms.map((platform) => {
            const count = allHandlers.filter(
              (h) => h.platform === platform,
            ).length;
            return (
              <button
                key={platform}
                onClick={() => setSelectedPlatform(platform)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors capitalize flex items-center gap-1.5 ${
                  selectedPlatform === platform
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80"
                }`}
              >
                <PlatformIcon platform={platform} />
                {platform} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Handlers Section */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">
          Recommended Handlers ({displayHandlers.length})
        </h2>

        {displayHandlers.length === 0 ? (
          <p className="text-muted-foreground">
            No handlers found for the selected platform.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {displayHandlers.map((ref, idx) => (
              <HandlerCard
                key={idx}
                address={ref.address}
                platform={ref.platform}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
