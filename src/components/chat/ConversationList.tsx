import { useEffect, useState, useCallback } from "react";
import { MessageSquare, Lock, RefreshCw, User } from "lucide-react";
import db, { type DecryptedRumor } from "@/services/db";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import accountManager from "@/services/accounts";
import { use$ } from "applesauce-react/hooks";

/**
 * Format a timestamp as relative time (e.g., "2h ago", "3d ago")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w`;
  return `${Math.floor(diff / 2592000)}mo`;
}

interface ConversationSummary {
  conversationId: string;
  partnerPubkey: string;
  lastMessage: DecryptedRumor;
  messageCount: number;
}

interface ConversationItemProps {
  summary: ConversationSummary;
  onClick: () => void;
}

function ConversationItem({ summary, onClick }: ConversationItemProps) {
  const profile = useProfile(summary.partnerPubkey);
  const displayName = getDisplayName(summary.partnerPubkey, profile);
  const isSelfChat =
    summary.partnerPubkey === accountManager.active$.value?.pubkey;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors border-b border-border last:border-b-0 text-left"
    >
      <Avatar className="size-10 flex-shrink-0">
        <AvatarImage src={profile?.picture} alt={displayName} />
        <AvatarFallback>
          {isSelfChat ? (
            <User className="size-5" />
          ) : (
            displayName.slice(0, 2).toUpperCase()
          )}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {isSelfChat ? "Notes to Self" : displayName}
          </span>
          <Lock className="size-3 text-muted-foreground flex-shrink-0" />
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {summary.lastMessage.content.slice(0, 100)}
          {summary.lastMessage.content.length > 100 ? "..." : ""}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(summary.lastMessage.createdAt)}
        </span>
        <span className="text-xs text-muted-foreground">
          {summary.messageCount} message{summary.messageCount !== 1 ? "s" : ""}
        </span>
      </div>
    </button>
  );
}

interface ConversationListProps {
  onSelectConversation: (pubkey: string) => void;
}

export function ConversationList({
  onSelectConversation,
}: ConversationListProps) {
  const account = use$(accountManager.active$);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    if (!account?.pubkey) {
      setConversations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Get all kind 14 (DM) rumors from DB
      const allRumors = await db.decryptedRumors
        .where("kind")
        .equals(14)
        .toArray();

      // Group by conversation ID
      const conversationMap = new Map<string, DecryptedRumor[]>();

      for (const rumor of allRumors) {
        if (!rumor.conversationId) continue;

        const existing = conversationMap.get(rumor.conversationId);
        if (existing) {
          existing.push(rumor);
        } else {
          conversationMap.set(rumor.conversationId, [rumor]);
        }
      }

      // Build summaries
      const summaries: ConversationSummary[] = [];

      for (const [conversationId, rumors] of conversationMap) {
        // Sort by timestamp to get latest
        rumors.sort((a, b) => b.createdAt - a.createdAt);
        const lastMessage = rumors[0];

        // Extract partner pubkey from conversation ID (nip-17:pubkey)
        const partnerPubkey = conversationId.replace("nip-17:", "");

        summaries.push({
          conversationId,
          partnerPubkey,
          lastMessage,
          messageCount: rumors.length,
        });
      }

      // Sort by most recent message
      summaries.sort(
        (a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt,
      );

      setConversations(summaries);
    } catch (err) {
      console.error("[ConversationList] Failed to load conversations:", err);
      setError("Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, [account?.pubkey]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const handleSelectConversation = useCallback(
    (pubkey: string) => {
      onSelectConversation(pubkey);
    },
    [onSelectConversation],
  );

  if (!account) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Lock className="size-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">Login Required</h3>
        <p className="text-sm text-muted-foreground">
          Log in to view your encrypted DM conversations.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <RefreshCw className="size-8 text-muted-foreground animate-spin mb-4" />
        <p className="text-sm text-muted-foreground">
          Loading conversations...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <p className="text-sm text-destructive mb-4">{error}</p>
        <Button variant="outline" size="sm" onClick={loadConversations}>
          <RefreshCw className="size-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <MessageSquare className="size-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">No Conversations Yet</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Start a new encrypted DM by running:
        </p>
        <code className="px-3 py-2 bg-muted rounded text-sm font-mono">
          chat npub1... or chat user@domain.com
        </code>
        <p className="text-xs text-muted-foreground mt-4">
          Conversations are cached locally after decryption.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Lock className="size-4 text-muted-foreground" />
          <h2 className="font-medium">Encrypted DMs</h2>
          <span className="text-xs text-muted-foreground">
            ({conversations.length})
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={loadConversations}>
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {conversations.map((summary) => (
          <ConversationItem
            key={summary.conversationId}
            summary={summary}
            onClick={() => handleSelectConversation(summary.partnerPubkey)}
          />
        ))}
      </div>

      {/* Footer hint */}
      <div className="p-2 border-t border-border text-center">
        <p className="text-xs text-muted-foreground">
          Click a conversation to open it, or use{" "}
          <code className="px-1 py-0.5 bg-muted rounded">chat npub...</code> for
          new chats
        </p>
      </div>
    </div>
  );
}
