import { NostrEvent } from "@/types/nostr";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { UserName } from "../UserName";
import {
  getMonitorFrequency,
  getMonitorTimeouts,
  getMonitorChecks,
  getMonitorGeohash,
  formatFrequency,
  formatTimeout,
  getCheckTypeName,
} from "@/lib/nip66-helpers";
import { Activity, Clock, MapPin, Timer } from "lucide-react";

/**
 * Kind 10166 Detail Renderer - NIP-66 Relay Monitor Announcement (Detail View)
 * Shows comprehensive monitor configuration including frequency, timeouts, and checks
 */
export function Kind10166DetailRenderer({ event }: { event: NostrEvent }) {
  const frequency = getMonitorFrequency(event);
  const timeouts = getMonitorTimeouts(event);
  const checks = getMonitorChecks(event);
  const geohash = getMonitorGeohash(event);

  return (
    <div className="flex flex-col gap-4 p-4 max-w-4xl">
      {/* Header: Monitor Identity */}
      <div className="flex flex-col gap-2 pb-4 border-b">
        <h1 className="text-2xl font-bold">Relay Monitor</h1>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-sm">Operated by</span>
          <UserName pubkey={event.pubkey} className="font-medium" />
        </div>
      </div>

      {/* Operational Parameters */}
      <div className="space-y-4">
        {/* Monitoring Frequency */}
        {frequency && !isNaN(frequency) && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-muted-foreground">
              <Clock className="size-4" />
              Publishing Frequency
            </Label>
            <div className="p-3 rounded-lg bg-muted/50">
              <span className="text-lg font-semibold">
                {formatFrequency(frequency)}
              </span>
              <span className="text-sm text-muted-foreground ml-2">
                ({frequency} seconds)
              </span>
            </div>
          </div>
        )}

        {/* Check Types Performed */}
        {checks.length > 0 && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-muted-foreground">
              <Activity className="size-4" />
              Check Types ({checks.length})
            </Label>
            <div className="flex flex-wrap gap-2">
              {checks.map((check) => (
                <Badge key={check} variant="secondary" className="px-3 py-1.5">
                  {getCheckTypeName(check)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Timeout Configurations */}
        {Object.keys(timeouts).length > 0 && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-muted-foreground">
              <Timer className="size-4" />
              Timeout Configurations
            </Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(timeouts).map(([checkType, timeout]) => (
                <div
                  key={checkType}
                  className="flex flex-col gap-1 p-3 rounded-lg bg-muted/50"
                >
                  <span className="text-xs text-muted-foreground">
                    {getCheckTypeName(checkType)}
                  </span>
                  <span className="text-base font-semibold">
                    {formatTimeout(timeout)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Geographic Location */}
        {geohash && (
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="size-4" />
              Location
            </Label>
            <Badge variant="outline" className="gap-2 px-3 py-1.5">
              <MapPin className="size-4" />
              <span className="font-mono">{geohash}</span>
            </Badge>
          </div>
        )}
      </div>

      {/* Monitor Description */}
      {event.content && event.content.trim() !== "" && (
        <div className="space-y-2 pt-4 border-t">
          <Label className="text-muted-foreground">About this Monitor</Label>
          <p className="text-sm whitespace-pre-wrap">{event.content}</p>
        </div>
      )}

      {/* Empty State */}
      {!frequency &&
        checks.length === 0 &&
        Object.keys(timeouts).length === 0 &&
        !geohash &&
        (!event.content || event.content.trim() === "") && (
          <div className="text-center text-muted-foreground text-sm py-8">
            No monitoring configuration specified
          </div>
        )}
    </div>
  );
}
