import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { Badge } from "@/components/ui/badge";
import {
  getMonitorFrequency,
  getMonitorChecks,
  formatFrequency,
  getCheckTypeName,
} from "@/lib/nip66-helpers";
import { Activity, Clock } from "lucide-react";

/**
 * Kind 10166 Renderer - NIP-66 Relay Monitor Announcement (Feed View)
 * Displays monitor announcement with frequency and check types
 */
export function Kind10166Renderer({ event }: BaseEventProps) {
  const frequency = getMonitorFrequency(event);
  const checks = getMonitorChecks(event);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Monitoring Frequency */}
        {frequency && !isNaN(frequency) && (
          <div className="flex items-center gap-2 text-sm">
            <Clock className="size-4 text-muted-foreground" />
            <span>
              Checks every{" "}
              <span className="font-medium">{formatFrequency(frequency)}</span>
            </span>
          </div>
        )}

        {/* Check Types */}
        {checks.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="size-3" />
              <span>Monitoring:</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {checks.map((check) => (
                <Badge
                  key={check}
                  variant="secondary"
                  className="h-5 px-2 text-xs"
                >
                  {getCheckTypeName(check)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {!frequency && checks.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            No monitoring configuration specified
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
