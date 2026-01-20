import { Trophy } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";

interface TopContributorProps {
  pubkey: string;
  amount: number;
  variant?: "default" | "compact";
}

export function TopContributor({
  pubkey,
  amount,
  variant = "default",
}: TopContributorProps) {
  const profile = useProfile(pubkey);
  const displayName = getDisplayName(pubkey, profile);

  function formatNumber(sats: number): string {
    if (sats >= 1_000_000) {
      return `${(sats / 1_000_000).toFixed(1)}M`;
    } else if (sats >= 1_000) {
      return `${Math.floor(sats / 1_000)}k`;
    }
    return sats.toString();
  }

  const isCompact = variant === "compact";

  return (
    <div
      className={`flex items-center gap-1.5 mt-${isCompact ? "1.5" : "2"} pt-${isCompact ? "1.5" : "2"} border-t border-border/${isCompact ? "30" : "50"}`}
    >
      <Trophy
        className={`${isCompact ? "size-3" : "size-3.5"} text-yellow-500`}
      />
      <span
        className={`${isCompact ? "text-[10px]" : "text-xs"} text-muted-foreground flex-1 truncate`}
      >
        {displayName}
      </span>
      <span className={`${isCompact ? "text-[10px]" : "text-xs"} font-medium`}>
        {formatNumber(amount)}
        {!isCompact && " sats"}
      </span>
    </div>
  );
}
