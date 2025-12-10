import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { cn } from "@/lib/utils";
import { useGrimoire } from "@/core/state";

interface UserNameProps {
  pubkey: string;
  isMention?: boolean;
  className?: string;
}

/**
 * Component that displays a user's name from their Nostr profile
 * Shows placeholder derived from pubkey while loading or if no profile exists
 * Clicking opens the user's profile
 */
export function UserName({ pubkey, isMention, className }: UserNameProps) {
  const { addWindow } = useGrimoire();
  const profile = useProfile(pubkey);
  const displayName = getDisplayName(pubkey, profile);

  const handleClick = () => {
    addWindow("profile", { pubkey }, `Profile ${pubkey.slice(0, 8)}...`);
  };

  return (
    <span
      dir="auto"
      className={cn("cursor-pointer hover:underline", className)}
      onClick={handleClick}
    >
      {isMention ? "@" : null}
      {displayName}
    </span>
  );
}
