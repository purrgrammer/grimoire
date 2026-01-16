import { useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";
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
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RelayLink } from "@/components/nostr/RelayLink";
import { UserName } from "@/components/nostr/UserName";

import giftWrapService from "@/services/gift-wrap";
import accounts from "@/services/accounts";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/hooks/useLocale";
import type { DecryptStatus } from "@/services/gift-wrap";
import { useGrimoire } from "@/core/state";

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

  // Initialize service when account changes
  useEffect(() => {
    if (account) {
      giftWrapService.init(account.pubkey, account.signer ?? null);
    }
  }, [account]);

  // Update signer when it changes
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
      {/* Settings Section */}
      <div className="border-b border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="size-5 text-muted-foreground" />
            <span className="font-semibold">Private Messages</span>
          </div>
          <div className="flex items-center gap-2">
            {syncStatus === "syncing" && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={!settings?.enabled || syncStatus === "syncing"}
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>

        {/* Enable/Disable Toggle */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="inbox-enabled"
            checked={settings?.enabled ?? false}
            onCheckedChange={handleToggleEnabled}
          />
          <label htmlFor="inbox-enabled" className="text-sm cursor-pointer">
            Enable gift wrap sync
          </label>
        </div>

        {/* Auto-decrypt Toggle */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="auto-decrypt"
            checked={settings?.autoDecrypt ?? false}
            onCheckedChange={handleToggleAutoDecrypt}
            disabled={!settings?.enabled}
          />
          <label
            htmlFor="auto-decrypt"
            className={cn(
              "text-sm cursor-pointer",
              !settings?.enabled && "text-muted-foreground",
            )}
          >
            Auto-decrypt messages
          </label>
        </div>
      </div>

      {/* Inbox Relays Section */}
      {inboxRelays && inboxRelays.length > 0 && (
        <div className="border-b border-border">
          <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground flex items-center gap-2">
            <Radio className="size-3.5" />
            <span>DM Inbox Relays (kind 10050)</span>
          </div>
          <div className="px-4 py-2 space-y-1">
            {inboxRelays.map((relay) => (
              <RelayLink
                key={relay}
                url={relay}
                className="text-sm"
                iconClassname="size-4"
                urlClassname="text-sm"
              />
            ))}
          </div>
        </div>
      )}

      {inboxRelays && inboxRelays.length === 0 && settings?.enabled && (
        <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-yellow-500" />
            <span>No DM inbox relays configured (kind 10050)</span>
          </div>
        </div>
      )}

      {/* Decrypt Status Section */}
      {settings?.enabled && counts.total > 0 && (
        <div className="border-b border-border">
          <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground flex items-center justify-between">
            <span>Gift Wraps ({counts.total})</span>
            <div className="flex items-center gap-2">
              <StatusBadge status="success" count={counts.success} />
              <StatusBadge
                status="pending"
                count={counts.pending + counts.decrypting}
              />
              <StatusBadge status="error" count={counts.error} />
            </div>
          </div>

          {/* Only show manual decrypt options when auto-decrypt is OFF */}
          {!settings?.autoDecrypt &&
            (counts.pending > 0 || counts.decrypting > 0) && (
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {counts.pending + counts.decrypting} messages waiting to be
                  decrypted
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleDecryptAll}
                  disabled={isDecryptingAll || !account?.signer}
                >
                  {isDecryptingAll ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Decrypting...
                    </>
                  ) : (
                    <>
                      <Unlock className="size-4 mr-2" />
                      Decrypt All
                    </>
                  )}
                </Button>
              </div>
            )}

          {/* Show auto-decrypt status when enabled and there are pending messages */}
          {settings?.autoDecrypt &&
            (counts.pending > 0 || counts.decrypting > 0) && (
              <div className="px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>Auto-decrypting messages...</span>
              </div>
            )}
        </div>
      )}

      {/* Conversations Section */}
      <div className="flex-1 overflow-y-auto">
        {settings?.enabled && conversations && conversations.length > 0 && (
          <>
            <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground flex items-center gap-2">
              <MessageSquare className="size-3.5" />
              <span>Recent Conversations ({conversations.length})</span>
            </div>
            {conversations.map((conv) => (
              <ConversationRow
                key={conv.id}
                conversation={conv}
                currentUserPubkey={account.pubkey}
                onClick={() => {
                  // Build chat identifier from participants
                  // For self-chat, use $me; for others, use comma-separated npubs
                  const others = conv.participants.filter(
                    (p) => p !== account.pubkey,
                  );
                  const identifier =
                    others.length === 0 ? "$me" : others.join(",");
                  addWindow("chat", {
                    identifier,
                    protocol: "nip-17",
                  });
                }}
              />
            ))}
          </>
        )}

        {settings?.enabled &&
          (!conversations || conversations.length === 0) &&
          counts.success === 0 && (
            <div className="text-center text-muted-foreground font-mono text-sm p-8">
              <MailOpen className="size-8 mx-auto mb-2 opacity-50" />
              <p>No conversations yet</p>
              {counts.pending > 0 && (
                <p className="text-xs mt-2">
                  Decrypt pending messages to see conversations
                </p>
              )}
            </div>
          )}

        {!settings?.enabled && (
          <div className="text-center text-muted-foreground font-mono text-sm p-8">
            <Mail className="size-8 mx-auto mb-2 opacity-50" />
            <p>Enable gift wrap sync to receive private messages</p>
          </div>
        )}
      </div>

      {/* Pending Gift Wraps List (for manual decrypt) */}
      {settings?.enabled && !settings.autoDecrypt && counts.pending > 0 && (
        <PendingGiftWrapsList
          decryptStates={decryptStates}
          giftWraps={giftWraps ?? []}
          onDecrypt={async (id) => {
            try {
              const result = await giftWrapService.decrypt(id);
              if (result) {
                toast.success("Message decrypted");
              } else {
                // Decryption failed but didn't throw
                const state = giftWrapService.decryptStates$.value.get(id);
                toast.error(state?.error || "Failed to decrypt message");
              }
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "Decryption failed",
              );
            }
          }}
        />
      )}
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
    <Badge variant="outline" className={cn("gap-1", className)}>
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

