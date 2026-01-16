/**
 * LLMChatViewer - AI chat interface using generic chat components
 * Demonstrates how the same UI components work for LLM chat vs Nostr chat
 */

import { useState, useCallback, useMemo, memo, useEffect } from "react";
import { Bot, User, AlertCircle, Loader2, Copy, Check } from "lucide-react";
import { ChatWindow, insertDayMarkers } from "./chat/shared";
import type { ChatLoadingState } from "./chat/shared";
import type { LLMMessage, LLMConversation } from "@/lib/llm/types";
import type { LLMProviderAdapter } from "@/lib/llm/types";
import {
  loadProviderConfig,
  createProviderAdapter,
  getDefaultModel,
  getProviderById,
  type ProviderConfig,
} from "@/lib/llm/provider-manager";
import { LLMSettingsDialog } from "./LLMSettingsDialog";
import { useCopy } from "@/hooks/useCopy";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { toast } from "sonner";

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
  // Provider configuration
  const [providerConfig, setProviderConfig] =
    useState<ProviderConfig>(loadProviderConfig);
  const [provider, setProvider] = useState<LLMProviderAdapter | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);

  // Initialize provider
  useEffect(() => {
    try {
      const adapter = createProviderAdapter(providerConfig);
      setProvider(adapter);
      setProviderError(null);
    } catch (error) {
      setProviderError(
        error instanceof Error
          ? error.message
          : "Failed to initialize provider",
      );
      setProvider(null);
      toast.error("Provider Error", {
        description:
          error instanceof Error
            ? error.message
            : "Failed to initialize provider",
      });
    }
  }, [providerConfig]);

  // Conversation state
  const [conversation, setConversation] = useState<LLMConversation>(() => {
    const defaultModel = getDefaultModel(providerConfig.providerId);
    return {
      id: conversationId || "default",
      title: "New Conversation",
      messages: [],
      settings: {
        provider: providerConfig.providerId,
        model: defaultModel,
        temperature: 0.7,
        maxTokens: 2000,
      },
      createdAt: Date.now() / 1000,
      updatedAt: Date.now() / 1000,
      totalTokens: 0,
      totalCost: 0,
    };
  });

  const [loadingState] = useState<ChatLoadingState>("success");
  const [isSending, setIsSending] = useState(false);

  // Update conversation model when provider changes
  useEffect(() => {
    if (provider) {
      const defaultModel = getDefaultModel(providerConfig.providerId);
      setConversation((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          provider: providerConfig.providerId,
          model: defaultModel,
        },
      }));
    }
  }, [provider, providerConfig.providerId]);

  // Handle provider settings change
  const handleSettingsChange = useCallback((newConfig: ProviderConfig) => {
    setProviderConfig(newConfig);
  }, []);

  // Process messages to include day markers (reusing generic utility!)
  const messagesWithMarkers = useMemo(
    () => insertDayMarkers(conversation.messages),
    [conversation.messages],
  );

  // Handle sending a message
  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || isSending || !provider) return;

      if (providerError) {
        toast.error("Cannot send message", {
          description: providerError,
        });
        return;
      }

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
    [conversation, provider, isSending, providerError],
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

  // Get current provider info
  const currentProviderInfo = getProviderById(providerConfig.providerId);

  // Header suffix with model selector and settings
  const headerSuffix = provider && (
    <>
      {/* Model Selector */}
      <Select
        value={conversation.settings.model}
        onValueChange={(model: string) =>
          setConversation((prev) => ({
            ...prev,
            settings: { ...prev.settings, model },
          }))
        }
      >
        <SelectTrigger className="h-7 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {provider.provider.models.map((model) => (
            <SelectItem key={model.id} value={model.id} className="text-xs">
              {model.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Settings Dialog */}
      <LLMSettingsDialog onSettingsChange={handleSettingsChange} />
    </>
  );

  // Show provider info in empty state
  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground p-4">
      <Bot className="size-12" />
      {providerError ? (
        <>
          <p className="text-sm text-destructive font-medium">
            {providerError}
          </p>
          <p className="text-xs text-center max-w-md">
            Click the settings icon in the header to configure your provider and
            API key.
          </p>
        </>
      ) : !provider ? (
        <>
          <p className="text-sm">Initializing provider...</p>
        </>
      ) : (
        <>
          <p className="text-sm">Start a conversation with the AI</p>
          <p className="text-xs text-center max-w-md">
            Provider: {currentProviderInfo?.name || "Unknown"}
            {conversation.settings.model &&
              ` • ${provider.provider.models.find((m) => m.id === conversation.settings.model)?.name || conversation.settings.model}`}
          </p>
        </>
      )}
    </div>
  );

  return (
    <ChatWindow
      loadingState={loadingState}
      header={header}
      headerSuffix={headerSuffix}
      messages={messagesWithMarkers}
      renderMessage={renderMessage}
      emptyState={emptyState}
      composer={{
        placeholder: "Type your message...",
        isSending,
        disabled: !provider || !!providerError,
        disabledMessage: providerError || "Provider not initialized",
        onSubmit: handleSend,
      }}
    />
  );
}
