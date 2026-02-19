/**
 * Shared UI components for displaying NIP-73 external content identifiers.
 *
 * Used by:
 * - Kind 1111 (NIP-22 Comment) — root scope display
 * - Kind 30385 (NIP-85 Trusted Assertion) — external subject display
 */

import {
  getExternalIdentifierIcon,
  getExternalIdentifierLabel,
  getExternalIdentifierHref,
  inferExternalIdentifierType,
} from "@/lib/nip73-helpers";
import { cn } from "@/lib/utils";

/**
 * Inline external identifier — icon + label, optionally linked.
 * Compact version for feed renderers.
 */
export function ExternalIdentifierInline({
  value,
  kType,
  hint,
  className,
}: {
  value: string;
  kType?: string;
  hint?: string;
  className?: string;
}) {
  const type = kType || inferExternalIdentifierType(value);
  const Icon = getExternalIdentifierIcon(type);
  const label = getExternalIdentifierLabel(value, type);
  const href = getExternalIdentifierHref(value, hint);

  const content = (
    <>
      <Icon className="size-3 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );

  const base = cn(
    "flex items-center gap-1.5 text-xs overflow-hidden min-w-0",
    className,
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          base,
          "text-muted-foreground underline decoration-dotted hover:text-foreground transition-colors",
        )}
      >
        {content}
      </a>
    );
  }

  return <span className={cn(base, "text-muted-foreground")}>{content}</span>;
}

/**
 * Block-level external identifier display — icon + label in a card-like container.
 * Used in detail renderers.
 */
export function ExternalIdentifierBlock({
  value,
  kType,
  hint,
  className,
}: {
  value: string;
  kType?: string;
  hint?: string;
  className?: string;
}) {
  const type = kType || inferExternalIdentifierType(value);
  const Icon = getExternalIdentifierIcon(type);
  const label = getExternalIdentifierLabel(value, type);
  const href = getExternalIdentifierHref(value, hint);

  const inner = (
    <div
      className={cn(
        "flex items-center gap-2 p-3 rounded-md bg-muted/50",
        className,
      )}
    >
      <Icon className="size-4 text-muted-foreground flex-shrink-0" />
      <span className="text-sm break-all">{label}</span>
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:opacity-80 transition-opacity"
      >
        {inner}
      </a>
    );
  }

  return inner;
}
