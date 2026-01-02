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

  // Loading state - show code without highlighting
  if (loading) {
    return (
      <pre
        className={cn(
          "shiki-loading overflow-x-auto max-w-full font-mono text-xs",
          className,
        )}
      >
        <code className="text-foreground/70">{code}</code>
      </pre>
    );
  }

  // Error state - fallback to plain code
  if (error || !html) {
    return (
      <pre
        className={cn(
          "overflow-x-auto max-w-full font-mono text-xs",
          className,
        )}
      >
        <code>{code}</code>
      </pre>
    );
  }

  // Render highlighted HTML
  return (
    <div
      className={cn(
        "shiki-container overflow-x-auto max-w-full [&_pre]:!bg-transparent [&_code]:text-xs [&_code]:font-mono",
        showLineNumbers && "line-numbers",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
