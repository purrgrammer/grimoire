import { getNIPInfo } from "../lib/nip-icons";
import { useGrimoire } from "@/core/state";

export interface NIPBadgeProps {
  nipNumber: number;
  className?: string;
  showName?: boolean;
}

/**
 * NIPBadge - Reusable component for displaying NIP badges
 * Shows icon, number, optional name, and links to NIP page
 */
export function NIPBadge({
  nipNumber,
  className = "",
  showName = true,
}: NIPBadgeProps) {
  const { addWindow } = useGrimoire();
  const nipInfo = getNIPInfo(nipNumber);
  const name = nipInfo?.name || `NIP-${nipNumber}`;
  const description =
    nipInfo?.description || `Nostr Implementation Possibility ${nipNumber}`;

  const openNIP = () => {
    const paddedNum = nipNumber.toString().padStart(2, "0");
    addWindow(
      "nip",
      { number: paddedNum },
      nipInfo ? `NIP ${paddedNum} - ${nipInfo?.name}` : `NIP ${paddedNum}`,
    );
  };

  return (
    <button
      onClick={openNIP}
      className={`flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-sm hover:bg-muted/20 cursor-crosshair ${className}`}
      title={description}
    >
      <span className="font-mono font-medium">{nipNumber}</span>
      {showName && nipInfo && (
        <span className="text-muted-foreground">· {name}</span>
      )}
    </button>
  );
}
