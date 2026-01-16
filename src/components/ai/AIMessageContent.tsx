/**
 * AIMessageContent - Renders AI message content with markdown support
 */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface AIMessageContentProps {
  content: string;
  isStreaming?: boolean;
}

export const AIMessageContent = memo(function AIMessageContent({
  content,
  isStreaming,
}: AIMessageContentProps) {
  if (!content) {
    return isStreaming ? (
      <span className="text-muted-foreground animate-pulse">Thinking...</span>
    ) : null;
  }

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        isStreaming && "animate-pulse-subtle",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom code block styling
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded bg-muted p-3 text-sm">
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="rounded bg-muted px-1.5 py-0.5 text-sm"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {children}
            </a>
          ),
          // Lists
          ul: ({ children }) => (
            <ul className="list-disc pl-4 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-4 space-y-1">{children}</ol>
          ),
          // Paragraphs
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          // Headings
          h1: ({ children }) => (
            <h1 className="text-lg font-bold mb-2">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-bold mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-bold mb-1">{children}</h3>
          ),
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-medium bg-muted">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
