import { useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import { nip19, NostrEvent } from "nostr-tools";
import {
  Mail,
  MailOpen,
  Lock,
  Unlock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Radio,
  RefreshCw,
  Settings,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { RelayLink } from "@/components/nostr/RelayLink";
import { UserName } from "@/components/nostr/UserName";

import giftWrapService from "@/services/gift-wrap";
import accounts from "@/services/accounts";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";
import { RichText } from "./nostr/RichText";

/**
 * InboxViewer - Manage private messages (NIP-17/59 gift wraps)
 */
function InboxViewer() {
  const { addWindow } = useGrimoire();
  const account = use$(accounts.active$);
  const settings = use$(giftWrapService.settings$);
  const syncStatus = use$(giftWrapService.syncStatus$);
  const giftWraps = use$(giftWrapService.giftWraps$);
  const decryptStates = use$(giftWrapService.decryptStates$);
  const conversations = use$(giftWrapService.conversations$);
  const inboxRelays = use$(giftWrapService.inboxRelays$);

  const [isDecryptingAll, setIsDecryptingAll] = useState(false);

  // Note: Gift wrap service initializes ON-DEMAND when user enables inbox sync
  // This prevents automatic network requests and heavy I/O on login
  // Toggle "Enable Inbox Sync" below to start receiving DMs

  // Update signer when it changes (in case user switches signers)
  useEffect(() => {
    if (account?.signer) {
      giftWrapService.setSigner(account.signer);
    }
  }, [account?.signer]);

  // Calculate counts
  const counts = {
    pending: 0,
    decrypting: 0,
    success: 0,
    error: 0,
    total: giftWraps?.length ?? 0,
  };

  if (decryptStates) {
    for (const state of decryptStates.values()) {
      switch (state.status) {
        case "pending":
          counts.pending++;
          break;
        case "decrypting":
          counts.decrypting++;
          break;
        case "success":
          counts.success++;
          break;
        case "error":
          counts.error++;
          break;
      }
    }
  }

  const handleToggleEnabled = (checked: boolean) => {
    giftWrapService.updateSettings({ enabled: checked });
  };

  const handleToggleAutoDecrypt = (checked: boolean) => {
    giftWrapService.updateSettings({ autoDecrypt: checked });
  };

  const handleDecryptAll = async () => {
    if (!account?.signer) {
      toast.error(
        "No signer available. Please log in with a signer that supports encryption.",
      );
      return;
    }

    setIsDecryptingAll(true);
    try {
      const result = await giftWrapService.decryptAll();
      if (result.success > 0) {
        toast.success(`Decrypted ${result.success} messages`);
      }
      if (result.error > 0) {
        toast.error(`Failed to decrypt ${result.error} messages`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to decrypt messages",
      );
    } finally {
      setIsDecryptingAll(false);
    }
  };

  const handleRefresh = () => {
    giftWrapService.startSync();
  };

  if (!account) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background text-foreground">
        <div className="text-center text-muted-foreground font-mono text-sm p-4">
          <Lock className="size-8 mx-auto mb-2 opacity-50" />
          <p>Log in to access private messages</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Compact Title Bar (similar to ChatViewer) */}
      <div className="pl-2 pr-0 border-b w-full py-1">
        <div className="flex items-center justify-between gap-1">
          {/* Left side: Icon + Title */}
          <div className="flex items-center gap-1 min-w-0">
            <Mail className="size-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-semibold">Inbox</span>
          </div>

          {/* Center: Decrypt stats badges */}
          {settings?.enabled && counts.total > 0 && (
            <div className="flex items-center gap-0.5 absolute left-1/2 -translate-x-1/2">
              <StatusBadge status="success" count={counts.success} />
              <StatusBadge
                status="pending"
                count={counts.pending + counts.decrypting}
              />
              <StatusBadge status="error" count={counts.error} />
            </div>
          )}

          {/* Right side: Decrypt + Refresh + Relay Dropdown + Settings Dropdown */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground p-1">
            {/* Decrypt action when auto-decrypt is off and there are pending messages */}
            {settings?.enabled &&
              !settings?.autoDecrypt &&
              (counts.pending > 0 || counts.decrypting > 0) && (
                <button
                  onClick={handleDecryptAll}
                  disabled={isDecryptingAll || !account?.signer}
                  className="hover:text-foreground transition-colors disabled:opacity-50"
                  aria-label={`Decrypt ${counts.pending + counts.decrypting} pending messages`}
                >
                  {isDecryptingAll ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Unlock className="size-4" />
                  )}
                </button>
              )}

            {/* Sync status indicator */}
            {syncStatus === "syncing" && (
              <Loader2 className="size-4 animate-spin" />
            )}

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={!settings?.enabled || syncStatus === "syncing"}
              className="hover:text-foreground transition-colors disabled:opacity-50"
              aria-label="Refresh inbox"
            >
              <RefreshCw className="size-4" />
            </button>

            {/* Relay dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="hover:text-foreground transition-colors disabled:opacity-50 flex items-center gap-0.5">
                  <Radio className="size-4" />
                  <span>{inboxRelays?.length ?? 0}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs">
                  DM Inbox Relays (kind 10050)
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {inboxRelays && inboxRelays.length > 0 ? (
                  <div className="px-2 py-1 space-y-1 max-h-48 overflow-y-auto">
                    {inboxRelays.map((relay) => (
                      <RelayLink
                        key={relay}
                        url={relay}
                        className="text-xs"
                        iconClassname="size-3"
                        urlClassname="text-xs"
                      />
                    ))}
                  </div>
                ) : (
                  <DropdownMenuItem disabled className="text-xs">
                    <AlertCircle className="size-3 mr-2 text-yellow-500" />
                    No relays configured
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Settings dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="hover:text-foreground transition-colors">
                  <Settings className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs">
                  Inbox Settings
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={settings?.enabled ?? false}
                  onCheckedChange={handleToggleEnabled}
                  className="text-xs"
                >
                  Enable inbox sync
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={settings?.autoDecrypt ?? false}
                  onCheckedChange={handleToggleAutoDecrypt}
                  disabled={!settings?.enabled}
                  className="text-xs"
                >
                  Auto-decrypt messages
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Compact Conversations List (mail-like) */}
      <div className="flex-1 overflow-y-auto">
        {settings?.enabled && conversations && conversations.length > 0 ? (
          <>
            {conversations.map((conv) => (
              <CompactConversationRow
                key={conv.id}
                conversation={conv}
                currentUserPubkey={account.pubkey}
                onClick={() => {
                  const others = conv.participants.filter(
                    (p) => p !== account.pubkey,
                  );
                  const value =
                    others.length === 0 ? account.pubkey : others.join(",");

                  // Generate command string for edit functionality
                  const recipientPubkeys =
                    others.length === 0 ? [account.pubkey] : others;
                  const npubs = recipientPubkeys.map((pk) =>
                    nip19.npubEncode(pk),
                  );
                  const commandString = `chat ${npubs.join(",")}`;

                  addWindow(
                    "chat",
                    {
                      identifier: {
                        type: "dm-recipient" as const,
                        value,
                        relays: [],
                      },
                      protocol: "nip-17",
                    },
                    commandString,
                  );
                }}
              />
            ))}
          </>
        ) : settings?.enabled && counts.success === 0 ? (
          <div className="text-center text-muted-foreground font-mono text-sm p-8">
            <MailOpen className="size-8 mx-auto mb-2 opacity-50" />
            <p>No conversations yet</p>
            {counts.pending > 0 && (
              <p className="text-xs mt-2">
                Decrypt pending messages to see conversations
              </p>
            )}
          </div>
        ) : !settings?.enabled ? (
          <div className="text-center text-muted-foreground font-mono text-sm p-8">
            <Mail className="size-8 mx-auto mb-2 opacity-50" />
            <p>Enable inbox sync to receive private messages</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface StatusBadgeProps {
  status: "success" | "pending" | "error";
  count: number;
}

function StatusBadge({ status, count }: StatusBadgeProps) {
  if (count === 0) return null;

  const config = {
    success: {
      icon: CheckCircle2,
      className: "bg-green-500/10 text-green-500 border-green-500/20",
    },
    pending: {
      icon: Clock,
      className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    },
    error: {
      icon: AlertCircle,
      className: "bg-red-500/10 text-red-500 border-red-500/20",
    },
  };

  const { icon: Icon, className } = config[status];

  return (
    <Badge
      variant="outline"
      className={cn("gap-0.5 h-5 px-1.5 text-xs", className)}
    >
      <Icon className="size-3" />
      {count}
    </Badge>
  );
}

interface ConversationRowProps {
  conversation: {
    id: string;
    participants: string[];
    lastMessage?: { content: string; created_at: number; pubkey: string };
  };
  currentUserPubkey: string;
  onClick: () => void;
}

/**
 * CompactConversationRow - Mail-like compact conversation list item
 * Shows: username text preview timestamp (all inline, minimal spacing)
 */
function CompactConversationRow({
  conversation,
  currentUserPubkey,
  onClick,
}: ConversationRowProps) {
  // Filter out current user from participants for display
  const otherParticipants = conversation.participants.filter(
    (p) => p !== currentUserPubkey,
  );

  // Self-conversation (saved messages)
  const isSelfConversation = otherParticipants.length === 0;

  // Extract subject from last message if present (look for "subject" tag in NIP-17 messages)
  // For now, we don't have subject tag support, so this is left for future
  const subject = undefined;

  return (
    <div
      className="border-b border-border px-2 py-0.5 hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="flex items-baseline gap-1 text-xs">
        {/* Username (inline with text) */}
        <span className="font-medium flex-shrink-0">
          {isSelfConversation ? (
            "Saved Messages"
          ) : (
            <>
              {otherParticipants.slice(0, 2).map((pubkey, i) => (
                <span key={pubkey}>
                  {i > 0 && <span className="text-muted-foreground">, </span>}
                  <UserName pubkey={pubkey} className="text-xs font-medium" />
                </span>
              ))}
              {otherParticipants.length > 2 && (
                <span className="text-muted-foreground">
                  {" "}
                  +{otherParticipants.length - 2}
                </span>
              )}
            </>
          )}
        </span>

        {/* Optional subject (future feature) */}
        {subject && (
          <span className="flex-shrink-0 text-muted-foreground font-medium">
            [{subject}]
          </span>
        )}

        {/* Text preview (flexible width, truncate) - flows right after name */}
        <span className="flex-1 min-w-0 truncate line-clamp-1 text-muted-foreground [&_img]:size-3.5 [&_img]:align-text-bottom pointer-events-none">
          <RichText
            event={conversation.lastMessage as NostrEvent}
            className="inline"
          />
        </span>

        {/* Timestamp (fixed width) */}
        {conversation.lastMessage && (
          <span className="w-12 flex-shrink-0 text-right text-muted-foreground text-[10px]">
            {formatTimestamp(conversation.lastMessage.created_at)}
          </span>
        )}
      </div>
    </div>
  );
}

export default InboxViewer;
