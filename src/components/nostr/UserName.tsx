import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { cn } from "@/lib/utils";
import { useGrimoire } from "@/core/state";
import { isGrimoireMember } from "@/lib/grimoire-members";
import { BadgeCheck, Flame } from "lucide-react";
import { useIsSupporter } from "@/hooks/useIsSupporter";

interface UserNameProps {
  pubkey: string;
  isMention?: boolean;
  className?: string;
  relayHints?: string[];
}

/**
 * Component that displays a user's name from their Nostr profile
 * Shows placeholder derived from pubkey while loading or if no profile exists
 * Clicking opens the user's profile
 * Uses highlight color for the logged-in user (themeable orange)
 * Shows Grimoire members with elegant 2-color gradient styling and badge check:
 * - Orange→Amber gradient for logged-in member
 * - Violet→Fuchsia gradient for other members
 * - BadgeCheck icon that scales with username size
 * Shows Grimoire supporters (non-members who zapped):
 * - Premium supporters (2.1k+ sats/month): Flame badge in their username color
 * - Regular supporters: Yellow flame badge (no username color change)
 */
export function UserName({
  pubkey,
  isMention,
  className,
  relayHints,
}: UserNameProps) {
  const { addWindow, state } = useGrimoire();
  const profile = useProfile(pubkey, relayHints);
  const isGrimoire = isGrimoireMember(pubkey);
  const { isSupporter, isPremiumSupporter } = useIsSupporter(pubkey);
  const displayName = getDisplayName(pubkey, profile);

  // Check if this is the logged-in user
  const isActiveAccount = state.activeAccount?.pubkey === pubkey;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    addWindow("profile", { pubkey });
  };

  return (
    <span
      dir="auto"
      className={cn(
        "font-semibold cursor-crosshair hover:underline hover:decoration-dotted inline-flex items-center gap-1",
        className,
      )}
      onClick={handleClick}
    >
      <span
        className={cn(
          isGrimoire
            ? isActiveAccount
              ? "bg-gradient-to-tr from-orange-400 to-amber-600 bg-clip-text text-transparent"
              : "bg-gradient-to-tr from-violet-500 to-fuchsia-600 bg-clip-text text-transparent"
            : isActiveAccount
              ? "text-highlight"
              : "text-accent",
        )}
      >
        {isMention ? "@" : null}
        {displayName}
      </span>
      {isGrimoire && (
        <BadgeCheck
          className={cn(
            "inline-block w-[1em] h-[1em]",
            isActiveAccount ? "text-amber-500" : "text-fuchsia-500",
          )}
        />
      )}
      {!isGrimoire && isSupporter && (
        <Flame
          className={cn(
            "inline-block w-[0.85em] h-[0.85em]",
            isPremiumSupporter
              ? isActiveAccount
                ? "text-highlight fill-highlight"
                : "text-accent fill-accent"
              : "text-yellow-500 fill-yellow-500",
          )}
          aria-label={
            isPremiumSupporter
              ? "Premium Grimoire Supporter"
              : "Grimoire Supporter"
          }
        />
      )}
    </span>
  );
}
