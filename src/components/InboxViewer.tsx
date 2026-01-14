/**
 * InboxViewer - Private DM Inbox (NIP-17/59 Gift Wrapped Messages)
 *
 * Displays list of encrypted DM conversations using gift wraps.
 * Requires GiftWrapService to be enabled for subscription and decryption.
 *
 * Features:
 * - Toggle to enable/disable gift wrap subscription
 * - Lists all DM conversations from decrypted gift wraps
 * - Shows pending (undecrypted) message count
 * - Explicit decrypt button (no auto-decrypt)
 * - Opens individual DM conversations in ChatViewer
 */
import { useState, useMemo, memo, useCallback, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import {
  Loader2,
  Lock,
  Unlock,
  Mail,
  AlertCircle,
  PanelLeft,
  Bookmark,
  Power,
  PowerOff,
} from "lucide-react";
import { toast } from "sonner";
import accountManager from "@/services/accounts";
import { giftWrapService } from "@/services/gift-wrap-service";
import { ChatViewer } from "./ChatViewer";
import type { ProtocolIdentifier } from "@/types/chat";
import { cn } from "@/lib/utils";
import Timestamp from "./Timestamp";
import { UserName } from "./nostr/UserName";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { nip17Adapter } from "@/lib/chat/adapters/nip-17-adapter";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";

/**
 * UserAvatar - Display a user's avatar with profile data
 */
const UserAvatar = memo(function UserAvatar({
  pubkey,
  className,
}: {
  pubkey: string;
  className?: string;
}) {
  const profile = useProfile(pubkey);
  const name = getDisplayName(pubkey, profile);

  return (
    <Avatar className={className}>
      <AvatarImage src={profile?.picture} alt={name} />
      <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
});

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

/**
 * Format relay URL for display
 */
function formatRelayForDisplay(url: string): string {
  return url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
}

/**
 * Conversation info for display
 */
interface ConversationInfo {
  id: string;
  partnerPubkey: string;
  isSavedMessages?: boolean;
  inboxRelays?: string[];
  lastMessage?: {
    content: string;
    timestamp: number;
    isOwn: boolean;
  };
}

/**
 * SavedMessagesAvatar - Special avatar for saved messages
 */
const SavedMessagesAvatar = memo(function SavedMessagesAvatar({
  className,
}: {
  className?: string;
}) {
  return (
    <Avatar className={className}>
      <AvatarFallback className="bg-primary/20 text-primary">
        <Bookmark className="size-4" />
      </AvatarFallback>
    </Avatar>
  );
});

/**
 * ConversationListItem - Single conversation in the list
 */
const ConversationListItem = memo(function ConversationListItem({
  conversation,
  isSelected,
  onClick,
}: {
  conversation: ConversationInfo;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isSaved = conversation.isSavedMessages;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 cursor-crosshair hover:bg-muted/50 transition-colors border-b",
        isSelected && "bg-muted/70",
      )}
      onClick={onClick}
    >
      {isSaved ? (
        <SavedMessagesAvatar className="size-9" />
      ) : (
        <UserAvatar pubkey={conversation.partnerPubkey} className="size-9" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          {isSaved ? (
            <span className="text-sm font-medium truncate">Saved Messages</span>
          ) : (
            <UserName
              pubkey={conversation.partnerPubkey}
              className="text-sm font-medium truncate"
            />
          )}
          {conversation.lastMessage && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              <Timestamp timestamp={conversation.lastMessage.timestamp} />
            </span>
          )}
        </div>
        {/* Inbox relays - don't show for saved messages */}
        {!isSaved &&
          conversation.inboxRelays &&
          conversation.inboxRelays.length > 0 && (
            <div className="text-[10px] text-muted-foreground/60 truncate">
              {conversation.inboxRelays.map(formatRelayForDisplay).join(", ")}
            </div>
          )}
        {conversation.lastMessage && (
          <div className="text-xs text-muted-foreground truncate">
            {conversation.lastMessage.isOwn && !isSaved && (
              <span className="text-muted-foreground/70">You: </span>
            )}
            {conversation.lastMessage.content}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * DecryptButton - Shows pending count and triggers decryption
 */
const DecryptButton = memo(function DecryptButton({
  pendingCount,
  isDecrypting,
  onDecrypt,
}: {
  pendingCount: number;
  isDecrypting: boolean;
  onDecrypt: () => void;
}) {
  if (pendingCount === 0) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 w-full"
      onClick={onDecrypt}
      disabled={isDecrypting}
    >
      {isDecrypting ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          Decrypting...
        </>
      ) : (
        <>
          <Unlock className="size-4" />
          Decrypt {pendingCount} message{pendingCount !== 1 ? "s" : ""}
        </>
      )}
    </Button>
  );
});

/**
 * MemoizedChatViewer - Memoized chat viewer to prevent unnecessary re-renders
 */
const MemoizedChatViewer = memo(
  function MemoizedChatViewer({
    partnerPubkey,
    headerPrefix,
  }: {
    partnerPubkey: string;
    headerPrefix?: React.ReactNode;
  }) {
    return (
      <ChatViewer
        protocol="nip-17"
        identifier={
          {
            type: "dm-recipient",
            value: partnerPubkey,
          } as ProtocolIdentifier
        }
        headerPrefix={headerPrefix}
      />
    );
  },
  (prev, next) => prev.partnerPubkey === next.partnerPubkey,
);

/**
 * EnableGiftWrapPrompt - Shown when gift wrap is not enabled
 */
function EnableGiftWrapPrompt({ onEnable }: { onEnable: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground p-6 text-center">
      <Lock className="size-12 opacity-50" />
      <div className="space-y-2">
        <h3 className="text-lg font-medium text-foreground">
          Gift Wrap Subscription Disabled
        </h3>
        <p className="text-sm max-w-sm">
          Enable gift wrap subscription to receive and decrypt private messages.
          Gift wraps (NIP-59) are used for encrypted communication.
        </p>
      </div>
      <Button onClick={onEnable} className="gap-2">
        <Power className="size-4" />
        Enable Gift Wraps
      </Button>
    </div>
  );
}

/**
 * InboxViewer - Main inbox component
 */
export function InboxViewer() {
  const activeAccount = use$(accountManager.active$);
  const activePubkey = activeAccount?.pubkey;

  // Gift wrap service state
  const isGiftWrapEnabled =
    use$(() => giftWrapService.isEnabled$(), []) ?? false;
  const pendingCount = use$(() => giftWrapService.getPendingCount$(), []) ?? 0;

  // Mobile detection
  const isMobile = useIsMobile();

  // State
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);

  // Get conversations from adapter (requires gift wrap service to be enabled)
  const conversations = use$(
    () =>
      activePubkey && isGiftWrapEnabled
        ? nip17Adapter.getConversations$()
        : undefined,
    [activePubkey, isGiftWrapEnabled],
  );

  // Track inbox relays for each partner
  const [partnerRelays, setPartnerRelays] = useState<Map<string, string[]>>(
    new Map(),
  );

  // Fetch inbox relays for conversation partners
  useEffect(() => {
    if (!conversations || !isGiftWrapEnabled) return;

    const fetchRelays = async () => {
      const newRelays = new Map<string, string[]>();

      for (const conv of conversations) {
        const partner = conv.participants.find(
          (p) => p.pubkey !== activePubkey,
        );
        if (!partner) continue;

        // Skip if already fetched
        if (partnerRelays.has(partner.pubkey)) {
          newRelays.set(partner.pubkey, partnerRelays.get(partner.pubkey)!);
          continue;
        }

        try {
          const relays = await nip17Adapter.getInboxRelays(partner.pubkey);
          newRelays.set(partner.pubkey, relays);
        } catch {
          newRelays.set(partner.pubkey, []);
        }
      }

      setPartnerRelays(newRelays);
    };

    fetchRelays();
  }, [conversations, activePubkey, partnerRelays, isGiftWrapEnabled]);

  // Convert to display format
  const conversationList = useMemo(() => {
    if (!conversations || !activePubkey) return [];

    return conversations.map((conv): ConversationInfo => {
      // Check if this is a saved messages conversation
      const isSavedMessages = conv.metadata?.isSavedMessages === true;

      // For saved messages, partner is self; otherwise find the other participant
      const partner = isSavedMessages
        ? { pubkey: activePubkey }
        : conv.participants.find((p) => p.pubkey !== activePubkey);
      const partnerPubkey = partner?.pubkey || activePubkey;

      return {
        id: conv.id,
        partnerPubkey,
        isSavedMessages,
        inboxRelays: isSavedMessages
          ? undefined
          : partnerRelays.get(partnerPubkey),
        lastMessage: conv.lastMessage
          ? {
              content: conv.lastMessage.content,
              timestamp: conv.lastMessage.timestamp,
              isOwn: conv.lastMessage.author === activePubkey,
            }
          : undefined,
      };
    });
  }, [conversations, activePubkey, partnerRelays]);

  // Handle conversation selection
  const handleSelect = useCallback(
    (partnerPubkey: string) => {
      setSelectedPartner(partnerPubkey);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile],
  );

  // Handle enable gift wrap
  const handleEnableGiftWrap = useCallback(() => {
    giftWrapService.enable();
    toast.success("Gift wrap subscription enabled");
  }, []);

  // Handle disable gift wrap
  const handleDisableGiftWrap = useCallback(() => {
    giftWrapService.disable();
    toast.info("Gift wrap subscription disabled");
  }, []);

  // Handle decrypt
  const handleDecrypt = useCallback(async () => {
    setIsDecrypting(true);
    try {
      const result = await giftWrapService.decryptPending();
      console.log(
        `[Inbox] Decrypted ${result.success} messages, ${result.failed} failed`,
      );
      if (result.success > 0) {
        toast.success(
          `Decrypted ${result.success} message${result.success !== 1 ? "s" : ""}`,
        );
      }
      if (result.failed > 0) {
        toast.warning(
          `${result.failed} message${result.failed !== 1 ? "s" : ""} failed to decrypt`,
        );
      }
    } catch (error) {
      console.error("[Inbox] Decrypt error:", error);
      toast.error("Failed to decrypt messages");
    } finally {
      setIsDecrypting(false);
    }
  }, []);

  // Handle resize
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const newWidth = startWidth + deltaX;
        setSidebarWidth(Math.max(200, Math.min(500, newWidth)));
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    },
    [sidebarWidth],
  );

  // Not signed in
  if (!activePubkey) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground p-4">
        <Lock className="size-8" />
        <span className="text-sm">Sign in to view your encrypted messages</span>
      </div>
    );
  }

  // Gift wrap not enabled
  if (!isGiftWrapEnabled) {
    return <EnableGiftWrapPrompt onEnable={handleEnableGiftWrap} />;
  }

  // Sidebar content
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="size-5" />
            <h2 className="font-semibold">Private Messages</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 gap-1 text-xs"
            onClick={() => {
              if (isGiftWrapEnabled) {
                handleDisableGiftWrap();
              } else {
                handleEnableGiftWrap();
              }
            }}
          >
            {isGiftWrapEnabled ? (
              <Power className="size-3 text-green-500" />
            ) : (
              <PowerOff className="size-3 text-muted-foreground" />
            )}
          </Button>
        </div>
        <DecryptButton
          pendingCount={pendingCount || 0}
          isDecrypting={isDecrypting}
          onDecrypt={handleDecrypt}
        />
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {conversationList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-4 text-center">
            <AlertCircle className="size-6" />
            <span className="text-sm">
              {(pendingCount || 0) > 0
                ? "Decrypt messages to see conversations"
                : "No conversations yet"}
            </span>
          </div>
        ) : (
          conversationList.map((conv) => (
            <ConversationListItem
              key={conv.id}
              conversation={conv}
              isSelected={selectedPartner === conv.partnerPubkey}
              onClick={() => handleSelect(conv.partnerPubkey)}
            />
          ))
        )}
      </div>
    </div>
  );

  // Sidebar toggle button for mobile
  const sidebarToggle = isMobile ? (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 flex-shrink-0"
      onClick={() => setSidebarOpen(true)}
    >
      <PanelLeft className="size-4" />
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  ) : null;

  // Chat content
  const chatContent = selectedPartner ? (
    <MemoizedChatViewer
      partnerPubkey={selectedPartner}
      headerPrefix={sidebarToggle}
    />
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      {isMobile ? (
        <Button
          variant="outline"
          onClick={() => setSidebarOpen(true)}
          className="gap-2"
        >
          <PanelLeft className="size-4" />
          Select a conversation
        </Button>
      ) : (
        <>
          <Mail className="size-8 opacity-50" />
          <span className="text-sm">Select a conversation</span>
        </>
      )}
    </div>
  );

  // Mobile layout
  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-[280px] p-0">
            <VisuallyHidden.Root>
              <SheetTitle>Messages</SheetTitle>
            </VisuallyHidden.Root>
            <div className="flex h-full flex-col pt-10">{sidebarContent}</div>
          </SheetContent>
        </Sheet>

        <div className="flex-1 min-h-0">{chatContent}</div>
      </div>
    );
  }

  // Desktop layout
  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside
        className="flex flex-col border-r bg-background"
        style={{ width: sidebarWidth }}
      >
        {sidebarContent}
      </aside>

      {/* Resize handle */}
      <div
        className={cn(
          "w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors",
          isResizing && "bg-primary",
        )}
        onMouseDown={handleMouseDown}
      />

      {/* Chat panel */}
      <div className="flex-1 min-w-0">{chatContent}</div>
    </div>
  );
}
