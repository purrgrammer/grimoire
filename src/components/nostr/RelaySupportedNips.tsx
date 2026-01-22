import { NIPBadge } from "@/components/NIPBadge";

interface RelaySupportedNipsProps {
  nips: number[];
  title?: string;
  showTitle?: boolean;
}

/**
 * Relay Supported NIPs Display Component
 * Shows supported Nostr Implementation Possibilities (NIPs) for a relay
 * Used in RelayViewer and Relay Discovery detail views
 * Renders NIP badges with names for better readability
 */
export function RelaySupportedNips({
  nips,
  title = "Supported NIPs",
  showTitle = true,
}: RelaySupportedNipsProps) {
  if (nips.length === 0) {
    return null;
  }

  return (
    <div>
      {showTitle && <h3 className="mb-3 font-semibold text-sm">{title}</h3>}
      <div className="flex flex-wrap gap-2">
        {nips.map((nip) => (
          <NIPBadge
            key={nip}
            nipNumber={nip.toString().padStart(2, "0")}
            showName={true}
          />
        ))}
      </div>
    </div>
  );
}
