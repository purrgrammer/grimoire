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
import { Settings, MessageSquare, ChevronDown, Radio } from "lucide-react";
import { toast } from "sonner";
import giftWrapManager from "@/services/gift-wrap";
import { RelayLink } from "@/components/nostr/RelayLink";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
  const [relaysOpen, setRelaysOpen] = useState(false);

  const syncEnabled = state.giftWrapSettings?.syncEnabled ?? false;
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
      {/* Header - Single Row with Heading, Stats, Relays, Settings */}
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Heading */}
          <h2 className="text-lg font-semibold">Inbox</h2>

          {/* Center: Gift Wrap Stats */}
          <div className="flex flex-1 items-center justify-center gap-6">
            <div className="text-center">
              <div className="text-lg font-bold">{stats.totalGiftWraps}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">
                {stats.successfulDecryptions}
              </div>
              <div className="text-xs text-muted-foreground">Success</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-red-600">
                {stats.failedDecryptions}
              </div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-yellow-600">
                {stats.pendingDecryptions}
              </div>
              <div className="text-xs text-muted-foreground">Pending</div>
            </div>
          </div>

          {/* Right: Relay dropdown + Settings */}
          <div className="flex items-center gap-2">
            {/* Relay Icon + Count Dropdown */}
            <Collapsible open={relaysOpen} onOpenChange={setRelaysOpen}>
              <CollapsibleTrigger asChild>
                <button
                  className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-muted"
                  title="DM Relays"
                >
                  <Radio className="h-4 w-4" />
                  <span className="text-sm font-medium">{dmRelays.length}</span>
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${relaysOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
              {relaysOpen && (
                <div className="absolute right-16 top-14 z-10 w-72 rounded-md border bg-popover p-3 shadow-lg">
                  <CollapsibleContent className="space-y-1.5">
                    <div className="mb-2 text-xs font-semibold text-muted-foreground">
                      DM RELAYS
                    </div>
                    {dmRelays.length > 0 ? (
                      dmRelays.map((relay) => (
                        <RelayLink
                          key={relay}
                          url={relay}
                          showInboxOutbox={false}
                        />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No DM relays configured. Using general relays from kind
                        10002 or kind 3.
                      </p>
                    )}
                  </CollapsibleContent>
                </div>
              )}
            </Collapsible>

            {/* Settings Icon */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="rounded p-2 hover:bg-muted"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Settings Panel (Collapsible) */}
      {showSettings && (
        <div className="border-b bg-muted/50 px-4 py-3">
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
            <button
              onClick={handleLoadOlderGiftWraps}
              disabled={isLoadingOlder}
              className="mt-2 w-full rounded px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              {isLoadingOlder ? "Loading..." : "Load Older Gift Wraps"}
            </button>
          </div>
        </div>
      )}

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
      className="flex cursor-pointer items-center gap-3 border-b px-4 py-2 hover:bg-muted/50 last:border-b-0"
    >
      {/* Avatar placeholder */}
      <div className="h-8 w-8 shrink-0 rounded-full bg-primary/20" />

      {/* Name */}
      <span className="w-32 shrink-0 truncate font-medium text-sm">
        {displayName}
      </span>

      {/* Message preview */}
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {preview}
        {truncated && "..."}
      </span>

      {/* Timestamp */}
      <span className="shrink-0 text-xs text-muted-foreground">{timeStr}</span>
    </div>
  );
}
