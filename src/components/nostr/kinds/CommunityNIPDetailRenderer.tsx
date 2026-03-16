import { useMemo } from "react";
import { Copy, CopyCheck } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import { KindBadge } from "@/components/KindBadge";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/useCopy";
import { formatTimestamp } from "@/hooks/useLocale";
import { getTagValues } from "@/lib/nostr-utils";
import { toast } from "sonner";
import type { NostrEvent } from "@/types/nostr";

/**
 * Detail renderer for Kind 30817 - Community NIP
 * Displays full markdown content with NIP-specific metadata
 */
export function CommunityNIPDetailRenderer({ event }: { event: NostrEvent }) {
  const title = useMemo(
    () => getTagValue(event, "title") || "Untitled NIP",
    [event],
  );

  // Get canonical URL from "r" tag to resolve relative URLs
  const canonicalUrl = useMemo(() => {
    return getTagValue(event, "r");
  }, [event]);

  const kinds = useMemo(() => {
    return getTagValues(event, "k")
      .map(Number)
      .filter((n) => !isNaN(n));
  }, [event]);

  // Format created date using locale utility
  const createdDate = formatTimestamp(event.created_at, "long");

  // Copy functionality
  const { copy, copied } = useCopy();
  const handleCopy = () => {
    copy(event.content);
    toast.success("Community NIP markdown copied to clipboard");
  };

  return (
    <div dir="auto" className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* NIP Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        {/* Title with Copy Button */}
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-bold">{title}</h1>
          <Button
            variant="link"
            size="icon"
            onClick={handleCopy}
            title="Copy NIP markdown"
            aria-label="Copy NIP markdown"
          >
            {copied ? <CopyCheck /> : <Copy />}
          </Button>
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Proposed by</span>
            <UserName pubkey={event.pubkey} className="font-semibold" />
          </div>
          <span>•</span>
          <time>{createdDate}</time>
        </div>
      </header>

      {/* NIP Content - Markdown */}
      <MarkdownContent content={event.content} canonicalUrl={canonicalUrl} />

      {kinds.length > 0 && (
        <div className="mt-6 pt-4 border-t border-border">
          <h3 className="text-sm font-bold mb-3">
            Event Kinds Defined in {title}
          </h3>
          <div className="flex flex-wrap gap-2">
            {kinds.map((kind) => (
              <KindBadge key={kind} kind={kind} variant="full" clickable />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
