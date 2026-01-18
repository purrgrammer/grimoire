import { getGrimoireMember } from "@/lib/grimoire-members";
import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Grimoire Username Component
 *
 * Displays Grimoire member usernames with special styling and verification badge.
 * If the pubkey belongs to a Grimoire member, shows their custom username
 * with a Grimoire badge icon. Otherwise returns null.
 */
export function GrimoireUsername({
  pubkey,
  className,
  showIcon = true,
}: {
  pubkey: string;
  className?: string;
  showIcon?: boolean;
}) {
  const member = getGrimoireMember(pubkey);

  if (!member) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-accent font-medium",
        className,
      )}
      title={`Grimoire member: ${member.nip05}`}
    >
      <span>{member.username}@grimoire.rocks</span>
      {showIcon && (
        <BookOpen
          className="h-3.5 w-3.5 text-accent"
          aria-label="Grimoire member"
        />
      )}
    </span>
  );
}

/**
 * Grimoire Badge Component
 *
 * Shows just the verification badge icon for Grimoire members.
 * Useful for adding next to existing username displays.
 */
export function GrimoireBadge({
  pubkey,
  className,
}: {
  pubkey: string;
  className?: string;
}) {
  const member = getGrimoireMember(pubkey);

  if (!member) {
    return null;
  }

  return (
    <BookOpen
      className={cn("h-3.5 w-3.5 text-accent", className)}
      title={`Grimoire member: ${member.nip05}`}
      aria-label="Grimoire member"
    />
  );
}
