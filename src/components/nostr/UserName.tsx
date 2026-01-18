import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { cn } from "@/lib/utils";
import { useGrimoire } from "@/core/state";
import { isGrimoireMember } from "@/lib/grimoire-members";

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
 * Shows Grimoire members with gradient styling:
 * - Orange gradient for logged-in Grimoire member (matches highlight)
 * - Purple-pink gradient for other Grimoire members (matches accent)
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
        "font-semibold cursor-crosshair hover:underline hover:decoration-dotted",
        isGrimoire
          ? isActiveAccount
            ? "bg-gradient-to-br from-orange-400 via-orange-500 to-amber-600 bg-clip-text text-transparent"
            : "bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-600 bg-clip-text text-transparent"
          : isActiveAccount
            ? "text-highlight"
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
