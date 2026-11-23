import { useNip } from "@/hooks/useNip";
import { MarkdownContent } from "./nostr/MarkdownContent";
import { KindBadge } from "./KindBadge";
import { getKindsForNip } from "@/lib/nip-kinds";
import { CenteredContent } from "./ui/CenteredContent";
import { cn } from "@/lib/utils";

interface NipRendererProps {
  nipId: string;
  className?: string;
}

export function NipRenderer({ nipId, className = "" }: NipRendererProps) {
  const { content, loading, error } = useNip(nipId);
  const kinds = getKindsForNip(nipId);

  if (loading) {
    return (
      <CenteredContent
        className={cn("text-muted-foreground text-sm", className)}
      >
        Loading NIP-{nipId}...
      </CenteredContent>
    );
  }

  if (error) {
    return (
      <CenteredContent className={cn("text-destructive text-sm", className)}>
        Error loading NIP-{nipId}: {error.message}
      </CenteredContent>
    );
  }

  if (!content) {
    return null;
  }

  return (
    <CenteredContent className={cn("overflow-x-hidden", className)}>
      <MarkdownContent content={content} />

      {kinds.length > 0 && (
        <div className="mt-6 pt-4 border-t border-border">
          <h3 className="text-sm font-bold mb-3">
            Event Kinds Defined in NIP-{nipId}
          </h3>
          <div className="flex flex-wrap gap-2">
            {kinds.map((kind) => (
              <KindBadge key={kind} kind={kind} variant="full" clickable />
            ))}
          </div>
        </div>
      )}
    </CenteredContent>
  );
}
