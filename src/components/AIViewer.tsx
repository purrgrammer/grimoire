/**
 * AIViewer - Local LLM Chat Interface
 *
 * Provides a chat interface for local (WebLLM) and remote (PPQ) LLM providers.
 * Uses sidebar pattern from GroupListViewer for conversation history.
 */

import { useState, useEffect, useCallback, useRef, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  PanelLeft,
  Plus,
  Send,
  Square,
  Trash2,
  Download,
  Check,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  useLLMProviders,
  useLLMModels,
  useWebLLMStatus,
  useLLMConversations,
  useLLMConversation,
  useLLMChat,
} from "@/hooks/useLLM";
import { formatTimestamp } from "@/hooks/useLocale";
import { AIProvidersViewer } from "./AIProvidersViewer";
import type { LLMMessage, LLMModel } from "@/types/llm";

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

// ─────────────────────────────────────────────────────────────
// Message Component
// ─────────────────────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  message,
}: {
  message: LLMMessage;
}) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ ...props }) => (
                  <p className="mb-2 last:mb-0" {...props} />
                ),
                code: ({ className, children, ...props }: any) => {
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    return (
                      <pre className="bg-background/50 p-2 rounded text-xs overflow-x-auto my-2">
                        <code {...props}>{children}</code>
                      </pre>
                    );
                  }
                  return (
                    <code
                      className="bg-background/50 px-1 py-0.5 rounded text-xs"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => <>{children}</>,
                ul: ({ ...props }) => (
                  <ul
                    className="list-disc list-inside my-2 space-y-1"
                    {...props}
                  />
                ),
                ol: ({ ...props }) => (
                  <ol
                    className="list-decimal list-inside my-2 space-y-1"
                    {...props}
                  />
                ),
                a: ({ href, children, ...props }) => (
                  <a
                    href={href}
                    className="text-accent underline"
                    target="_blank"
                    rel="noopener noreferrer"
                    {...props}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
// Thinking Indicator
// ─────────────────────────────────────────────────────────────

const ThinkingIndicator = memo(function ThinkingIndicator() {
  return (
    <div className="flex w-full justify-start">
      <div className="bg-muted text-foreground rounded-lg px-3 py-2 text-sm flex items-center gap-2">
        <Brain className="h-4 w-4 animate-pulse" />
        <span className="text-muted-foreground animate-pulse">Thinking...</span>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
// Conversation List Item
// ─────────────────────────────────────────────────────────────

const ConversationItem = memo(function ConversationItem({
  conversation,
  isSelected,
  onClick,
  onDelete,
}: {
  conversation: { id: string; title: string; updatedAt: number };
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors border-b",
        isSelected && "bg-muted/70",
      )}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{conversation.title}</div>
        <div className="text-xs text-muted-foreground">
          {formatTimestamp(conversation.updatedAt / 1000, "relative")}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
// Model Selector (for WebLLM when no model loaded)
// ─────────────────────────────────────────────────────────────

function WebLLMModelSelector({
  models,
  onSelect,
  onDownload,
  isLoading,
  loadingProgress,
  loadingText,
}: {
  models: LLMModel[];
  onSelect: (modelId: string) => void;
  onDownload: (modelId: string) => void;
  isLoading: boolean;
  loadingProgress: number;
  loadingText: string;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6">
        <Loader2 className="h-6 w-6 animate-spin" />
        <Progress value={loadingProgress * 100} className="w-48" />
        <div className="text-xs text-muted-foreground text-center max-w-[200px] truncate">
          {loadingText}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="text-sm font-medium mb-2">Select a model to load</div>
      {models.map((model) => (
        <div
          key={model.id}
          className={cn(
            "flex items-center justify-between gap-2 p-2 rounded-md border transition-colors",
            model.isDownloaded
              ? "border-primary/50 bg-primary/5"
              : "border-border hover:bg-muted/50",
          )}
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{model.name}</div>
            <div className="text-xs text-muted-foreground">
              {model.downloadSize}
              {model.description && ` - ${model.description}`}
            </div>
          </div>
          {model.isDownloaded ? (
            <Button
              size="sm"
              variant="default"
              onClick={() => onSelect(model.id)}
            >
              <Check className="h-3 w-3 mr-1" />
              Load
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDownload(model.id)}
            >
              <Download className="h-3 w-3 mr-1" />
              Download
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Chat Panel
// ─────────────────────────────────────────────────────────────

function ChatPanel({
  conversationId,
  providerInstanceId,
  modelId,
  onConversationCreated,
}: {
  conversationId: string | null;
  providerInstanceId: string;
  modelId: string;
  onConversationCreated: (id: string) => void;
}) {
  const { conversation, addMessage, updateLastMessage } =
    useLLMConversation(conversationId);
  const { createConversation } = useLLMConversations();
  const { isGenerating, sendMessage, cancel } = useLLMChat();

  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  // Optimistic UI: show user message immediately
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null,
  );
  // Track when we're waiting for AI (before tokens start streaming)
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages, streamingContent, pendingUserMessage]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, [conversationId]);

  // Clear pending message when conversation updates with our message
  useEffect(() => {
    if (
      pendingUserMessage &&
      conversation?.messages.some(
        (m) => m.role === "user" && m.content === pendingUserMessage,
      )
    ) {
      setPendingUserMessage(null);
    }
  }, [conversation?.messages, pendingUserMessage]);

  const handleSend = async () => {
    if (!input.trim() || isGenerating || isWaitingForResponse) return;

    const userContent = input.trim();
    setInput("");

    // Optimistically show user message immediately
    setPendingUserMessage(userContent);
    setIsWaitingForResponse(true);

    try {
      // Create conversation if needed
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        activeConversationId = await createConversation(
          providerInstanceId,
          modelId,
        );
        onConversationCreated(activeConversationId);
      }

      // Add user message to DB
      const userMessage = await addMessage({
        role: "user",
        content: userContent,
      });
      if (!userMessage) {
        setPendingUserMessage(null);
        setIsWaitingForResponse(false);
        return;
      }

      // Get all messages for context
      const conv = await (
        await import("@/services/db")
      ).default.llmConversations.get(activeConversationId);
      if (!conv) {
        setIsWaitingForResponse(false);
        return;
      }

      // Add placeholder assistant message
      await addMessage({ role: "assistant", content: "" });

      // Stream response
      setStreamingContent("");

      let fullContent = "";
      await sendMessage(
        providerInstanceId,
        modelId,
        conv.messages,
        (token) => {
          // First token received - no longer "waiting"
          setIsWaitingForResponse(false);
          fullContent += token;
          setStreamingContent(fullContent);
        },
        async () => {
          await updateLastMessage(fullContent);
          setStreamingContent("");
          setIsWaitingForResponse(false);
        },
        async (error) => {
          await updateLastMessage(`Error: ${error}`);
          setStreamingContent("");
          setIsWaitingForResponse(false);
        },
      );
    } catch (error) {
      setPendingUserMessage(null);
      setIsWaitingForResponse(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const messages = conversation?.messages ?? [];

  // Build display messages with optimistic updates
  let displayMessages =
    streamingContent && messages.length > 0
      ? [
          ...messages.slice(0, -1),
          { ...messages[messages.length - 1], content: streamingContent },
        ]
      : messages;

  // Add pending user message optimistically if not yet in conversation
  if (
    pendingUserMessage &&
    !messages.some((m) => m.role === "user" && m.content === pendingUserMessage)
  ) {
    displayMessages = [
      ...displayMessages,
      {
        id: "pending",
        role: "user" as const,
        content: pendingUserMessage,
        timestamp: Date.now(),
      },
    ];
  }

  // Show thinking indicator when waiting for response
  const showThinking =
    isWaitingForResponse || (isGenerating && !streamingContent);

  const isBusy = isGenerating || isWaitingForResponse;

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="flex flex-col gap-3">
          {displayMessages.length === 0 && !showThinking ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Start a conversation
            </div>
          ) : (
            <>
              {displayMessages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {showThinking && <ThinkingIndicator />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input - full width */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 min-h-[40px] max-h-[120px] resize-none"
            rows={1}
            disabled={isBusy}
          />
          {isBusy ? (
            <Button
              variant="outline"
              size="icon"
              onClick={cancel}
              className="shrink-0"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim()}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main AIViewer Component
// ─────────────────────────────────────────────────────────────

interface AIViewerProps {
  subcommand?: "providers";
}

export function AIViewer({ subcommand }: AIViewerProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);

  const { instances, activeInstanceId, activeInstance, setActiveInstance } =
    useLLMProviders();

  const { models, loading: modelsLoading } = useLLMModels(activeInstanceId);
  const { status, loadModel } = useWebLLMStatus();
  const { conversations, deleteConversation } = useLLMConversations();

  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // Auto-select first instance if none selected
  useEffect(() => {
    if (!activeInstanceId && instances.length > 0) {
      setActiveInstance(instances[0].id);
    }
  }, [activeInstanceId, instances, setActiveInstance]);

  // Reset model selection when switching providers
  useEffect(() => {
    setSelectedModelId(null);
  }, [activeInstanceId]);

  // Auto-select model: last used > first downloaded (WebLLM) > first available
  useEffect(() => {
    if (!activeInstance || models.length === 0) return;

    if (activeInstance.providerId === "webllm") {
      // For WebLLM: if model is loaded, use that
      if (status.state === "ready") {
        setSelectedModelId(status.modelId);
        return;
      }
      // Otherwise try last used model (if downloaded), then first downloaded
      if (!selectedModelId) {
        const lastModel = activeInstance.lastModelId
          ? models.find(
              (m) => m.id === activeInstance.lastModelId && m.isDownloaded,
            )
          : null;
        const downloaded = lastModel || models.find((m) => m.isDownloaded);
        if (downloaded) setSelectedModelId(downloaded.id);
      }
    } else {
      // For PPQ and other providers: last used > first available
      if (!selectedModelId) {
        const lastModel = activeInstance.lastModelId
          ? models.find((m) => m.id === activeInstance.lastModelId)
          : null;
        setSelectedModelId(lastModel?.id || models[0].id);
      }
    }
  }, [status, models, activeInstance, selectedModelId]);

  const handleSelectConversation = (id: string) => {
    setSelectedConversationId(id);
    if (isMobile) setSidebarOpen(false);
  };

  const handleNewConversation = () => {
    setSelectedConversationId(null);
    if (isMobile) setSidebarOpen(false);
  };

  // Resize handler
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        setSidebarWidth(Math.max(180, Math.min(400, startWidth + deltaX)));
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [sidebarWidth],
  );

  // Show providers management if requested via subcommand
  if (subcommand === "providers") {
    return <AIProvidersViewer />;
  }

  // No providers configured - show providers setup
  if (instances.length === 0) {
    return <AIProvidersViewer />;
  }

  // WebLLM: Need to select/load model
  const isWebLLM = activeInstance?.providerId === "webllm";
  const webllmReady = status.state === "ready";
  const webllmLoading = status.state === "loading";

  if (isWebLLM && !webllmReady) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b p-2 flex items-center justify-between">
          <Select
            value={activeInstanceId || ""}
            onValueChange={setActiveInstance}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {instances.map((inst) => (
                <SelectItem key={inst.id} value={inst.id}>
                  {inst.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-auto">
          {modelsLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <WebLLMModelSelector
              models={models}
              onSelect={(id) => loadModel(id)}
              onDownload={(id) => loadModel(id)}
              isLoading={webllmLoading}
              loadingProgress={status.state === "loading" ? status.progress : 0}
              loadingText={status.state === "loading" ? status.text : ""}
            />
          )}
        </div>
      </div>
    );
  }

  // PPQ: Need API key - redirect to providers
  if (!isWebLLM && !activeInstance?.apiKey) {
    return <AIProvidersViewer />;
  }

  // Sidebar content
  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b">
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={handleNewConversation}
        >
          <Plus className="h-4 w-4 mr-2" />
          New Chat
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {conversations.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            No conversations yet
          </div>
        ) : (
          conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isSelected={selectedConversationId === conv.id}
              onClick={() => handleSelectConversation(conv.id)}
              onDelete={() => deleteConversation(conv.id)}
            />
          ))
        )}
      </ScrollArea>
    </div>
  );

  // Main chat content
  const chatContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-2 flex items-center gap-2">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSidebarOpen(true)}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}

        <Select
          value={activeInstanceId || ""}
          onValueChange={setActiveInstance}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            {instances.map((inst) => (
              <SelectItem key={inst.id} value={inst.id}>
                {inst.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!isWebLLM && models.length > 0 && (
          <Select
            value={selectedModelId || ""}
            onValueChange={setSelectedModelId}
          >
            <SelectTrigger className="flex-1 min-w-0">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isWebLLM && webllmReady && (
          <div className="flex-1 text-sm text-muted-foreground truncate">
            {models.find((m) => m.id === status.modelId)?.name ||
              status.modelId}
          </div>
        )}
      </div>

      {/* Chat */}
      {activeInstanceId && selectedModelId && (
        <ChatPanel
          conversationId={selectedConversationId}
          providerInstanceId={activeInstanceId}
          modelId={selectedModelId}
          onConversationCreated={setSelectedConversationId}
        />
      )}
    </div>
  );

  // Mobile layout
  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-[280px] p-0">
            <VisuallyHidden.Root>
              <SheetTitle>Conversations</SheetTitle>
            </VisuallyHidden.Root>
            <div className="h-full pt-10">{sidebarContent}</div>
          </SheetContent>
        </Sheet>
        {chatContent}
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="flex h-full">
      <aside
        className="flex flex-col border-r bg-background"
        style={{ width: sidebarWidth }}
      >
        {sidebarContent}
      </aside>

      <div
        className={cn(
          "w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors",
          isResizing && "bg-primary",
        )}
        onMouseDown={handleMouseDown}
      />

      <div className="flex-1 min-w-0">{chatContent}</div>
    </div>
  );
}
