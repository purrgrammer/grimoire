import { getNIPInfo } from "../lib/nip-icons";
import { useAddWindow } from "@/core/state";
import { isNipDeprecated } from "@/constants/nips";
import { getCommunityNipForNipId } from "@/constants/kinds";

export interface NIPBadgeProps {
  nipNumber: string;
  className?: string;
  showName?: boolean;
  showNIPPrefix?: boolean;
}

/**
 * NIPBadge - Reusable component for displaying NIP badges
 * Shows icon, number, optional name, and links to NIP page
 */
export function NIPBadge({
  nipNumber,
  className = "",
  showName = true,
  showNIPPrefix = true,
}: NIPBadgeProps) {
  const addWindow = useAddWindow();
  const nipInfo = getNIPInfo(nipNumber);
  const name = nipInfo?.name || `NIP-${nipNumber}`;
  const description =
    nipInfo?.description || `Nostr Implementation Possibility ${nipNumber}`;
  const isDeprecated = isNipDeprecated(nipNumber);

  const communityNip = getCommunityNipForNipId(nipNumber);

  const openNIP = () => {
    if (communityNip) {
      const pointer = {
        kind: 30817,
        pubkey: communityNip.pubkey,
        identifier: communityNip.identifier,
        relays: communityNip.relayHints,
      };
      addWindow("open", { pointer }, undefined, communityNip.title);
      return;
    }
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
      className={`flex items-center gap-2 border bg-card px-2.5 py-1.5 text-sm hover:underline hover:decoration-dotted cursor-crosshair ${
        isDeprecated ? "opacity-50" : ""
      } ${className}`}
      title={
        isDeprecated
          ? `${description} (DEPRECATED)`
          : communityNip
            ? `${description} (Community NIP)`
            : description
      }
    >
      <span className="text-muted-foreground">
        {`${showNIPPrefix ? "NIP-" : ""}${nipNumber}`}
      </span>
      {showName && nipInfo && (
        <>
          <span>{name}</span>
        </>
      )}
    </button>
  );
}
