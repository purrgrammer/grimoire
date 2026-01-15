/**
 * LLM Chat Viewer
 * Main component for chatting with LLM providers (OpenAI, etc.)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { Settings, Send } from "lucide-react";
import type { LLMConversation, LLMMessage, LLMConfig } from "@/types/llm";
import type { ChatMessage } from "@/lib/llm/providers/base-provider";
import { getProvider } from "@/lib/llm/providers/registry";
import { loadApiKey } from "@/services/api-key-storage";
import db from "@/services/db";
import { MessageItem } from "./llm/MessageItem";
import { ConfigPanel } from "./llm/ConfigPanel";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

interface LLMChatViewerProps {
  conversationId?: string;
  customTitle?: string;
}

// Default configuration
const DEFAULT_CONFIG: LLMConfig = {
  provider: {
    provider: "openai",
    apiKey: undefined,
  },
  model: "gpt-3.5-turbo",
  temperature: 0.7,
  maxTokens: 2000,
};

export function LLMChatViewer({
  conversationId,
  customTitle,
}: LLMChatViewerProps) {
  const [conversation, setConversation] = useState<LLMConversation | null>(
    null,
  );
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load or create conversation
  useEffect(() => {
    async function loadConversation() {
      if (conversationId) {
        // Load existing conversation
        const existing = await db.llmConversations.get(conversationId);
        if (existing) {
          setConversation(existing);
          return;
        }
      }

      // Create new conversation with saved API key if available
      const savedApiKey = loadApiKey("openai");
      const newConv: LLMConversation = {
        id: conversationId || crypto.randomUUID(),
        title: customTitle || "New Conversation",
        messages: [],
        config: {
          ...DEFAULT_CONFIG,
          provider: {
            ...DEFAULT_CONFIG.provider,
            apiKey: savedApiKey,
          },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        totalTokens: {
          prompt: 0,
          completion: 0,
          total: 0,
        },
        totalCost: 0,
      };

      await db.llmConversations.put(newConv);
      setConversation(newConv);

      // Open config if no API key
      if (!savedApiKey) {
        setConfigOpen(true);
      }
    }

    loadConversation();
  }, [conversationId, customTitle]);

  // Save conversation when it changes
  useEffect(() => {
    if (conversation) {
      db.llmConversations.put(conversation);
    }
  }, [conversation]);

  // Handle sending a message
  const handleSend = useCallback(async () => {
    if (!conversation || !input.trim() || isStreaming) return;
    if (!conversation.config.provider.apiKey) {
      setConfigOpen(true);
      return;
    }

    const userMessage: LLMMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    };

    const assistantMessage: LLMMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      streaming: true,
    };

    // Update conversation with user message and empty assistant message
    const updatedMessages = [
      ...conversation.messages,
      userMessage,
      assistantMessage,
    ];
    const updatedConv = {
      ...conversation,
      messages: updatedMessages,
      title:
        conversation.messages.length === 0
          ? input.trim().slice(0, 50)
          : conversation.title,
      updatedAt: Date.now(),
    };

    setConversation(updatedConv);
    setInput("");
    setIsStreaming(true);

    // Scroll to bottom
    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: updatedMessages.length - 1,
        behavior: "smooth",
      });
    }, 100);

    // Stream response
    try {
      const provider = getProvider(conversation.config.provider.provider);

      // Build message history for API
      const chatMessages: ChatMessage[] = updatedMessages
        .filter((m) => m.role !== "system" || m.content.trim())
        .map((m) => ({
          role: m.role,
          content: m.content,
        }));

      // Add system prompt if configured
      if (conversation.config.systemPrompt?.trim()) {
        chatMessages.unshift({
          role: "system",
          content: conversation.config.systemPrompt.trim(),
        });
      }

      let accumulatedContent = "";
      let tokens:
        | { prompt: number; completion: number; total: number }
        | undefined;

      for await (const chunk of provider.streamCompletion(
        chatMessages.slice(0, -1), // Exclude empty assistant message
        conversation.config,
      )) {
        if (chunk.error) {
          // Update assistant message with error
          const errorMessages = updatedMessages.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, error: chunk.error, streaming: false }
              : m,
          );
          setConversation({
            ...updatedConv,
            messages: errorMessages,
          });
          break;
        }

        if (chunk.text) {
          accumulatedContent += chunk.text;

          // Update assistant message with accumulated content
          const streamingMessages = updatedMessages.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, content: accumulatedContent }
              : m,
          );
          setConversation({
            ...updatedConv,
            messages: streamingMessages,
          });
        }

        if (chunk.usage) {
          tokens = chunk.usage;
        }

        if (chunk.done) {
          // Finalize assistant message
          const finalMessage: LLMMessage = {
            ...assistantMessage,
            content: accumulatedContent,
            streaming: false,
            tokens,
            model: conversation.config.model,
            provider: conversation.config.provider.provider,
          };

          // Calculate cost if we have a model
          if (tokens) {
            try {
              const models = await provider.getModels(
                conversation.config.provider,
              );
              const model = models.find(
                (m) => m.id === conversation.config.model,
              );
              if (model) {
                finalMessage.cost = provider.calculateCost(model, {
                  prompt: tokens.prompt,
                  completion: tokens.completion,
                });
              }
            } catch (error) {
              console.error("Failed to calculate cost:", error);
            }
          }

          const finalMessages = updatedMessages.map((m) =>
            m.id === assistantMessage.id ? finalMessage : m,
          );

          // Update total tokens and cost
          const newTotalTokens = {
            prompt: conversation.totalTokens.prompt + (tokens?.prompt || 0),
            completion:
              conversation.totalTokens.completion + (tokens?.completion || 0),
            total: conversation.totalTokens.total + (tokens?.total || 0),
          };

          const newTotalCost =
            conversation.totalCost + (finalMessage.cost || 0);

          setConversation({
            ...updatedConv,
            messages: finalMessages,
            totalTokens: newTotalTokens,
            totalCost: newTotalCost,
            updatedAt: Date.now(),
          });

          break;
        }
      }
    } catch (error) {
      console.error("Failed to stream response:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorMessages = updatedMessages.map((m) =>
        m.id === assistantMessage.id
          ? { ...m, error: errorMessage, streaming: false }
          : m,
      );
      setConversation({
        ...updatedConv,
        messages: errorMessages,
      });
    } finally {
      setIsStreaming(false);
    }
  }, [conversation, input, isStreaming]);

  // Handle config changes
  const handleConfigChange = useCallback(
    (newConfig: LLMConfig) => {
      if (conversation) {
        setConversation({
          ...conversation,
          config: newConfig,
        });
      }
    },
    [conversation],
  );

  // Handle clear conversation
  const handleClear = useCallback(() => {
    if (conversation) {
      setConversation({
        ...conversation,
        messages: [],
        totalTokens: { prompt: 0, completion: 0, total: 0 },
        totalCost: 0,
        updatedAt: Date.now(),
      });
      setConfigOpen(false);
    }
  }, [conversation]);

  // Handle copy message
  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  // Handle regenerate (remove last assistant message and re-send)
  const handleRegenerate = useCallback(() => {
    if (!conversation || isStreaming) return;

    const messages = conversation.messages;
    const lastMessage = messages[messages.length - 1];

    if (lastMessage?.role === "assistant") {
      // Remove last assistant message
      const withoutLast = messages.slice(0, -1);

      // Find the user message before it
      const lastUserMessage = [...withoutLast]
        .reverse()
        .find((m) => m.role === "user");

      if (lastUserMessage) {
        setConversation({
          ...conversation,
          messages: withoutLast,
        });
        setInput(lastUserMessage.content);
        setTimeout(() => handleSend(), 100);
      }
    }
  }, [conversation, isStreaming, handleSend]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isStreaming) {
        e.preventDefault();
        handleSend();
      }
    },
    [isStreaming, handleSend],
  );

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading conversation...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-semibold">
            {customTitle || conversation.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {conversation.totalTokens.total.toLocaleString()} tokens
            {conversation.totalCost > 0 && (
              <> • ${conversation.totalCost.toFixed(4)}</>
            )}
          </div>
        </div>

        {/* Config button */}
        <Dialog open={configOpen} onOpenChange={setConfigOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              <Settings className="size-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Configuration</DialogTitle>
            </DialogHeader>
            <ConfigPanel
              config={conversation.config}
              onChange={handleConfigChange}
              onClear={handleClear}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        {conversation.messages.length > 0 ? (
          <Virtuoso
            ref={virtuosoRef}
            data={conversation.messages}
            initialTopMostItemIndex={conversation.messages.length - 1}
            followOutput="smooth"
            itemContent={(_index, message) => (
              <MessageItem
                key={message.id}
                message={message}
                onCopy={handleCopy}
                onRegenerate={
                  message.role === "assistant" &&
                  message.id ===
                    conversation.messages[conversation.messages.length - 1]?.id
                    ? handleRegenerate
                    : undefined
                }
              />
            )}
            style={{ height: "100%" }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <p>No messages yet.</p>
            {!conversation.config.provider.apiKey && (
              <Button
                onClick={() => setConfigOpen(true)}
                variant="outline"
                size="sm"
              >
                Configure API Key
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Cmd/Ctrl+Enter to send)"
            rows={1}
            className="min-h-[2.5rem] max-h-32 resize-none"
            disabled={isStreaming}
          />
          <Button
            onClick={handleSend}
            disabled={
              !input.trim() ||
              isStreaming ||
              !conversation.config.provider.apiKey
            }
            className="h-[2.5rem] flex-shrink-0"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
