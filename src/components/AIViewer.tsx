/**
 * AIViewer - AI Chat Interface
 *
 * Chat interface for OpenAI-compatible AI providers.
 * Uses sidebar pattern for conversation history.
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
  Brain,
  Settings2,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import {
  useLLMProviders,
  useLLMModels,
  useLLMConversations,
  useLLMConversation,
  useLLMChat,
} from "@/hooks/useLLM";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";
import { AIProvidersViewer } from "./AIProvidersViewer";
import type { LLMMessage } from "@/types/llm";

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
// Message Bubble
// ─────────────────────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  message,
}: {
  message: LLMMessage;
}) {
  const isUser = message.role === "user";

  if (!isUser && !message.content) {
    return null;
  }

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
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
      <Brain className="h-3 w-3 animate-pulse" />
      <span className="animate-pulse">Thinking...</span>
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
        "group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors border-b",
        isSelected && "bg-muted/70",
      )}
      onClick={onClick}
    >
      <MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{conversation.title}</div>
        <div className="text-xs text-muted-foreground">
          {formatTimestamp(conversation.updatedAt / 1000, "relative")}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
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
  const { conversation } = useLLMConversation(conversationId);
  const { createConversation } = useLLMConversations();
  const { isGenerating, sendMessage, cancel } = useLLMChat();

  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null,
  );
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset local state when switching conversations
  useEffect(() => {
    setStreamingContent("");
    setPendingUserMessage(null);
    setIsWaitingForResponse(false);
    setInput("");
    textareaRef.current?.focus();
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages, streamingContent, pendingUserMessage]);

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
    setPendingUserMessage(userContent);
    setIsWaitingForResponse(true);

    // Import db for direct operations (avoids stale closure issues)
    const db = (await import("@/services/db")).default;

    try {
      // Create or use existing conversation
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        activeConversationId = await createConversation(
          providerInstanceId,
          modelId,
        );
        onConversationCreated(activeConversationId);
      }

      // Add user message directly to DB (not through hook - avoids stale closure)
      const userMessage: LLMMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: userContent,
        timestamp: Date.now(),
      };

      const currentConv = await db.llmConversations.get(activeConversationId);
      if (!currentConv) {
        setPendingUserMessage(null);
        setIsWaitingForResponse(false);
        return;
      }

      const isFirstMessage = currentConv.messages.length === 0;
      await db.llmConversations.update(activeConversationId, {
        messages: [...currentConv.messages, userMessage],
        updatedAt: Date.now(),
        // Auto-title from first user message
        title: isFirstMessage
          ? userContent.slice(0, 50) + (userContent.length > 50 ? "..." : "")
          : currentConv.title,
      });

      // Add empty assistant message placeholder
      const assistantMessage: LLMMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };

      const updatedConv = await db.llmConversations.get(activeConversationId);
      if (!updatedConv) {
        setIsWaitingForResponse(false);
        return;
      }

      await db.llmConversations.update(activeConversationId, {
        messages: [...updatedConv.messages, assistantMessage],
        updatedAt: Date.now(),
      });

      setStreamingContent("");

      // Get messages for API call (includes user message, excludes empty assistant)
      const messagesForApi = updatedConv.messages;

      let fullContent = "";
      await sendMessage(
        providerInstanceId,
        modelId,
        messagesForApi,
        (token) => {
          setIsWaitingForResponse(false);
          fullContent += token;
          setStreamingContent(fullContent);
        },
        async () => {
          // Update assistant message with final content
          const finalConv = await db.llmConversations.get(activeConversationId);
          if (finalConv && finalConv.messages.length > 0) {
            const messages = [...finalConv.messages];
            messages[messages.length - 1] = {
              ...messages[messages.length - 1],
              content: fullContent,
            };
            await db.llmConversations.update(activeConversationId, {
              messages,
              updatedAt: Date.now(),
            });
          }
          setStreamingContent("");
          setIsWaitingForResponse(false);
        },
        async (error) => {
          // Update assistant message with error
          const finalConv = await db.llmConversations.get(activeConversationId);
          if (finalConv && finalConv.messages.length > 0) {
            const messages = [...finalConv.messages];
            messages[messages.length - 1] = {
              ...messages[messages.length - 1],
              content: `Error: ${error}`,
            };
            await db.llmConversations.update(activeConversationId, {
              messages,
              updatedAt: Date.now(),
            });
          }
          setStreamingContent("");
          setIsWaitingForResponse(false);
        },
      );
    } catch {
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

  let displayMessages =
    streamingContent && messages.length > 0
      ? [
          ...messages.slice(0, -1),
          { ...messages[messages.length - 1], content: streamingContent },
        ]
      : messages;

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

  const showThinking =
    isWaitingForResponse || (isGenerating && !streamingContent);
  const isBusy = isGenerating || isWaitingForResponse;

  return (
    <>
      <div className="flex-1 overflow-y-auto p-3">
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
      </div>

      <div className="border-t p-2 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 min-h-[38px] max-h-[120px] resize-none text-sm"
            rows={1}
            disabled={isBusy}
          />
          {isBusy ? (
            <Button
              variant="outline"
              size="icon"
              onClick={cancel}
              className="flex-shrink-0 h-[38px] w-[38px]"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex-shrink-0 h-[38px] w-[38px]"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </>
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
  const { addWindow } = useGrimoire();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);

  const { instances, activeInstanceId, activeInstance, setActiveInstance } =
    useLLMProviders();
  const {
    models,
    loading: modelsLoading,
    refresh: refreshModels,
  } = useLLMModels(activeInstanceId);
  const { conversations, deleteConversation } = useLLMConversations();

  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // Track when we're selecting a conversation (to prevent model reset race)
  const isSelectingConversationRef = useRef(false);
  const pendingModelIdRef = useRef<string | null>(null);

  // Auto-select first instance
  useEffect(() => {
    if (!activeInstanceId && instances.length > 0) {
      setActiveInstance(instances[0].id);
    }
  }, [activeInstanceId, instances, setActiveInstance]);

  // Reset model selection when switching providers (but not during conversation selection)
  useEffect(() => {
    if (isSelectingConversationRef.current) {
      // Don't reset - we're selecting a conversation that specifies its own model
      // Apply the pending model after provider switch
      if (pendingModelIdRef.current) {
        setSelectedModelId(pendingModelIdRef.current);
        pendingModelIdRef.current = null;
      }
      isSelectingConversationRef.current = false;
    } else {
      // Normal provider switch - reset model
      setSelectedModelId(null);
    }
  }, [activeInstanceId]);

  // Auto-select model when models load
  useEffect(() => {
    if (!activeInstance || models.length === 0) return;

    if (!selectedModelId) {
      // Prefer last used model
      const lastModel = activeInstance.lastModelId
        ? models.find((m) => m.id === activeInstance.lastModelId)
        : null;
      setSelectedModelId(lastModel?.id || models[0].id);
    }
  }, [models, activeInstance, selectedModelId]);

  const handleSelectConversation = (id: string) => {
    setSelectedConversationId(id);

    const conv = conversations.find((c) => c.id === id);
    if (conv) {
      if (conv.providerInstanceId !== activeInstanceId) {
        // Mark that we're selecting a conversation (prevents model reset)
        isSelectingConversationRef.current = true;
        pendingModelIdRef.current = conv.modelId;
        setActiveInstance(conv.providerInstanceId);
      } else {
        // Same provider - just set the model
        setSelectedModelId(conv.modelId);
      }
    }

    if (isMobile) setSidebarOpen(false);
  };

  const handleNewConversation = () => {
    setSelectedConversationId(null);
    if (isMobile) setSidebarOpen(false);
  };

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

  // Subcommand: show providers management
  if (subcommand === "providers") {
    return <AIProvidersViewer />;
  }

  // Check if we can chat
  const canChat =
    instances.length > 0 && activeInstance?.apiKey && selectedModelId;

  // ─────────────────────────────────────────────────────────────
  // Sidebar Content
  // ─────────────────────────────────────────────────────────────

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b flex-shrink-0">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={handleNewConversation}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
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
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // No Providers State
  // ─────────────────────────────────────────────────────────────

  if (instances.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-8">
        <Brain className="h-12 w-12 text-muted-foreground" />
        <div>
          <div className="font-medium mb-1">No AI providers configured</div>
          <div className="text-sm text-muted-foreground">
            Add a provider to start chatting with AI
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            addWindow("ai", { subcommand: "providers" }, "AI Providers")
          }
        >
          <Settings2 className="h-4 w-4 mr-2" />
          Add a provider
        </Button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Main Chat Content
  // ─────────────────────────────────────────────────────────────

  const chatContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-2 py-1.5 flex items-center gap-2 flex-shrink-0">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => setSidebarOpen(true)}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}

        {/* Model selector - centered */}
        <div className="flex-1 flex justify-center items-center gap-1 min-w-0">
          {modelsLoading ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading models...
            </span>
          ) : models.length > 0 ? (
            <>
              <Select
                value={selectedModelId || ""}
                onValueChange={setSelectedModelId}
              >
                <SelectTrigger className="h-7 w-auto max-w-[200px] text-xs">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem
                      key={model.id}
                      value={model.id}
                      className="text-xs"
                    >
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={refreshModels}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {activeInstance?.apiKey ? "No models found" : "Configure API key"}
            </span>
          )}
        </div>

        {/* Provider selector - right */}
        <Select
          value={activeInstanceId || ""}
          onValueChange={setActiveInstance}
        >
          <SelectTrigger className="h-7 w-[120px] text-xs flex-shrink-0">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            {instances.map((inst) => (
              <SelectItem key={inst.id} value={inst.id} className="text-xs">
                {inst.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Chat area */}
      {canChat ? (
        <ChatPanel
          conversationId={selectedConversationId}
          providerInstanceId={activeInstanceId!}
          modelId={selectedModelId!}
          onConversationCreated={setSelectedConversationId}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-4">
          <div className="text-center">
            <div className="mb-2">
              {!activeInstance?.apiKey
                ? "Configure your API key to start"
                : "Select a model to start chatting"}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                addWindow("ai", { subcommand: "providers" }, "AI Providers")
              }
            >
              <Settings2 className="h-3 w-3 mr-1" />
              Configure
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // Layout: Mobile
  // ─────────────────────────────────────────────────────────────

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
        <div className="flex-1 min-h-0">{chatContent}</div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Layout: Desktop
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      <aside
        className="flex flex-col border-r bg-background flex-shrink-0"
        style={{ width: sidebarWidth }}
      >
        {sidebarContent}
      </aside>

      <div
        className={cn(
          "w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors flex-shrink-0",
          isResizing && "bg-primary",
        )}
        onMouseDown={handleMouseDown}
      />

      <div className="flex-1 min-w-0 min-h-0">{chatContent}</div>
    </div>
  );
}
