import { memo } from "react";
import type { NostrEvent } from "@/types/nostr";
import { useCopy } from "@/hooks/useCopy";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import { CodeCopyButton } from "@/components/CodeCopyButton";

interface JsonEventRowProps {
  event: NostrEvent;
}

/**
 * JSON view for a single event
 * Shows syntax-highlighted, copyable JSON
 */
export function JsonEventRow({ event }: JsonEventRowProps) {
  const { copy, copied } = useCopy();
  const jsonString = JSON.stringify(event, null, 2);

  return (
    <div className="border-b border-border/50 last:border-0 relative group">
      {/* Event ID header for reference */}
      <div className="px-3 py-1.5 bg-muted/30 border-b border-border/30 flex items-center justify-between">
        <code className="text-xs text-muted-foreground font-mono">
          {event.id.slice(0, 16)}...
        </code>
        <span className="text-xs text-muted-foreground">kind {event.kind}</span>
      </div>

      {/* JSON content */}
      <SyntaxHighlight
        code={jsonString}
        language="json"
        className="p-3 pr-12 text-xs"
      />

      {/* Copy button - visible on hover */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        <CodeCopyButton
          onCopy={() => copy(jsonString)}
          copied={copied}
          label="Copy event JSON"
        />
      </div>
    </div>
  );
}

// Memoized version for scroll performance
export const MemoizedJsonEventRow = memo(
  JsonEventRow,
  (prev, next) => prev.event.id === next.event.id,
);
