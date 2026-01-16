/**
 * AIConversationList - Displays list of conversations grouped by date
 */

import { memo, useMemo } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import type { AIConversation } from "@/services/db";

interface AIConversationListProps {
  conversations: AIConversation[];
  activeConversation: AIConversation | null;
  onSelect: (conversation: AIConversation) => void;
  onDelete: (id: string) => void;
}

/**
 * Group conversations by date
 */
function groupByDate(
  conversations: AIConversation[],
): Map<string, AIConversation[]> {
  const groups = new Map<string, AIConversation[]>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastMonth = new Date(today);
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  for (const conv of conversations) {
    const date = new Date(conv.updatedAt);
    const dateOnly = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );

    let group: string;
    if (dateOnly.getTime() >= today.getTime()) {
      group = "Today";
    } else if (dateOnly.getTime() >= yesterday.getTime()) {
      group = "Yesterday";
    } else if (dateOnly.getTime() >= lastWeek.getTime()) {
      group = "Last 7 days";
    } else if (dateOnly.getTime() >= lastMonth.getTime()) {
      group = "Last 30 days";
    } else {
      group = "Older";
    }

    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(conv);
  }

  return groups;
}

const ConversationItem = memo(function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: {
  conversation: AIConversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={onSelect}
        className="group/item pr-8"
      >
        <MessageSquare className="size-4 shrink-0" />
        <span className="truncate">{conversation.title}</span>
      </SidebarMenuButton>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1/2 -translate-y-1/2 size-6 opacity-0 group-hover/item:opacity-100 hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="size-3" />
      </Button>
    </SidebarMenuItem>
  );
});

export function AIConversationList({
  conversations,
  activeConversation,
  onSelect,
  onDelete,
}: AIConversationListProps) {
  const grouped = useMemo(() => groupByDate(conversations), [conversations]);

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
        <MessageSquare className="size-8 mb-2 opacity-50" />
        <p>No conversations yet</p>
      </div>
    );
  }

  // Order of groups to display
  const groupOrder = [
    "Today",
    "Yesterday",
    "Last 7 days",
    "Last 30 days",
    "Older",
  ];

  return (
    <>
      {groupOrder.map((groupName) => {
        const items = grouped.get(groupName);
        if (!items || items.length === 0) return null;

        return (
          <SidebarGroup key={groupName}>
            <SidebarGroupLabel>{groupName}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((conv) => (
                  <ConversationItem
                    key={conv.id}
                    conversation={conv}
                    isActive={activeConversation?.id === conv.id}
                    onSelect={() => onSelect(conv)}
                    onDelete={() => onDelete(conv.id)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}
    </>
  );
}
