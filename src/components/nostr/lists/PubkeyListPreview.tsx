import { Users } from "lucide-react";
import { UserName } from "../UserName";
import { cn } from "@/lib/utils";

interface PubkeyListPreviewProps {
  pubkeys: string[];
  /** Maximum number of pubkeys to show in preview */
  previewLimit?: number;
  /** Label for the count (e.g., "people", "users", "authors") */
  label?: string;
  /** Icon to show next to count */
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Compact preview of a list of pubkeys
 * Shows count with icon and optionally previews first few names
 */
export function PubkeyListPreview({
  pubkeys,
  previewLimit = 0,
  label = "people",
  icon,
  className,
}: PubkeyListPreviewProps) {
  // Filter to valid pubkeys (64 char hex)
  const validPubkeys = pubkeys.filter((pk) => pk.length === 64);

  if (validPubkeys.length === 0) {
    return (
      <div className={cn("text-xs text-muted-foreground italic", className)}>
        No {label}
      </div>
    );
  }

  const previewPubkeys =
    previewLimit > 0 ? validPubkeys.slice(0, previewLimit) : [];
  const remaining = validPubkeys.length - previewPubkeys.length;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1.5 text-xs">
        {icon || <Users className="size-4 text-muted-foreground" />}
        <span>
          {validPubkeys.length} {label}
        </span>
      </div>
      {previewPubkeys.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs">
          {previewPubkeys.map((pubkey) => (
            <UserName key={pubkey} pubkey={pubkey} className="text-xs" />
          ))}
          {remaining > 0 && (
            <span className="text-muted-foreground">+{remaining} more</span>
          )}
        </div>
      )}
    </div>
  );
}

interface PubkeyListFullProps {
  pubkeys: string[];
  /** Label for the section header */
  label?: string;
  /** Icon to show in header */
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Full list of pubkeys for detail views
 * Shows all pubkeys as clickable names
 */
export function PubkeyListFull({
  pubkeys,
  label = "People",
  icon,
  className,
}: PubkeyListFullProps) {
  // Filter to valid pubkeys (64 char hex)
  const validPubkeys = pubkeys.filter((pk) => pk.length === 64);

  if (validPubkeys.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground italic", className)}>
        No {label.toLowerCase()}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        {icon || <Users className="size-5" />}
        <span className="font-semibold">
          {label} ({validPubkeys.length})
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {validPubkeys.map((pubkey) => (
          <div key={pubkey} className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">•</span>
            <UserName pubkey={pubkey} />
          </div>
        ))}
      </div>
    </div>
  );
}
