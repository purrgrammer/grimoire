import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { cn } from "@/lib/utils";
import { useGrimoire } from "@/core/state";
import { isGrimoireMember } from "@/lib/grimoire-members";
import { BadgeCheck } from "lucide-react";

interface UserNameProps {
  pubkey: string;
  isMention?: boolean;
  className?: string;
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
 */
export function UserName({ pubkey, isMention, className }: UserNameProps) {
  const { addWindow, state } = useGrimoire();
  const profile = useProfile(pubkey);
  const isGrimoire = isGrimoireMember(pubkey);
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
    </span>
  );
}
