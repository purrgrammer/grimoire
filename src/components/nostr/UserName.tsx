import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { cn } from "@/lib/utils";
import { useGrimoire } from "@/core/state";
import { isGrimoirePremium } from "@/lib/nip05-grimoire";

interface UserNameProps {
  pubkey: string;
  isMention?: boolean;
  className?: string;
}

/**
 * Component that displays a user's name from their Nostr profile
 * Shows placeholder derived from pubkey while loading or if no profile exists
 * Clicking opens the user's profile
 * Uses orange-400 color for the logged-in user
 * Uses gradient styling for grimoire.app premium users
 */
export function UserName({ pubkey, isMention, className }: UserNameProps) {
  const { addWindow, state } = useGrimoire();
  const profile = useProfile(pubkey);
  const displayName = getDisplayName(pubkey, profile);

  // Check if this is the logged-in user
  const isActiveAccount = state.activeAccount?.pubkey === pubkey;

  // Check if this is a grimoire.app premium user
  const isPremium = isGrimoirePremium(pubkey);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    addWindow("profile", { pubkey });
  };

  return (
    <span
      dir="auto"
      className={cn(
        "font-semibold cursor-crosshair hover:underline hover:decoration-dotted",
        isActiveAccount
          ? "text-orange-400"
          : isPremium
            ? "text-grimoire-gradient"
            : "text-accent",
        className,
      )}
      onClick={handleClick}
    >
      {isMention ? "@" : null}
      {displayName}
    </span>
  );
}
