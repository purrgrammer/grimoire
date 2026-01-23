import {
  CircleDot,
  CheckCircle2,
  XCircle,
  FileEdit,
  Loader2,
} from "lucide-react";
import { getStatusType } from "@/lib/nip34-helpers";

/**
 * Get the icon component for a status kind
 */
function getStatusIcon(kind: number) {
  switch (kind) {
    case 1630:
      return CircleDot;
    case 1631:
      return CheckCircle2;
    case 1632:
      return XCircle;
    case 1633:
      return FileEdit;
    default:
      return CircleDot;
  }
}

/**
 * Get the color class for a status kind
 * Uses theme semantic colors
 */
function getStatusColorClass(kind: number): string {
  switch (kind) {
    case 1630: // Open - neutral
      return "text-foreground";
    case 1631: // Resolved/Merged - positive
      return "text-accent";
    case 1632: // Closed - warning (less aggressive than destructive)
      return "text-warning";
    case 1633: // Draft - muted
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}

/**
 * Get the background/border classes for a status badge
 * Uses theme semantic colors
 */
function getStatusBadgeClasses(kind: number): string {
  switch (kind) {
    case 1630: // Open - neutral
      return "bg-muted/50 text-foreground border-border";
    case 1631: // Resolved/Merged - positive
      return "bg-accent/20 text-accent border-accent/30";
    case 1632: // Closed - warning (less aggressive than destructive)
      return "bg-warning/20 text-warning border-warning/30";
    case 1633: // Draft - muted
      return "bg-muted text-muted-foreground border-muted-foreground/30";
    default:
      return "bg-muted/50 text-foreground border-border";
  }
}

export interface StatusIndicatorProps {
  /** The status event kind (1630-1633) or undefined for default "open" */
  statusKind?: number;
  /** Whether status is loading */
  loading?: boolean;
  /** Event type for appropriate labeling (affects "resolved" vs "merged") */
  eventType?: "issue" | "patch" | "pr";
  /** Display variant */
  variant?: "inline" | "badge";
  /** Optional custom class */
  className?: string;
}

/**
 * Reusable status indicator for NIP-34 events (issues, patches, PRs)
 * Displays status icon and text with appropriate styling
 */
export function StatusIndicator({
  statusKind,
  loading = false,
  eventType = "issue",
  variant = "inline",
  className = "",
}: StatusIndicatorProps) {
  if (loading) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-sm text-muted-foreground ${className}`}
      >
        <Loader2 className="size-3.5 animate-spin" />
        <span>Loading...</span>
      </span>
    );
  }

  // Default to "open" if no status
  const effectiveKind = statusKind ?? 1630;

  // For patches/PRs, kind 1631 means "merged" not "resolved"
  const statusText =
    effectiveKind === 1631 && (eventType === "patch" || eventType === "pr")
      ? "merged"
      : getStatusType(effectiveKind) || "open";

  const StatusIcon = getStatusIcon(effectiveKind);

  if (variant === "badge") {
    const badgeClasses = getStatusBadgeClasses(effectiveKind);
    return (
      <span
        className={`inline-flex w-fit items-center gap-1.5 px-2 py-1 text-xs font-medium border rounded-sm ${badgeClasses} ${className}`}
      >
        <StatusIcon className="size-3.5" />
        <span className="capitalize">{statusText}</span>
      </span>
    );
  }

  // Inline variant (default)
  const colorClass = getStatusColorClass(effectiveKind);
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${className}`}>
      <StatusIcon className={`size-3 ${colorClass}`} />
      <span className={colorClass}>{statusText}</span>
    </span>
  );
}

// Re-export utilities for use in feed renderers that need just the icon/color
export { getStatusIcon, getStatusColorClass, getStatusBadgeClasses };
