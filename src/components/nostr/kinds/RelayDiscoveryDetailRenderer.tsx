import { NostrEvent } from "@/types/nostr";
import { RelayLink } from "../RelayLink";
import { Badge } from "@/components/ui/badge";
import { JsonViewer } from "@/components/JsonViewer";
import { UserName } from "../UserName";
import {
  getRelayUrl,
  getRttMetrics,
  getNetworkType,
  getRelayType,
  getSupportedNips,
  getRelayRequirements,
  getRelayTopics,
  getRelayKinds,
  getRelayGeohash,
  parseNip11Document,
  calculateRelayHealth,
} from "@/lib/nip66-helpers";
import {
  Activity,
  CircleDot,
  Globe,
  Lock,
  CreditCard,
  Zap,
  MapPin,
  Shield,
  Tag,
  Filter,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/hooks/useLocale";
import { useState } from "react";

/**
 * Kind 30166 Detail Renderer - NIP-66 Relay Discovery (Detail View)
 * Shows comprehensive relay information with all metrics and capabilities
 */
export function Kind30166DetailRenderer({ event }: { event: NostrEvent }) {
  const [showNip11, setShowNip11] = useState(false);

  const relayUrl = getRelayUrl(event);
  const rtt = getRttMetrics(event);
  const networkType = getNetworkType(event);
  const relayType = getRelayType(event);
  const nips = getSupportedNips(event);
  const requirements = getRelayRequirements(event);
  const topics = getRelayTopics(event);
  const kinds = getRelayKinds(event);
  const geohash = getRelayGeohash(event);
  const nip11 = parseNip11Document(event);
  const health = calculateRelayHealth(event);

  if (!relayUrl) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Invalid relay discovery event (missing relay URL)
      </div>
    );
  }

  // Calculate health color based on score
  const healthColor =
    health >= 80
      ? "text-green-600"
      : health >= 50
        ? "text-yellow-600"
        : "text-red-600";

  return (
    <div className="flex flex-col gap-4 p-4 max-w-4xl">
      {/* Header: Relay URL and Health */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b">
        <div className="flex-1 min-w-0">
          <RelayLink
            url={relayUrl}
            urlClassname="text-xl font-bold underline decoration-dotted"
            iconClassname="size-6"
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Activity className={cn("size-5", healthColor)} />
          <span className={cn("text-2xl font-bold", healthColor)}>
            {health}%
          </span>
        </div>
      </div>

      {/* Performance Metrics Section */}
      {(rtt.open !== undefined ||
        rtt.read !== undefined ||
        rtt.write !== undefined) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Activity className="size-4" />
            Performance Metrics
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {rtt.open !== undefined && !isNaN(rtt.open) && (
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/50">
                <span className="text-xs text-muted-foreground">
                  Connection
                </span>
                <span className="text-lg font-semibold">{rtt.open}ms</span>
              </div>
            )}
            {rtt.read !== undefined && !isNaN(rtt.read) && (
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/50">
                <span className="text-xs text-muted-foreground">Read</span>
                <span className="text-lg font-semibold">{rtt.read}ms</span>
              </div>
            )}
            {rtt.write !== undefined && !isNaN(rtt.write) && (
              <div className="flex flex-col gap-1 p-3 rounded-lg bg-muted/50">
                <span className="text-xs text-muted-foreground">Write</span>
                <span className="text-lg font-semibold">{rtt.write}ms</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Relay Characteristics */}
      {(networkType || relayType || geohash) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Globe className="size-4" />
            Characteristics
          </h3>
          <div className="flex flex-wrap gap-2">
            {networkType && (
              <Badge variant="outline" className="gap-1.5 px-3 py-1">
                {networkType === "tor" && <CircleDot className="size-4" />}
                {(networkType === "i2p" || networkType === "clearnet") && (
                  <Globe className="size-4" />
                )}
                <span className="capitalize">{networkType}</span>
              </Badge>
            )}
            {relayType && (
              <Badge variant="secondary" className="px-3 py-1">
                {relayType}
              </Badge>
            )}
            {geohash && (
              <Badge variant="outline" className="gap-1.5 px-3 py-1">
                <MapPin className="size-4" />
                {geohash}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Requirements Section */}
      {Object.keys(requirements).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Shield className="size-4" />
            Requirements
          </h3>
          <div className="flex flex-col gap-2">
            {requirements.auth !== undefined && (
              <div className="flex items-center gap-2 text-sm">
                <Lock
                  className={cn(
                    "size-4",
                    requirements.auth
                      ? "text-orange-600"
                      : "text-muted-foreground",
                  )}
                />
                <span>
                  Authentication{" "}
                  {requirements.auth ? "required" : "not required"}
                </span>
              </div>
            )}
            {requirements.payment !== undefined && (
              <div className="flex items-center gap-2 text-sm">
                <CreditCard
                  className={cn(
                    "size-4",
                    requirements.payment
                      ? "text-blue-600"
                      : "text-muted-foreground",
                  )}
                />
                <span>
                  Payment {requirements.payment ? "required" : "not required"}
                </span>
              </div>
            )}
            {requirements.writes !== undefined && (
              <div className="flex items-center gap-2 text-sm">
                <Zap
                  className={cn(
                    "size-4",
                    requirements.writes
                      ? "text-green-600"
                      : "text-muted-foreground",
                  )}
                />
                <span>
                  {requirements.writes
                    ? "Write access enabled"
                    : "Read-only relay"}
                </span>
              </div>
            )}
            {requirements.pow !== undefined && (
              <div className="flex items-center gap-2 text-sm">
                <Shield
                  className={cn(
                    "size-4",
                    requirements.pow
                      ? "text-purple-600"
                      : "text-muted-foreground",
                  )}
                />
                <span>
                  Proof of work {requirements.pow ? "required" : "not required"}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Supported NIPs */}
      {nips.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Supported NIPs ({nips.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {nips.map((nip) => (
              <Badge
                key={nip}
                variant="secondary"
                className="font-mono text-xs"
              >
                {nip}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Accepted Kinds */}
      {kinds.accepted.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Filter className="size-4" />
            Accepted Kinds ({kinds.accepted.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {kinds.accepted.map((kind) => (
              <Badge key={kind} variant="outline" className="font-mono text-xs">
                {kind}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Rejected Kinds */}
      {kinds.rejected.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Filter className="size-4" />
            Rejected Kinds ({kinds.rejected.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {kinds.rejected.map((kind) => (
              <Badge
                key={kind}
                variant="outline"
                className="font-mono text-xs text-red-600 border-red-600/30"
              >
                !{kind}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Topics */}
      {topics.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Tag className="size-4" />
            Topics ({topics.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {topics.map((topic, index) => (
              <Badge key={index} variant="secondary" className="text-xs">
                {topic}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* NIP-11 Document */}
      {nip11 && (
        <div className="space-y-2">
          <JsonViewer
            data={nip11}
            open={showNip11}
            onOpenChange={setShowNip11}
            title="NIP-11 Information Document"
          />
        </div>
      )}

      {/* Monitor Attribution */}
      <div className="pt-4 border-t text-xs text-muted-foreground space-y-1">
        <div className="flex items-center gap-2">
          <Clock className="size-3" />
          <span>
            Monitored {formatTimestamp(event.created_at)} by{" "}
            <UserName pubkey={event.pubkey} className="font-medium" />
          </span>
        </div>
      </div>
    </div>
  );
}