function ConversationRow({
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

  return (
    <div
      className="border-b border-border px-4 py-2 hover:bg-muted/30 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            {isSelfConversation ? (
              <span className="text-sm font-medium">Saved Messages</span>
            ) : (
              <>
                {otherParticipants.slice(0, 3).map((pubkey, i) => (
                  <span key={pubkey} className="inline-flex items-center">
                    {i > 0 && (
                      <span className="text-muted-foreground mr-1">,</span>
                    )}
                    <UserName pubkey={pubkey} className="text-sm font-medium" />
                  </span>
                ))}
                {otherParticipants.length > 3 && (
                  <span className="text-xs text-muted-foreground ml-1">
                    +{otherParticipants.length - 3}
                  </span>
                )}
              </>
            )}
          </div>
          {conversation.lastMessage && (
            <p className="text-xs text-muted-foreground truncate">
              {conversation.lastMessage.content}
            </p>
          )}
        </div>
        {conversation.lastMessage && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {formatTimestamp(conversation.lastMessage.created_at)}
          </span>
        )}
      </div>
    </div>
  );
}

interface PendingGiftWrapsListProps {
  decryptStates:
    | Map<string, { status: DecryptStatus; error?: string }>
    | undefined;
  giftWraps: { id: string; created_at: number }[];
  onDecrypt: (id: string) => Promise<void>;
}

function PendingGiftWrapsList({
  decryptStates,
  giftWraps,
  onDecrypt,
}: PendingGiftWrapsListProps) {
  const [decryptingIds, setDecryptingIds] = useState<Set<string>>(new Set());

  const pendingWraps = giftWraps.filter((gw) => {
    const state = decryptStates?.get(gw.id);
    return state?.status === "pending" || state?.status === "error";
  });

  if (pendingWraps.length === 0) return null;

  return (
    <div className="border-t border-border max-h-48 overflow-y-auto">
      <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground">
        Pending Decryption
      </div>
      {pendingWraps.slice(0, 10).map((gw) => {
        const state = decryptStates?.get(gw.id);
        const isDecrypting = decryptingIds.has(gw.id);

        return (
          <div
            key={gw.id}
            className="border-b border-border px-4 py-2 flex items-center justify-between"
          >
            <div className="flex items-center gap-2 min-w-0">
              {state?.status === "error" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertCircle className="size-4 text-red-500 flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{state.error || "Decryption failed"}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Lock className="size-4 text-muted-foreground flex-shrink-0" />
              )}
              <span className="text-xs text-muted-foreground font-mono truncate">
                {gw.id.slice(0, 16)}...
              </span>
              <span className="text-xs text-muted-foreground">
                {formatTimestamp(gw.created_at)}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              disabled={isDecrypting}
              onClick={async () => {
                setDecryptingIds((prev) => new Set([...prev, gw.id]));
                try {
                  await onDecrypt(gw.id);
                } finally {
                  setDecryptingIds((prev) => {
                    const next = new Set(prev);
                    next.delete(gw.id);
                    return next;
                  });
                }
              }}
            >
              {isDecrypting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unlock className="size-4" />
              )}
            </Button>
          </div>
        );
      })}
      {pendingWraps.length > 10 && (
        <div className="px-4 py-2 text-xs text-muted-foreground text-center">
          And {pendingWraps.length - 10} more...
        </div>
      )}
    </div>
  );
}

export default InboxViewer;
