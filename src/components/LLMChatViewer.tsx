/**
 * LLMChatViewer - AI chat interface using generic chat components
 * Demonstrates how the same UI components work for LLM chat vs Nostr chat
 */

import { useState, useCallback, useMemo, memo } from "react";
import {
  Bot,
  User,
  AlertCircle,
  Loader2,
  Settings,
  Copy,
  Check,
} from "lucide-react";
import { ChatWindow, insertDayMarkers } from "./chat/shared";
import type { ChatLoadingState } from "./chat/shared";
import type { LLMMessage, LLMConversation } from "@/lib/llm/types";
import { MockProviderAdapter } from "@/lib/llm/providers/mock-provider";
import { useCopy } from "@/hooks/useCopy";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

interface LLMChatViewerProps {
  conversationId?: string;
}

/**
 * Message renderer for LLM messages
 */
const LLMMessageRenderer = memo(function LLMMessageRenderer({
  message,
}: {
  message: LLMMessage;
}) {
  const { copy, copied } = useCopy();

  // System messages have special styling
  if (message.role === "system") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded text-xs text-muted-foreground">
        <AlertCircle className="size-3" />
        <span>System: {message.content}</span>
      </div>
    );
  }

  // User messages align right
  if (message.role === "user") {
    return (
      <div className="flex justify-end px-3 py-2">
        <div className="max-w-[80%] bg-primary text-primary-foreground rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <User className="size-3" />
            <span className="text-xs font-medium">You</span>
          </div>
          <div className="text-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // Assistant messages align left with streaming support
  return (
    <div className="group flex px-3 py-2 hover:bg-muted/30">
      <div className="max-w-[80%]">
        <div className="flex items-center gap-2 mb-1">
          <Bot className="size-3" />
          <span className="text-xs font-medium">Assistant</span>
          {message.model && (
            <span className="text-xs text-muted-foreground">
              ({message.model})
            </span>
          )}
          {message.streaming && <Loader2 className="size-3 animate-spin" />}
        </div>
        <div className="text-sm whitespace-pre-wrap break-words prose prose-sm dark:prose-invert max-w-none">
          {message.content}
          {message.error && (
            <div className="text-destructive mt-2 text-xs">
              Error: {message.error}
            </div>
          )}
        </div>
        {message.tokens && (
          <div className="text-xs text-muted-foreground mt-1">
            {message.tokens} tokens
            {message.cost &&
              message.cost > 0 &&
              ` • $${message.cost.toFixed(4)}`}
          </div>
        )}
        <button
          onClick={() => copy(message.content)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground mt-1"
          title="Copy message"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
    </div>
  );
});

/**
 * LLMChatViewer - Main component
 */
export function LLMChatViewer({ conversationId }: LLMChatViewerProps) {
  // Initialize provider (in real app, this would come from state/context)
  const [provider] = useState(() => new MockProviderAdapter());

  // Conversation state
  const [conversation, setConversation] = useState<LLMConversation>({
    id: conversationId || "default",
    title: "New Conversation",
    messages: [],
    settings: {
      provider: "mock",
      model: "mock-fast",
      temperature: 0.7,
      maxTokens: 2000,
    },
    createdAt: Date.now() / 1000,
    updatedAt: Date.now() / 1000,
    totalTokens: 0,
    totalCost: 0,
  });

  const [loadingState] = useState<ChatLoadingState>("success");
  const [isSending, setIsSending] = useState(false);

  // Process messages to include day markers (reusing generic utility!)
  const messagesWithMarkers = useMemo(
    () => insertDayMarkers(conversation.messages),
    [conversation.messages],
  );

  // Handle sending a message
  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || isSending) return;

      setIsSending(true);

      // Add user message
      const userMessage: LLMMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: content.trim(),
        timestamp: Date.now() / 1000,
      };

      setConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        updatedAt: Date.now() / 1000,
      }));

      try {
        // Create streaming assistant message
        const streamingMessage: LLMMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: "",
          timestamp: Date.now() / 1000,
          streaming: true,
          model: conversation.settings.model,
        };

        setConversation((prev) => ({
          ...prev,
          messages: [...prev.messages, streamingMessage],
        }));

        // Get response from provider with streaming
        const response = await provider.sendMessage(
          [...conversation.messages, userMessage],
          conversation.settings,
          (chunk) => {
            // Update streaming message with new content
            setConversation((prev) => {
              const messages = [...prev.messages];
              const lastMessage = messages[messages.length - 1];
              if (lastMessage.streaming) {
                messages[messages.length - 1] = {
                  ...lastMessage,
                  content: lastMessage.content + chunk.content,
                  streaming: !chunk.done,
                  tokens: chunk.tokens,
                };
              }
              return { ...prev, messages };
            });
          },
        );

        // Update with final response
        setConversation((prev) => {
          const messages = [...prev.messages];
          messages[messages.length - 1] = response;
          return {
            ...prev,
            messages,
            totalTokens: prev.totalTokens + (response.tokens || 0),
            totalCost: prev.totalCost + (response.cost || 0),
          };
        });
      } catch (error) {
        console.error("Failed to send message:", error);
        // Add error message
        setConversation((prev) => {
          const messages = [...prev.messages];
          messages[messages.length - 1] = {
            ...messages[messages.length - 1],
            streaming: false,
            error:
              error instanceof Error ? error.message : "Failed to get response",
          };
          return { ...prev, messages };
        });
      } finally {
        setIsSending(false);
      }
    },
    [conversation, provider, isSending],
  );

  // Render message function
  const renderMessage = useCallback(
    (message: LLMMessage) => (
      <LLMMessageRenderer key={message.id} message={message} />
    ),
    [],
  );

  // Header with model selection
  const header = (
    <div className="flex items-center gap-2">
      <Bot className="size-4" />
      <span className="text-sm font-semibold">{conversation.title}</span>
      <div className="ml-auto flex items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-xs text-muted-foreground">
                {conversation.totalTokens.toLocaleString()} tokens
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Total tokens used in this conversation</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );

  // Header suffix with model selector and settings
  const headerSuffix = (
    <>
      <div className="text-xs px-2 py-1 bg-muted rounded">
        {
          provider.provider.models.find(
            (m) => m.id === conversation.settings.model,
          )?.name
        }
      </div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7">
              <Settings className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              <div>Model: {conversation.settings.model}</div>
              <div>Temperature: {conversation.settings.temperature}</div>
              <div>Max tokens: {conversation.settings.maxTokens}</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );

  return (
    <ChatWindow
      loadingState={loadingState}
      header={header}
      headerSuffix={headerSuffix}
      messages={messagesWithMarkers}
      renderMessage={renderMessage}
      emptyState={
        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Bot className="size-12" />
          <p className="text-sm">Start a conversation with the AI</p>
        </div>
      }
      composer={{
        placeholder: "Type your message...",
        isSending,
        onSubmit: handleSend,
      }}
    />
  );
}
