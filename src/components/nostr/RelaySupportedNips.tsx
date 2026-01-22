import { Label } from "@/components/ui/label";
import { NIPBadge } from "@/components/NIPBadge";
import { FileText } from "lucide-react";

interface RelaySupportedNipsProps {
  nips: number[];
}

/**
 * Relay Supported NIPs Display Component
 * Shows supported Nostr Implementation Possibilities (NIPs) for a relay
 * Used in both Relay Discovery and Monitor Announcement detail views
 */
export function RelaySupportedNips({ nips }: RelaySupportedNipsProps) {
  if (nips.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 text-muted-foreground">
        <FileText className="size-4" />
        Supported NIPs ({nips.length})
      </Label>
      <div className="flex flex-wrap gap-1.5">
        {nips.map((nip) => (
          <NIPBadge
            key={nip}
            nipNumber={nip.toString().padStart(2, "0")}
            showName={false}
            showNIPPrefix={false}
            className="text-xs"
          />
        ))}
      </div>
    </div>
  );
}
