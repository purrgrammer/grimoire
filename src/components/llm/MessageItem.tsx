/**
 * LLM Message Item Component
 * Renders a single message in the LLM chat
 */

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LLMMessage } from "@/types/llm";
import Timestamp from "@/components/Timestamp";
import { Copy } from "lucide-react";

interface MessageItemProps {
  message: LLMMessage;
  onCopy?: (content: string) => void;
  onRegenerate?: () => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  onCopy,
  onRegenerate,
}: MessageItemProps) {
  // System messages have special styling
  if (message.role === "system") {
    return (
      <div className="flex items-center justify-center px-3 py-2">
        <div className="rounded bg-muted px-3 py-1 text-xs text-muted-foreground">
          System: {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";
  const isStreaming = message.streaming;
  const hasError = !!message.error;

  return (
    <div
      className={`group flex px-3 py-3 ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`flex max-w-[85%] flex-col gap-1 ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        {/* Message bubble */}
        <div
          className={`rounded-lg px-4 py-2 ${
            isUser
              ? "bg-primary text-primary-foreground"
              : hasError
                ? "bg-destructive/10 text-destructive"
                : "bg-muted"
          }`}
        >
          {hasError ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">Error</p>
              <p className="text-sm">{message.error}</p>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Code block styling
                  pre: ({ node, ...props }) => (
                    <pre
                      {...props}
                      className="overflow-x-auto rounded bg-black/10 p-3 text-xs dark:bg-white/10"
                    />
                  ),
                  code: ({ node, className, ...props }) => {
                    const isInline = !className?.includes("language-");
                    return isInline ? (
                      <code
                        {...props}
                        className="rounded bg-black/10 px-1 py-0.5 text-xs dark:bg-white/10"
                      />
                    ) : (
                      <code {...props} className="text-xs" />
                    );
                  },
                  // Link styling
                  a: ({ node, ...props }) => (
                    <a
                      {...props}
                      className="text-primary underline hover:no-underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block h-4 w-2 animate-pulse bg-current" />
              )}
            </div>
          )}
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Timestamp timestamp={message.timestamp} />

          {/* Token usage */}
          {message.tokens && (
            <>
              <span>•</span>
              <span>{message.tokens.total.toLocaleString()} tokens</span>
            </>
          )}

          {/* Cost */}
          {message.cost !== undefined && message.cost > 0 && (
            <>
              <span>•</span>
              <span>${message.cost.toFixed(4)}</span>
            </>
          )}

          {/* Action buttons (on hover) */}
          {!isStreaming && !hasError && (
            <div className="ml-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {onCopy && (
                <button
                  onClick={() => onCopy(message.content)}
                  className="rounded p-1 hover:bg-muted"
                  title="Copy message"
                >
                  <Copy className="size-3" />
                </button>
              )}
              {!isUser && onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="rounded px-2 py-1 text-xs hover:bg-muted"
                  title="Regenerate response"
                >
                  Regenerate
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
