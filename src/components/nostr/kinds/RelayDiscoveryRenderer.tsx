import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { Badge } from "@/components/ui/badge";
import {
  getRelayUrl,
  getRttMetrics,
  getNetworkType,
  getRelayType,
  getRelayRequirements,
  calculateRelayHealth,
} from "@/lib/nip66-helpers";
import {
  Activity,
  CircleDot,
  Globe,
  Lock,
  CreditCard,
  Hammer,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Relay Discovery Renderer - NIP-66 Relay Discovery (Feed View)
 * Kind 30166 - Displays relay information with health metrics, network type, and capabilities
 */
export function RelayDiscoveryRenderer({ event }: BaseEventProps) {
  const relayUrl = getRelayUrl(event);
  const rtt = getRttMetrics(event);
  const networkType = getNetworkType(event);
  const relayType = getRelayType(event);
  const requirements = getRelayRequirements(event);
  const health = calculateRelayHealth(event);

  if (!relayUrl) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          Invalid relay discovery event (missing relay URL)
        </div>
      </BaseEventContainer>
    );
  }

  // Calculate health color based on score
  const healthColor =
    health >= 80
      ? "text-green-600"
      : health >= 50
        ? "text-yellow-600"
        : "text-red-600";

  // Format RTT for display (average of available metrics)
  const avgRtt = [rtt.open, rtt.read, rtt.write]
    .filter((v): v is number => v !== undefined && !isNaN(v))
    .reduce((sum, v, _, arr) => sum + v / arr.length, 0);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Clickable Title and Health Score */}
        <div className="flex items-center justify-between gap-2">
          <ClickableEventTitle
            event={event}
            className="text-base font-semibold truncate flex-1 min-w-0"
          >
            {relayUrl}
          </ClickableEventTitle>
          <div className="flex items-center gap-1 text-xs shrink-0">
            <Activity className={cn("size-3", healthColor)} />
            <span className={cn("font-medium", healthColor)}>{health}%</span>
          </div>
        </div>

        {/* Badges: Network Type, Relay Type, RTT, Requirements */}
        <div className="flex flex-wrap gap-1.5 text-xs">
          {/* Network Type Badge */}
          {networkType && (
            <Badge
              variant="outline"
              className="gap-1 h-5 px-1.5 bg-background/50"
            >
              {networkType === "tor" && <CircleDot className="size-3" />}
              {networkType === "i2p" && <Globe className="size-3" />}
              {networkType === "clearnet" && <Globe className="size-3" />}
              <span className="capitalize">{networkType}</span>
            </Badge>
          )}

          {/* Relay Type Badge */}
          {relayType && (
            <Badge variant="secondary" className="h-5 px-1.5">
              {relayType}
            </Badge>
          )}

          {/* RTT Badge */}
          {avgRtt > 0 && (
            <Badge variant="outline" className="h-5 px-1.5 gap-1">
              <Activity className="size-3" />
              {Math.round(avgRtt)}ms
            </Badge>
          )}

          {/* Requirements Badges */}
          {requirements.auth && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 gap-1 text-orange-600 border-orange-600/30"
            >
              <Lock className="size-3" />
              Auth
            </Badge>
          )}
          {requirements.payment && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 gap-1 text-blue-600 border-blue-600/30"
            >
              <CreditCard className="size-3" />
              Paid
            </Badge>
          )}
          {requirements.writes === false && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 gap-1 text-muted-foreground"
            >
              Read-only
            </Badge>
          )}
          {requirements.pow && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 gap-1 text-purple-600 border-purple-600/30"
            >
              <Hammer className="size-3" />
              PoW
            </Badge>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
