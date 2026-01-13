import { Link, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface UrlListPreviewProps {
  urls: string[];
  /** Maximum number of URLs to show */
  previewLimit?: number;
  /** Label for the count */
  label?: string;
  className?: string;
}

/**
 * Compact preview of a URL list
 */
export function UrlListPreview({
  urls,
  previewLimit = 2,
  label = "links",
  className,
}: UrlListPreviewProps) {
  if (urls.length === 0) {
    return null;
  }

  const previewUrls = urls.slice(0, previewLimit);
  const remaining = urls.length - previewUrls.length;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1.5 text-xs">
        <Link className="size-4 text-muted-foreground" />
        <span>
          {urls.length} {label}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {previewUrls.map((url) => (
          <UrlItem key={url} url={url} compact />
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

interface UrlItemProps {
  url: string;
  compact?: boolean;
}

/**
 * Single clickable URL
 */
export function UrlItem({ url, compact }: UrlItemProps) {
  // Extract domain for display
  let displayUrl: string;
  try {
    const parsed = new URL(url);
    displayUrl = compact ? parsed.hostname : url;
  } catch {
    displayUrl = url;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-1.5 text-accent hover:underline hover:decoration-dotted truncate",
        compact ? "text-xs" : "text-sm",
      )}
    >
      <ExternalLink
        className={cn(compact ? "size-3" : "size-3.5", "flex-shrink-0")}
      />
      <span className="truncate">{displayUrl}</span>
    </a>
  );
}

interface UrlListFullProps {
  urls: string[];
  /** Label for the section header */
  label?: string;
  className?: string;
}

/**
 * Full list of URLs for detail views
 */
export function UrlListFull({
  urls,
  label = "Links",
  className,
}: UrlListFullProps) {
  if (urls.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground italic", className)}>
        No links
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <Link className="size-5" />
        <span className="font-semibold">
          {label} ({urls.length})
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {urls.map((url) => (
          <UrlItem key={url} url={url} />
        ))}
      </div>
    </div>
  );
}
