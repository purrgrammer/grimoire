/**
 * AIChat - Conversation view with message timeline and input
 */

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { Loader2, User, Bot, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aiService } from "@/services/ai-service";
import type { AIConversation, AIMessage } from "@/services/db";
import { AIMessageContent } from "./AIMessageContent";

interface AIChatProps {
  conversation: AIConversation;
  onConversationUpdate?: (conversation: AIConversation) => void;
}

/**
 * Format timestamp for display
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format date for day markers
 */
function formatDayMarker(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const todayOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const yesterdayOnly = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  );

  if (dateOnly.getTime() === todayOnly.getTime()) return "Today";
  if (dateOnly.getTime() === yesterdayOnly.getTime()) return "Yesterday";

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Check if two timestamps are on different days
 */
function isDifferentDay(t1: number, t2: number): boolean {
  const d1 = new Date(t1);
  const d2 = new Date(t2);
  return (
    d1.getFullYear() !== d2.getFullYear() ||
    d1.getMonth() !== d2.getMonth() ||
    d1.getDate() !== d2.getDate()
  );
}

/**
 * Single message component
 */
const MessageItem = memo(function MessageItem({
  message,
}: {
  message: AIMessage;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 px-4 py-3 ${isUser ? "bg-muted/30" : ""}`}>
      <div
        className={`flex-shrink-0 size-7 rounded-full flex items-center justify-center ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {isUser ? "You" : "Assistant"}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTime(message.timestamp)}
          </span>
          {message.isStreaming && (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <AIMessageContent
          content={message.content}
          isStreaming={message.isStreaming}
        />
      </div>
    </div>
  );
});

export function AIChat({ conversation, onConversationUpdate }: AIChatProps) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load messages on conversation change
  useEffect(() => {
    loadMessages();
  }, [conversation.id]);

  const loadMessages = useCallback(async () => {
    const loaded = await aiService.getMessages(conversation.id);
    setMessages(loaded);
  }, [conversation.id]);

  // Poll for updates when streaming
  useEffect(() => {
    const hasStreaming = messages.some((m) => m.isStreaming);
    if (!hasStreaming) return;

    const interval = setInterval(async () => {
      const loaded = await aiService.getMessages(conversation.id);
      setMessages(loaded);

      // Check if still streaming
      const stillStreaming = loaded.some((m) => m.isStreaming);
      if (!stillStreaming) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [messages, conversation.id]);

  // Process messages for day markers
  const messagesWithMarkers = messages.reduce<
    Array<
      | { type: "message"; data: AIMessage }
      | { type: "day-marker"; data: string; timestamp: number }
    >
  >((acc, message, index) => {
    if (index === 0) {
      acc.push({
        type: "day-marker",
        data: formatDayMarker(message.timestamp),
        timestamp: message.timestamp,
      });
    } else {
      const prev = messages[index - 1];
      if (isDifferentDay(prev.timestamp, message.timestamp)) {
        acc.push({
          type: "day-marker",
          data: formatDayMarker(message.timestamp),
          timestamp: message.timestamp,
        });
      }
    }
    acc.push({ type: "message", data: message });
    return acc;
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isSending) return;

    const content = input.trim();
    setInput("");
    setError(null);
    setIsSending(true);

    // Optimistically add user message
    const userMessage: AIMessage = {
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      await aiService.sendMessage(
        conversation.id,
        content,
        (_chunk, fullContent) => {
          // Update messages as chunks arrive
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.isStreaming) {
              return [...prev.slice(0, -1), { ...last, content: fullContent }];
            }
            // Create new assistant message
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                conversationId: conversation.id,
                role: "assistant",
                content: fullContent,
                timestamp: Date.now(),
                isStreaming: true,
              },
            ];
          });
        },
      );

      // Reload messages to get final state
      await loadMessages();

      // Notify parent of update (for title changes)
      const updatedConv = await aiService.getConversation(conversation.id);
      if (updatedConv && onConversationUpdate) {
        onConversationUpdate(updatedConv);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      // Reload messages to get actual state
      await loadMessages();
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, conversation.id, loadMessages, onConversationUpdate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Auto-resize textarea
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      // Auto-resize
      const textarea = e.target;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    },
    [],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Message Timeline */}
      <div className="flex-1 overflow-hidden">
        {messagesWithMarkers.length > 0 ? (
          <Virtuoso
            ref={virtuosoRef}
            data={messagesWithMarkers}
            initialTopMostItemIndex={messagesWithMarkers.length - 1}
            followOutput="smooth"
            alignToBottom
            itemContent={(_index, item) => {
              if (item.type === "day-marker") {
                return (
                  <div className="flex justify-center py-2">
                    <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {item.data}
                    </span>
                  </div>
                );
              }
              return <MessageItem message={item.data} />;
            }}
            style={{ height: "100%" }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <p className="text-sm">Start a conversation...</p>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          <span className="flex-1">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={isSending}
            rows={1}
            className="flex-1 resize-none rounded border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            style={{ minHeight: "40px", maxHeight: "200px" }}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            size="sm"
            className="self-end"
          >
            {isSending ? <Loader2 className="size-4 animate-spin" /> : "Send"}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
