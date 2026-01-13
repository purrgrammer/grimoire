import { Type } from "lucide-react";
import { cn } from "@/lib/utils";

interface WordListPreviewProps {
  words: string[];
  /** Maximum number of words to show */
  previewLimit?: number;
  /** Label for the count */
  label?: string;
  className?: string;
}

/**
 * Compact preview of a word list (e.g., muted words)
 */
export function WordListPreview({
  words,
  previewLimit = 3,
  label = "words",
  className,
}: WordListPreviewProps) {
  if (words.length === 0) {
    return null; // Don't show anything if no words
  }

  const previewWords = words.slice(0, previewLimit);
  const remaining = words.length - previewWords.length;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1.5 text-xs">
        <Type className="size-4 text-muted-foreground" />
        <span>
          {words.length} muted {label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {previewWords.map((word) => (
          <span
            key={word}
            className="text-xs px-1.5 py-0.5 bg-destructive/10 text-destructive rounded font-mono"
          >
            {word}
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

interface WordListFullProps {
  words: string[];
  /** Label for the section header */
  label?: string;
  className?: string;
}

/**
 * Full list of words for detail views
 */
export function WordListFull({
  words,
  label = "Muted Words",
  className,
}: WordListFullProps) {
  if (words.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground italic", className)}>
        No muted words
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <Type className="size-5" />
        <span className="font-semibold">
          {label} ({words.length})
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {words.map((word) => (
          <span
            key={word}
            className="text-sm px-2 py-1 bg-destructive/10 text-destructive rounded font-mono"
          >
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}
