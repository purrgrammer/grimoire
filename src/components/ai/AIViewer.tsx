/**
 * AIViewer - Main AI chat interface with conversation sidebar
 *
 * Provides a chat interface for AI providers like PPQ.ai
 */

import { useState, useEffect, useCallback } from "react";
import {
  Settings,
  Plus,
  MessageSquare,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { AIChat } from "./AIChat";
import { AISettings } from "./AISettings";
import { AIConversationList } from "./AIConversationList";
import { AIProviderSelector } from "./AIProviderSelector";
import { AIModelSelector } from "./AIModelSelector";
import { aiService } from "@/services/ai-service";
import type { AIProvider, AIConversation } from "@/services/db";

export interface AIViewerProps {
  view?: "list" | "chat" | "settings";
  conversationId?: string | null;
}

export function AIViewer({
  view: initialView = "list",
  conversationId: initialConversationId,
}: AIViewerProps) {
  // State
  const [view, setView] = useState<"list" | "chat" | "settings">(initialView);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [activeProvider, setActiveProvider] = useState<AIProvider | null>(null);
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<AIConversation | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  // Load providers and conversations on mount
  useEffect(() => {
    loadData();
  }, []);

  // Load initial conversation if provided
  useEffect(() => {
    if (initialConversationId && conversations.length > 0) {
      const conv = conversations.find((c) => c.id === initialConversationId);
      if (conv) {
        setActiveConversation(conv);
        setView("chat");
      }
    }
  }, [initialConversationId, conversations]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const loadedProviders = await aiService.getProviders();
      setProviders(loadedProviders);

      if (loadedProviders.length > 0) {
        const provider = loadedProviders[0];
        setActiveProvider(provider);
        setSelectedModel(provider.defaultModel || provider.models[0] || "");

        const loadedConversations = await aiService.getConversations(
          provider.id,
        );
        setConversations(loadedConversations);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleProviderChange = useCallback(async (provider: AIProvider) => {
    setActiveProvider(provider);
    setSelectedModel(provider.defaultModel || provider.models[0] || "");
    const loadedConversations = await aiService.getConversations(provider.id);
    setConversations(loadedConversations);
    setActiveConversation(null);
    setView("list");
  }, []);

  const handleNewChat = useCallback(async () => {
    if (!activeProvider || !selectedModel) return;

    const conversation = await aiService.createConversation(
      activeProvider.id,
      selectedModel,
    );
    setConversations((prev) => [conversation, ...prev]);
    setActiveConversation(conversation);
    setView("chat");
  }, [activeProvider, selectedModel]);

  const handleSelectConversation = useCallback(
    (conversation: AIConversation) => {
      setActiveConversation(conversation);
      setSelectedModel(conversation.model);
      setView("chat");
    },
    [],
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await aiService.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversation?.id === id) {
        setActiveConversation(null);
        setView("list");
      }
    },
    [activeConversation],
  );

  const handleConversationUpdate = useCallback(
    (conversation: AIConversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversation.id ? conversation : c)),
      );
      if (activeConversation?.id === conversation.id) {
        setActiveConversation(conversation);
      }
    },
    [activeConversation],
  );

  const handleProviderSaved = useCallback(async () => {
    await loadData();
    setView("list");
  }, [loadData]);

  const handleModelChange = useCallback(
    async (model: string) => {
      setSelectedModel(model);
      if (activeConversation) {
        await aiService.updateConversation(activeConversation.id, { model });
        setActiveConversation((prev) => (prev ? { ...prev, model } : null));
      }
    },
    [activeConversation],
  );

  // No providers configured - show settings
  if (!isLoading && providers.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <AISettings onSaved={handleProviderSaved} />
      </div>
    );
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-full w-full">
        {/* Sidebar */}
        <AIViewerSidebar
          providers={providers}
          activeProvider={activeProvider}
          conversations={conversations}
          activeConversation={activeConversation}
          onProviderChange={handleProviderChange}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          onNewChat={handleNewChat}
          onOpenSettings={() => setView("settings")}
        />

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
          {/* Header */}
          <AIViewerHeader
            activeProvider={activeProvider}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            onOpenSettings={() => setView("settings")}
          />

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {view === "settings" ? (
              <AISettings
                provider={activeProvider || undefined}
                onSaved={handleProviderSaved}
                onCancel={() => setView("list")}
              />
            ) : view === "chat" && activeConversation ? (
              <AIChat
                conversation={activeConversation}
                onConversationUpdate={handleConversationUpdate}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="size-12 mx-auto mb-4 opacity-50" />
                  <p className="text-sm">
                    Select a conversation or start a new chat
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={handleNewChat}
                    disabled={!activeProvider}
                  >
                    <Plus className="size-4 mr-2" />
                    New Chat
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

// Sidebar Component
function AIViewerSidebar({
  providers,
  activeProvider,
  conversations,
  activeConversation,
  onProviderChange,
  onSelectConversation,
  onDeleteConversation,
  onNewChat,
  onOpenSettings,
}: {
  providers: AIProvider[];
  activeProvider: AIProvider | null;
  conversations: AIConversation[];
  activeConversation: AIConversation | null;
  onProviderChange: (provider: AIProvider) => void;
  onSelectConversation: (conversation: AIConversation) => void;
  onDeleteConversation: (id: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
}) {
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar collapsible="offcanvas" className="border-r">
      <SidebarHeader className="border-b">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start gap-2"
            onClick={onNewChat}
            disabled={!activeProvider}
          >
            <Plus className="size-4" />
            {!isCollapsed && "New Chat"}
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <AIConversationList
          conversations={conversations}
          activeConversation={activeConversation}
          onSelect={onSelectConversation}
          onDelete={onDeleteConversation}
        />
      </SidebarContent>

      <SidebarFooter className="border-t">
        <SidebarMenu>
          {providers.length > 1 && (
            <SidebarMenuItem>
              <AIProviderSelector
                providers={providers}
                activeProvider={activeProvider}
                onSelect={onProviderChange}
              />
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onOpenSettings}>
              <Settings className="size-4" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={toggleSidebar}>
              {isCollapsed ? (
                <PanelLeft className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
              <span>{isCollapsed ? "Expand" : "Collapse"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

// Header Component
function AIViewerHeader({
  activeProvider,
  selectedModel,
  onModelChange,
  onOpenSettings,
}: {
  activeProvider: AIProvider | null;
  selectedModel: string;
  onModelChange: (model: string) => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-1.5">
      {activeProvider && (
        <>
          <span className="text-sm font-medium text-muted-foreground">
            {activeProvider.name}
          </span>
          <AIModelSelector
            models={activeProvider.models}
            selectedModel={selectedModel}
            onSelect={onModelChange}
          />
        </>
      )}
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onOpenSettings}
      >
        <Settings className="size-4" />
      </Button>
    </div>
  );
}
