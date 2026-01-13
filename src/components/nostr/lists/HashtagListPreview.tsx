import { Hash } from "lucide-react";
import { cn } from "@/lib/utils";

interface HashtagListPreviewProps {
  hashtags: string[];
  /** Maximum number of hashtags to show in preview */
  previewLimit?: number;
  /** Label for the count */
  label?: string;
  className?: string;
}

/**
 * Compact preview of a list of hashtags
 * Shows count and optionally previews first few tags
 */
export function HashtagListPreview({
  hashtags,
  previewLimit = 5,
  label = "topics",
  className,
}: HashtagListPreviewProps) {
  if (hashtags.length === 0) {
    return (
      <div className={cn("text-xs text-muted-foreground italic", className)}>
        No {label}
      </div>
    );
  }

  const previewTags = hashtags.slice(0, previewLimit);
  const remaining = hashtags.length - previewTags.length;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1.5 text-xs">
        <Hash className="size-4 text-muted-foreground" />
        <span>
          {hashtags.length} {label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {previewTags.map((tag) => (
          <span
            key={tag}
            className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground"
          >
            #{tag}
          </span>
        ))}
        {remaining > 0 && (
          <span className="text-xs text-muted-foreground">
            +{remaining} more
          </span>
        )}
      </div>
    </div>
  );
}

interface HashtagListFullProps {
  hashtags: string[];
  /** Label for the section header */
  label?: string;
  className?: string;
}

/**
 * Full list of hashtags for detail views
 */
export function HashtagListFull({
  hashtags,
  label = "Topics",
  className,
}: HashtagListFullProps) {
  if (hashtags.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground italic", className)}>
        No {label.toLowerCase()}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <Hash className="size-5" />
        <span className="font-semibold">
          {label} ({hashtags.length})
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {hashtags.map((tag) => (
          <span
            key={tag}
            className="text-sm px-2 py-1 bg-muted rounded text-muted-foreground"
          >
            #{tag}
          </span>
        ))}
      </div>
    </div>
  );
}
