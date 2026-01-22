import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Filter, XCircle } from "lucide-react";

interface RelayKindsDisplayProps {
  accepted: number[];
  rejected: number[];
}

/**
 * Relay Kinds Display Component
 * Shows accepted and rejected event kinds for a relay in a consistent format
 * Used in both Relay Discovery and Monitor Announcement detail views
 */
export function RelayKindsDisplay({
  accepted,
  rejected,
}: RelayKindsDisplayProps) {
  return (
    <>
      {/* Accepted Kinds */}
      {accepted.length > 0 && (
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-muted-foreground">
            <Filter className="size-4" />
            Accepted Kinds ({accepted.length})
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {accepted.map((kind) => (
              <Badge key={kind} variant="outline" className="font-mono text-xs">
                {kind}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Rejected Kinds */}
      {rejected.length > 0 && (
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-muted-foreground">
            <XCircle className="size-4" />
            Rejected Kinds ({rejected.length})
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {rejected.map((kind) => (
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
    </>
  );
}
