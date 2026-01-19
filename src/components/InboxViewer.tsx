/**
 * InboxViewer - NIP-17 DM Inbox Dashboard
 *
 * Shows:
 * - Gift wrap sync settings (enable/disable, auto-decrypt)
 * - DM relay status
 * - Gift wrap statistics
 * - Conversation list (compact view)
 */

import { useState, useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import { nip19 } from "nostr-tools";
import { useGrimoire } from "@/core/state";
import { useAccount } from "@/hooks/useAccount";
import {
  useGiftWrapStats,
  useGiftWrapConversations,
} from "@/hooks/useGiftWrap";
import { useProfile } from "@/hooks/useProfile";
import eventStore from "@/services/event-store";
import { getDisplayName } from "@/lib/nostr-utils";
import { Copy, Settings, MessageSquare, ChevronDown } from "lucide-react";
import { useCopy } from "@/hooks/useCopy";
import { toast } from "sonner";
import giftWrapManager from "@/services/gift-wrap";

type InboxViewerProps = Record<string, never>;

const CONVERSATIONS_PAGE_SIZE = 50;

export function InboxViewer(_props: InboxViewerProps) {
  const { state, updateGiftWrapSettings } = useGrimoire();
  const { pubkey } = useAccount();
  const stats = useGiftWrapStats();
  const conversations = useGiftWrapConversations();
  const [showSettings, setShowSettings] = useState(false);
  const [conversationsPage, setConversationsPage] = useState(1);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const syncEnabled = state.giftWrapSettings?.syncEnabled ?? true;
  const autoDecrypt = state.giftWrapSettings?.autoDecrypt ?? true;

  // Get DM relays (kind 10050)
  const dmRelayEvent = use$(() => {
    if (!pubkey) return undefined;
    return eventStore.replaceable(10050, pubkey, "");
  }, [pubkey]);

  const dmRelays = useMemo(() => {
    if (!dmRelayEvent) return [];
    return dmRelayEvent.tags
      .filter((t: string[]) => t[0] === "relay" && t[1])
      .map((t: string[]) => t[1]);
  }, [dmRelayEvent]);

  // Convert conversations map to sorted array with pagination
  const { conversationsList, totalConversations, hasMoreConversations } =
    useMemo(() => {
      if (!conversations)
        return {
          conversationsList: [],
          totalConversations: 0,
          hasMoreConversations: false,
        };

      const allConversations = Array.from(conversations.entries())
        .map(([key, latestMessage]) => ({
          key,
          latestMessage,
          otherPubkey:
            latestMessage.senderPubkey === pubkey
              ? latestMessage.recipientPubkey
              : latestMessage.senderPubkey,
        }))
        .sort((a, b) => b.latestMessage.createdAt - a.latestMessage.createdAt);

      const pageSize = CONVERSATIONS_PAGE_SIZE * conversationsPage;
      const pagedConversations = allConversations.slice(0, pageSize);

      return {
        conversationsList: pagedConversations,
        totalConversations: allConversations.length,
        hasMoreConversations: allConversations.length > pageSize,
      };
    }, [conversations, pubkey, conversationsPage]);

  const handleToggleSync = () => {
    updateGiftWrapSettings({ syncEnabled: !syncEnabled });
    toast.success(
      syncEnabled ? "Gift wrap sync disabled" : "Gift wrap sync enabled",
    );
  };

  const handleToggleAutoDecrypt = () => {
    updateGiftWrapSettings({ autoDecrypt: !autoDecrypt });
    toast.success(
      autoDecrypt ? "Auto-decrypt disabled" : "Auto-decrypt enabled",
    );
  };

  const handleOpenConversation = (
    _conversationKey: string,
    otherPubkey: string,
  ) => {
    // Open chat window with the other participant
    const npub = nip19.npubEncode(otherPubkey);
    window.dispatchEvent(
      new CustomEvent("grimoire:execute-command", {
        detail: `chat ${npub}`,
      }),
    );
  };

  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const handleLoadMoreConversations = () => {
    if (isLoadingMore) return; // Prevent double-clicks
    setIsLoadingMore(true);
    // Use setTimeout to ensure UI updates
    setTimeout(() => {
      setConversationsPage((prev) => prev + 1);
      setIsLoadingMore(false);
    }, 100);
  };

  const handleLoadOlderGiftWraps = async () => {
    setIsLoadingOlder(true);
    try {
      const count = await giftWrapManager.loadOlderGiftWraps();
      if (count > 0) {
        toast.success(`Loaded ${count} older gift wraps`);
      } else {
        toast.info("No older gift wraps found");
      }
    } catch (error) {
      console.error("[Inbox] Error loading older gift wraps:", error);
      toast.error("Failed to load older gift wraps");
    } finally {
      setIsLoadingOlder(false);
    }
  };

  if (!pubkey) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">
            Please log in to view your inbox
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">NIP-17 DM Inbox</h2>
            <p className="text-sm text-muted-foreground">
              Encrypted direct messages with gift wrap privacy
            </p>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="rounded p-2 hover:bg-muted"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="border-b bg-muted/50 px-4 py-3">
          <h3 className="mb-2 text-sm font-semibold">Settings</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={syncEnabled}
                onChange={handleToggleSync}
                className="h-4 w-4"
              />
              <span className="text-sm">Enable gift wrap sync</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoDecrypt}
                onChange={handleToggleAutoDecrypt}
                className="h-4 w-4"
                disabled={!syncEnabled}
              />
              <span className="text-sm">Auto-decrypt received gift wraps</span>
            </label>
          </div>
        </div>
      )}

      {/* Stats Panel */}
      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Gift Wrap Statistics</h3>
          <button
            onClick={handleLoadOlderGiftWraps}
            disabled={isLoadingOlder}
            className="rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            title="Load older gift wraps from relays"
          >
            {isLoadingOlder ? "Loading..." : "Load Older"}
          </button>
        </div>
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold">{stats.totalGiftWraps}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {stats.successfulDecryptions}
            </div>
            <div className="text-xs text-muted-foreground">Success</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-red-600">
              {stats.failedDecryptions}
            </div>
            <div className="text-xs text-muted-foreground">Failed</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-yellow-600">
              {stats.pendingDecryptions}
            </div>
            <div className="text-xs text-muted-foreground">Pending</div>
          </div>
        </div>
        {stats.oldestGiftWrap && stats.newestGiftWrap && (
          <div className="mt-2 text-xs text-muted-foreground">
            Storage:{" "}
            {new Date(stats.oldestGiftWrap * 1000).toLocaleDateString()} -{" "}
            {new Date(stats.newestGiftWrap * 1000).toLocaleDateString()}
          </div>
        )}
      </div>

      {/* DM Relays Panel */}
      <div className="border-b bg-muted/20 px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold">DM Relays (Kind 10050)</h3>
        {dmRelays.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {dmRelays.map((relay) => (
              <span
                key={relay}
                className="rounded bg-muted px-2 py-1 text-xs font-mono"
              >
                {relay}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No DM relays configured (using general relays)
          </p>
        )}
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-auto">
        <div className="px-4 py-3">
          <h3 className="mb-2 text-sm font-semibold">
            Conversations ({conversationsList.length}
            {totalConversations > conversationsList.length &&
              ` of ${totalConversations}`}
            )
          </h3>
          {conversationsList.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <MessageSquare className="mx-auto mb-2 h-12 w-12 opacity-50" />
              <p>No conversations yet</p>
              <p className="text-xs">
                Start a chat using: <code>chat npub...</code>
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {conversationsList.map(
                  ({ key, latestMessage, otherPubkey }) => (
                    <ConversationRow
                      key={key}
                      conversationKey={key}
                      otherPubkey={otherPubkey}
                      latestMessage={latestMessage}
                      onClick={() => handleOpenConversation(key, otherPubkey)}
                    />
                  ),
                )}
              </div>
              {hasMoreConversations && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={handleLoadMoreConversations}
                    disabled={isLoadingMore}
                    className="flex items-center gap-2 rounded border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <ChevronDown className="h-4 w-4" />
                    {isLoadingMore
                      ? "Loading..."
                      : `Load More Conversations (${totalConversations - conversationsList.length} remaining)`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface ConversationRowProps {
  conversationKey: string;
  otherPubkey: string;
  latestMessage: any;
  onClick: () => void;
}

function ConversationRow({
  otherPubkey,
  latestMessage,
  onClick,
}: ConversationRowProps) {
  const profile = useProfile(otherPubkey);
  const { copy } = useCopy();
  const displayName = getDisplayName(otherPubkey, profile);

  const handleCopyPubkey = (e: React.MouseEvent) => {
    e.stopPropagation();
    copy(otherPubkey);
    toast.success("Pubkey copied");
  };

  // Format timestamp
  const timestamp = new Date(latestMessage.createdAt * 1000);
  const timeStr = timestamp.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Truncate content preview
  const preview = latestMessage.content.slice(0, 60);
  const truncated = latestMessage.content.length > 60;

  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer items-center gap-3 rounded border p-3 hover:bg-muted/50"
    >
      {/* Avatar placeholder */}
      <div className="h-10 w-10 shrink-0 rounded-full bg-primary/20" />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold">{displayName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeStr}
          </span>
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {preview}
          {truncated && "..."}
        </p>
      </div>

      {/* Actions */}
      <button
        onClick={handleCopyPubkey}
        className="shrink-0 rounded p-1 hover:bg-muted"
        title="Copy pubkey"
      >
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}
