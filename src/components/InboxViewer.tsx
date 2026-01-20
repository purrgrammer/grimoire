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
import {
  Settings,
  MessageSquare,
  Radio,
  ShieldCheck,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import giftWrapManager from "@/services/gift-wrap";
import { RelayLink } from "@/components/nostr/RelayLink";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type InboxViewerProps = Record<string, never>;

const CONVERSATIONS_PAGE_SIZE = 50;

export function InboxViewer(_props: InboxViewerProps) {
  const { state, updateGiftWrapSettings } = useGrimoire();
  const { pubkey } = useAccount();
  const stats = useGiftWrapStats();
  const conversations = useGiftWrapConversations();
  const [conversationsPage, setConversationsPage] = useState(1);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const syncEnabled = state.giftWrapSettings?.syncEnabled ?? false;
  const autoDecrypt = state.giftWrapSettings?.autoDecrypt ?? false;

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

  const [isBatchDecrypting, setIsBatchDecrypting] = useState(false);

  const handleBatchDecrypt = async () => {
    setIsBatchDecrypting(true);
    try {
      const count = await giftWrapManager.batchDecryptPending();
      if (count > 0) {
        toast.success(`Decrypted ${count} gift wraps`);
      } else {
        toast.info("No pending gift wraps to decrypt");
      }
    } catch (error) {
      console.error("[Inbox] Error batch decrypting:", error);
      toast.error("Failed to batch decrypt");
    } finally {
      setIsBatchDecrypting(false);
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
      {/* Compact Header - Like req viewer */}
      <div className="border-b px-4 py-2 font-mono text-xs flex items-center justify-between">
        {/* Left: Status */}
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 cursor-help">
                {syncEnabled ? (
                  <ShieldCheck className="size-3 text-green-600/70" />
                ) : (
                  <ShieldAlert className="size-3 text-muted-foreground/50" />
                )}
                <span className="text-muted-foreground">
                  {syncEnabled ? "SYNC" : "OFF"}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {syncEnabled
                  ? "Gift wrap sync enabled"
                  : "Gift wrap sync disabled"}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Right: Stats + Controls */}
        <div className="flex items-center gap-3">
          {/* Stats - Compact numbers only */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground/80">
                {stats.totalGiftWraps}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Total gift wraps</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-green-600/70">
                {stats.successfulDecryptions}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Successfully decrypted</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-red-600/70">{stats.failedDecryptions}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Failed decryptions</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-yellow-600/70">
                {stats.pendingDecryptions}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Pending decryptions</p>
            </TooltipContent>
          </Tooltip>

          {/* Relay Dropdown (no chevron) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 text-muted-foreground/80 hover:text-foreground transition-colors">
                <Radio className="size-3" />
                <span>{dmRelays.length}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>DM Relays</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="max-h-64 overflow-y-auto space-y-1 p-2">
                {dmRelays.length > 0 ? (
                  dmRelays.map((relay) => (
                    <RelayLink
                      key={relay}
                      url={relay}
                      showInboxOutbox={false}
                    />
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground p-2">
                    No DM relays configured. Using general relays from kind
                    10002 or kind 3.
                  </p>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Settings Dropdown (no chevron) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="text-muted-foreground/80 hover:text-foreground transition-colors">
                <Settings className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Settings</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="p-2 space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncEnabled}
                    onChange={handleToggleSync}
                    className="h-3.5 w-3.5"
                  />
                  <span>Enable sync</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoDecrypt}
                    onChange={handleToggleAutoDecrypt}
                    className="h-3.5 w-3.5"
                    disabled={!syncEnabled}
                  />
                  <span>Auto-decrypt</span>
                </label>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLoadOlderGiftWraps}
                disabled={isLoadingOlder}
              >
                {isLoadingOlder ? "Loading..." : "Load Older"}
              </DropdownMenuItem>
              {!autoDecrypt && stats.pendingDecryptions > 0 && (
                <DropdownMenuItem
                  onClick={handleBatchDecrypt}
                  disabled={isBatchDecrypting}
                >
                  {isBatchDecrypting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-3 animate-spin" />
                      Decrypting...
                    </span>
                  ) : (
                    `Decrypt ${stats.pendingDecryptions} Pending`
                  )}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-auto">
        {conversationsList.length === 0 ? (
          <div className="px-4 py-3">
            <div className="py-8 text-center text-muted-foreground">
              <MessageSquare className="mx-auto mb-2 h-12 w-12 opacity-50" />
              {!pubkey ? (
                <>
                  <p>No account active</p>
                  <p className="text-xs mt-1">
                    Login to view your encrypted messages
                  </p>
                </>
              ) : !syncEnabled ? (
                <>
                  <p>Gift wrap sync is disabled</p>
                  <p className="text-xs mt-1">
                    Enable sync in settings to receive NIP-17 messages
                  </p>
                </>
              ) : dmRelays.length === 0 && stats.totalGiftWraps === 0 ? (
                <>
                  <p>No relays configured</p>
                  <p className="text-xs mt-1">
                    Configure kind 10050 (DM relays) or kind 10002 (general
                    relays)
                  </p>
                  <p className="text-xs mt-1">
                    Try clicking "Load Older" to fetch messages from available
                    relays
                  </p>
                </>
              ) : stats.totalGiftWraps === 0 ? (
                <>
                  <p>No gift wraps received yet</p>
                  <p className="text-xs mt-1">
                    Waiting for encrypted messages on {dmRelays.length} relay
                    {dmRelays.length !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs mt-1">
                    Try "Load Older" to fetch older messages
                  </p>
                </>
              ) : (
                <>
                  <p>No conversations yet</p>
                  <p className="text-xs mt-1">
                    Start a chat using: <code>chat npub...</code>
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <div>
              {conversationsList.map(({ key, latestMessage, otherPubkey }) => (
                <ConversationRow
                  key={key}
                  conversationKey={key}
                  otherPubkey={otherPubkey}
                  latestMessage={latestMessage}
                  onClick={() => handleOpenConversation(key, otherPubkey)}
                />
              ))}
            </div>
            {hasMoreConversations && (
              <div className="border-t p-2 text-center">
                <button
                  onClick={handleLoadMoreConversations}
                  disabled={isLoadingMore}
                  className="w-full rounded px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {isLoadingMore
                    ? "Loading..."
                    : `Load More (${totalConversations - conversationsList.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}
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
  const displayName = getDisplayName(otherPubkey, profile);

  // Format timestamp
  const timestamp = new Date(latestMessage.createdAt * 1000);
  const now = new Date();
  const isToday = timestamp.toDateString() === now.toDateString();
  const timeStr = isToday
    ? timestamp.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : timestamp.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });

  // Truncate content preview
  const preview = latestMessage.content.slice(0, 50);
  const truncated = latestMessage.content.length > 50;

  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 hover:bg-muted/30 last:border-b-0 font-mono text-xs"
    >
      {/* Name */}
      <span className="w-28 shrink-0 truncate font-medium text-muted-foreground">
        {displayName}
      </span>

      {/* Message preview */}
      <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
        {preview}
        {truncated && "..."}
      </span>

      {/* Timestamp */}
      <span className="shrink-0 text-muted-foreground/50">{timeStr}</span>
    </div>
  );
}
