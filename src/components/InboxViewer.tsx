/**
 * InboxViewer - Private DM Inbox (NIP-17/59 Gift Wrapped Messages)
 *
 * Displays list of encrypted DM conversations using gift wraps.
 * Messages are cached after decryption to avoid re-decryption on page load.
 *
 * Features:
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
} from "lucide-react";
import accountManager from "@/services/accounts";
import { ChatViewer } from "./ChatViewer";
import type { ProtocolIdentifier } from "@/types/chat";
import { cn } from "@/lib/utils";
import Timestamp from "./Timestamp";
import { UserName } from "./nostr/UserName";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Nip17Adapter } from "@/lib/chat/adapters/nip-17-adapter";
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
 * Conversation info for display
 */
interface ConversationInfo {
  id: string;
  partnerPubkey: string;
  lastMessage?: {
    content: string;
    timestamp: number;
    isOwn: boolean;
  };
}

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
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 cursor-crosshair hover:bg-muted/50 transition-colors border-b",
        isSelected && "bg-muted/70",
      )}
      onClick={onClick}
    >
      <UserAvatar pubkey={conversation.partnerPubkey} className="size-10" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <UserName
            pubkey={conversation.partnerPubkey}
            className="text-sm font-medium truncate"
          />
          {conversation.lastMessage && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              <Timestamp timestamp={conversation.lastMessage.timestamp} />
            </span>
          )}
        </div>
        {conversation.lastMessage && (
          <div className="text-xs text-muted-foreground truncate">
            {conversation.lastMessage.isOwn && (
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
 * InboxViewer - Main inbox component
 */
export function InboxViewer() {
  const activeAccount = use$(accountManager.active$);
  const activePubkey = activeAccount?.pubkey;

  // Mobile detection
  const isMobile = useIsMobile();

  // State
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);

  // NIP-17 adapter instance
  const adapter = useMemo(() => new Nip17Adapter(), []);

  // Get pending count
  const pendingCount = use$(() => adapter.getPendingCount$(), [adapter]) ?? 0;

  // Get conversations from adapter
  const conversations = use$(
    () => (activePubkey ? adapter.getConversations$() : undefined),
    [adapter, activePubkey],
  );

  // Convert to display format
  const conversationList = useMemo(() => {
    if (!conversations || !activePubkey) return [];

    return conversations.map((conv): ConversationInfo => {
      const partner = conv.participants.find((p) => p.pubkey !== activePubkey);
      return {
        id: conv.id,
        partnerPubkey: partner?.pubkey || "",
        lastMessage: conv.lastMessage
          ? {
              content: conv.lastMessage.content,
              timestamp: conv.lastMessage.timestamp,
              isOwn: conv.lastMessage.author === activePubkey,
            }
          : undefined,
      };
    });
  }, [conversations, activePubkey]);

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

  // Handle decrypt
  const handleDecrypt = useCallback(async () => {
    setIsDecrypting(true);
    try {
      const result = await adapter.decryptPending();
      console.log(
        `[Inbox] Decrypted ${result.success} messages, ${result.failed} failed`,
      );
    } catch (error) {
      console.error("[Inbox] Decrypt error:", error);
    } finally {
      setIsDecrypting(false);
    }
  }, [adapter]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      adapter.cleanupAll();
    };
  }, [adapter]);

  // Not signed in
  if (!activePubkey) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground p-4">
        <Lock className="size-8" />
        <span className="text-sm">Sign in to view your encrypted messages</span>
      </div>
    );
  }

  // Sidebar content
  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 mb-3">
          <Mail className="size-5" />
          <h2 className="font-semibold">Private Messages</h2>
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
          <SheetContent side="left" className="w-[300px] p-0">
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
