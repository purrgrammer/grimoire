import { useHighlightedCode } from "@/hooks/useHighlightedCode";
import { cn } from "@/lib/utils";

interface SyntaxHighlightProps {
  code: string;
  language?: string | null;
  className?: string;
  showLineNumbers?: boolean;
}

/**
 * Syntax highlighting component using Shiki with lazy language loading
 *
 * Languages are loaded on-demand - the first render of a new language
 * will show a brief loading state while the grammar is fetched.
 *
 * @example
 * ```tsx
 * <SyntaxHighlight code={patchContent} language="diff" />
 * <SyntaxHighlight code={jsonStr} language="json" />
 * <SyntaxHighlight code={snippet} language="python" />
 * ```
 */
export function SyntaxHighlight({
  code,
  language,
  className = "",
  showLineNumbers = false,
}: SyntaxHighlightProps) {
  const { html, loading, error } = useHighlightedCode(code, language);

  // Use consistent wrapper structure for all states to avoid size jumps
  const wrapperClasses = cn(
    "shiki-container overflow-x-auto max-w-full [&_pre]:!bg-transparent [&_pre]:!m-0 [&_code]:text-xs [&_code]:font-mono",
    showLineNumbers && "line-numbers",
    className,
  );

  // Loading state - show code without highlighting
  if (loading) {
    return (
      <div className={cn(wrapperClasses, "shiki-loading")}>
        <pre className="!bg-transparent !m-0">
          <code className="text-foreground/70">{code}</code>
        </pre>
      </div>
    );
  }

  // Error state - fallback to plain code
  if (error || !html) {
    return (
      <div className={wrapperClasses}>
        <pre className="!bg-transparent !m-0">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  // Render highlighted HTML
  return (
    <div
      className={wrapperClasses}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
