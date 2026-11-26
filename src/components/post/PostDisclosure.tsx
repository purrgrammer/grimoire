import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface PostDisclosureProps {
  /** Short label, e.g. "Tagged". Not a heading: summary drops headings. */
  label: string;
  /** One-line state next to the label: counts, pending, problems. */
  meta?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  testId?: string;
}

/**
 * A native `<details>`/`<summary>` section for the composer.
 *
 * Native so keyboard (Enter/Space), focus and the expanded state reach
 * assistive tech without ARIA wiring. Controlled, so the parent owns the open
 * state: it survives re-renders, and nothing but the user opens or closes it
 * — a lookup that answers late never expands a section on its own.
 */
export function PostDisclosure({
  label,
  meta,
  open,
  onOpenChange,
  children,
  className,
  testId,
}: PostDisclosureProps) {
  return (
    <details
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next !== open) onOpenChange(next);
      }}
      className={className}
      data-testid={testId}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="post-disclosure-chevron h-3.5 w-3.5 flex-shrink-0"
          aria-hidden="true"
        />
        <span className="text-foreground">{label}</span>
        {meta && (
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {meta}
          </span>
        )}
      </summary>
      <div className="pt-1">{children}</div>
    </details>
  );
}
