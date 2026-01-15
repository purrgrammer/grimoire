/**
 * LLM Conversation List Viewer
 * Displays all LLM conversations with search and sort
 */

import { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageSquare, Trash2 } from "lucide-react";
import db from "@/services/db";
import type { LLMConversation } from "@/types/llm";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useGrimoire } from "@/core/state";
import Timestamp from "./Timestamp";

export function LLMConversationListViewer() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "tokens">(
    "recent",
  );
  const { addWindow } = useGrimoire();

  // Load conversations from Dexie
  const conversations = useLiveQuery(() =>
    db.llmConversations.orderBy("updatedAt").reverse().toArray(),
  );

  // Filter and sort conversations
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];

    let filtered = conversations;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (conv) =>
          conv.title.toLowerCase().includes(query) ||
          conv.messages.some((m) => m.content.toLowerCase().includes(query)),
      );
    }

    // Sort
    const sorted = [...filtered];
    switch (sortBy) {
      case "recent":
        sorted.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
      case "oldest":
        sorted.sort((a, b) => a.updatedAt - b.updatedAt);
        break;
      case "tokens":
        sorted.sort((a, b) => b.totalTokens.total - a.totalTokens.total);
        break;
    }

    return sorted;
  }, [conversations, searchQuery, sortBy]);

  // Handle opening a conversation
  const handleOpen = (conversation: LLMConversation) => {
    addWindow("llm-chat", {
      conversationId: conversation.id,
    });
  };

  // Handle deleting a conversation
  const handleDelete = async (conversation: LLMConversation) => {
    if (
      confirm(
        `Delete conversation "${conversation.title}"? This cannot be undone.`,
      )
    ) {
      await db.llmConversations.delete(conversation.id);
    }
  };

  if (!conversations) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading conversations...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with search and sort */}
      <div className="border-b p-4">
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1"
          />
          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as "recent" | "oldest" | "tokens")
            }
            className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="recent">Most Recent</option>
            <option value="oldest">Oldest First</option>
            <option value="tokens">Most Tokens</option>
          </select>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {filteredConversations.length} conversation
          {filteredConversations.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground p-4">
            {searchQuery ? (
              <>
                <p>No conversations found matching "{searchQuery}"</p>
                <Button
                  onClick={() => setSearchQuery("")}
                  variant="outline"
                  size="sm"
                >
                  Clear Search
                </Button>
              </>
            ) : (
              <>
                <MessageSquare className="size-12 opacity-20" />
                <p>No conversations yet</p>
                <p className="text-xs">
                  Use <code className="rounded bg-muted px-1 py-0.5">llm</code>{" "}
                  command to start
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {filteredConversations.map((conversation) => (
              <div
                key={conversation.id}
                className="group flex items-start gap-3 p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => handleOpen(conversation)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold truncate">
                      {conversation.title}
                    </h3>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(conversation);
                        }}
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        title="Delete conversation"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-1 text-xs text-muted-foreground">
                    {conversation.messages.length} message
                    {conversation.messages.length !== 1 ? "s" : ""} •{" "}
                    {conversation.totalTokens.total.toLocaleString()} tokens
                    {conversation.totalCost > 0 && (
                      <> • ${conversation.totalCost.toFixed(4)}</>
                    )}
                  </div>

                  <div className="mt-1 text-xs text-muted-foreground">
                    Updated <Timestamp timestamp={conversation.updatedAt} />
                  </div>

                  {/* Preview of last message */}
                  {conversation.messages.length > 0 && (
                    <div className="mt-2 text-sm text-muted-foreground truncate">
                      {conversation.messages[
                        conversation.messages.length - 1
                      ].content.slice(0, 100)}
                      ...
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
