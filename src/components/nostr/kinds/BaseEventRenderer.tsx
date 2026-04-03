import { useState, useCallback } from "react";
import { NostrEvent } from "@/types/nostr";
import { UserName } from "../UserName";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Menu,
  Copy,
  CopyCheck,
  FileJson,
  ExternalLink,
  Zap,
  MessageSquare,
  SmilePlus,
  Bookmark,
  Loader2,
} from "lucide-react";
import { useAddWindow, useGrimoire } from "@/core/state";
import { useCopy } from "@/hooks/useCopy";
import { useAccount } from "@/hooks/useAccount";
import { useSettings } from "@/hooks/useSettings";
import { EventJsonDialog } from "@/components/EventJsonDialog";
import { EmojiPickerDialog } from "@/components/chat/EmojiPickerDialog";
import { formatTimestamp } from "@/hooks/useLocale";
import { nip19 } from "nostr-tools";
import { getTagValue } from "applesauce-core/helpers";
import { parseAddressPointer } from "@/lib/nip89-helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { EventFooter } from "@/components/EventFooter";
import { cn } from "@/lib/utils";
import { isAddressableKind } from "@/lib/nostr-kinds";
import { getSemanticAuthor } from "@/lib/semantic-author";
import { EventFactory } from "applesauce-core/event-factory";
import { ReactionBlueprint } from "@/lib/blueprints";
import { publishEventToRelays } from "@/services/hub";
import { selectRelaysForInteraction } from "@/services/relay-selection";
import type { EmojiTag } from "@/lib/emoji-helpers";
import { useFavoriteList } from "@/hooks/useFavoriteList";
import {
  getFavoriteConfig,
  FALLBACK_FAVORITE_CONFIG,
} from "@/config/favorite-lists";

/**
 * Universal event properties and utilities shared across all kind renderers
 */
export interface BaseEventProps {
  event: NostrEvent;
  depth?: number;
  /**
   * Override the displayed author pubkey when the semantic "author" differs from event.pubkey
   * Examples:
   * - Zaps (kind 9735): Show the zapper, not the lightning service pubkey
   * - Live events (kind 30311): Show the host, not the event publisher
   * - Delegated events: Show the delegator, not the delegate
   */
  authorOverride?: {
    pubkey: string;
    label?: string; // e.g., "Host", "Sender", "Zapper", "From"
  };
}

/**
 * User component - displays author info with profile
 */
export function EventAuthor({
  pubkey,
  label: _label,
  className,
}: {
  pubkey: string;
  label?: string;
  className?: string;
}) {
  return <UserName pubkey={pubkey} className={cn("text-md", className)} />;
}

/**
 * Preview component for a replied-to event in compact mode
 */
/*
function ReplyPreview({
  pointer,
  onClick,
}: {
  pointer: EventPointer | AddressPointer;
  onClick: (e: React.MouseEvent) => void;
}) {
  const event = useNostrEvent(pointer);

  if (!event) {
    return (
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-3.5 w-3.5 rounded-sm opacity-50" />
        <Skeleton className="h-3 w-16 opacity-50" />
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 text-inherit flex-1 cursor-crosshair hover:underline hover:decoration-dotted line-clamp-1 truncate text-sm"
      onClick={onClick}
    >
      <UserName pubkey={event.pubkey} className="font-medium" />
      <RichText
        className="truncate line-clamp-1"
        event={event}
        options={{
          showEventEmbeds: false,
          showMedia: false,
        }}
      />
    </div>
  );
}
*/

/**
 * Shared event action state — used by both EventMenu and EventContextMenu
 * to avoid duplicate hook subscriptions when both are rendered together.
 */
function useEventActions(event: NostrEvent) {
  const addWindow = useAddWindow();
  const { copy, copied } = useCopy();
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const favoriteConfig = getFavoriteConfig(event.kind);
  const { isFavorite, toggleFavorite, isUpdating } = useFavoriteList(
    favoriteConfig ?? FALLBACK_FAVORITE_CONFIG,
  );
  const favorited = favoriteConfig ? isFavorite(event) : false;

  const openEventDetail = useCallback(() => {
    let pointer;
    if (isAddressableKind(event.kind)) {
      const dTag = getTagValue(event, "d") || "";
      pointer = {
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag,
      };
    } else {
      pointer = { id: event.id };
    }
    addWindow("open", { pointer });
  }, [event, addWindow]);

  const copyEventId = useCallback(() => {
    const seenRelaysSet = getSeenRelays(event);
    const relays = seenRelaysSet ? Array.from(seenRelaysSet) : [];

    if (isAddressableKind(event.kind)) {
      const dTag = getTagValue(event, "d") || "";
      copy(
        nip19.naddrEncode({
          kind: event.kind,
          pubkey: event.pubkey,
          identifier: dTag,
          relays,
        }),
      );
    } else {
      copy(
        nip19.neventEncode({
          id: event.id,
          author: event.pubkey,
          relays,
        }),
      );
    }
  }, [event, copy]);

  const viewEventJson = useCallback(() => {
    setJsonDialogOpen(true);
  }, []);

  const zapEvent = useCallback(() => {
    const recipientPubkey = getSemanticAuthor(event);

    if (isAddressableKind(event.kind)) {
      const dTag = getTagValue(event, "d") || "";
      addWindow("zap", {
        recipientPubkey,
        eventPointer: { id: event.id },
        addressPointer: {
          kind: event.kind,
          pubkey: event.pubkey,
          identifier: dTag,
        },
      });
    } else {
      addWindow("zap", {
        recipientPubkey,
        eventPointer: { id: event.id },
      });
    }
  }, [event, addWindow]);

  const openChatWindow = useCallback(() => {
    if (event.kind === 1) {
      const seenRelaysSet = getSeenRelays(event);
      const relays = seenRelaysSet ? Array.from(seenRelaysSet) : [];

      addWindow("chat", {
        protocol: "nip-10",
        identifier: {
          type: "thread",
          value: {
            id: event.id,
            relays,
            author: event.pubkey,
            kind: event.kind,
          },
          relays,
        },
      });
    }
  }, [event, addWindow]);

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(event);
  }, [toggleFavorite, event]);

  return {
    openEventDetail,
    copyEventId,
    viewEventJson,
    zapEvent,
    openChatWindow,
    handleToggleFavorite,
    copied,
    jsonDialogOpen,
    setJsonDialogOpen,
    favoriteConfig,
    favorited,
    isUpdating,
  };
}

type EventActions = ReturnType<typeof useEventActions>;

interface EventMenuItemsProps {
  event: NostrEvent;
  actions: EventActions;
  onReactClick?: () => void;
  canSign?: boolean;
}

/**
 * Shared menu items rendered as either DropdownMenuItems or ContextMenuItems
 */
function EventMenuItems({
  Item,
  Separator,
  event,
  actions,
  onReactClick,
  canSign,
}: EventMenuItemsProps & {
  Item: typeof DropdownMenuItem;
  Separator: typeof DropdownMenuSeparator;
}) {
  return (
    <>
      <Item onClick={actions.openEventDetail}>
        <ExternalLink className="size-4 mr-2" />
        Open
      </Item>
      <Item onClick={actions.zapEvent}>
        <Zap className="size-4 mr-2 text-yellow-500" />
        Zap
      </Item>
      {event.kind === 1 && (
        <Item onClick={actions.openChatWindow}>
          <MessageSquare className="size-4 mr-2" />
          Chat
        </Item>
      )}
      {canSign && onReactClick && (
        <Item onClick={onReactClick}>
          <SmilePlus className="size-4 mr-2" />
          React
        </Item>
      )}
      {canSign && actions.favoriteConfig && (
        <Item
          onClick={actions.handleToggleFavorite}
          disabled={actions.isUpdating}
        >
          {actions.isUpdating ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Bookmark
              className={cn(
                "size-4 mr-2",
                actions.favorited && "text-yellow-500 fill-current",
              )}
            />
          )}
          {actions.favorited ? "Unbookmark" : "Bookmark"}
        </Item>
      )}
      <Separator />
      <Item onClick={actions.copyEventId}>
        {actions.copied ? (
          <CopyCheck className="size-4 mr-2 text-success" />
        ) : (
          <Copy className="size-4 mr-2" />
        )}
        {actions.copied ? "Copied!" : "Copy ID"}
      </Item>
      <Item onClick={actions.viewEventJson}>
        <FileJson className="size-4 mr-2" />
        View JSON
      </Item>
    </>
  );
}

/**
 * Event menu - universal actions for any event (dropdown trigger)
 */
export function EventMenu({
  event,
  actions,
  onReactClick,
  canSign,
}: EventMenuItemsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center hover:text-foreground text-muted-foreground transition-colors">
          <Menu className="size-4 md:size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <EventMenuItems
          Item={DropdownMenuItem}
          Separator={DropdownMenuSeparator}
          event={event}
          actions={actions}
          onReactClick={onReactClick}
          canSign={canSign}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Event context menu - same actions as EventMenu but triggered by right-click
 */
export function EventContextMenu({
  event,
  children,
  actions,
  onReactClick,
  canSign,
}: EventMenuItemsProps & { children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <EventMenuItems
          Item={ContextMenuItem}
          Separator={ContextMenuSeparator}
          event={event}
          actions={actions}
          onReactClick={onReactClick}
          canSign={canSign}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Clickable event title component
 * Opens the event in a new window when clicked
 * Supports both regular events and addressable/replaceable events
 */
interface ClickableEventTitleProps {
  event: NostrEvent;
  children: React.ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "span" | "div";
}

export function ClickableEventTitle({
  event,
  children,
  className,
  as: Component = "h3",
}: ClickableEventTitleProps) {
  const addWindow = useAddWindow();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    let pointer;

    // For replaceable/parameterized replaceable events, use AddressPointer
    if (isAddressableKind(event.kind)) {
      const dTag = getTagValue(event, "d") || "";
      pointer = {
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag,
      };
    } else {
      // For regular events, use EventPointer
      pointer = {
        id: event.id,
      };
    }

    addWindow("open", { pointer });
  };

  return (
    <Component
      className={cn(
        "cursor-crosshair hover:underline hover:decoration-dotted",
        className,
      )}
      onClick={handleClick}
    >
      {children}
    </Component>
  );
}

/**
 * Base event container with universal header
 * Kind-specific renderers can wrap their content with this
 */
/**
 * Format relative time (e.g., "2m ago", "3h ago", "5d ago")
 */

export function BaseEventContainer({
  event,
  children,
  authorOverride,
}: {
  event: NostrEvent;
  children: React.ReactNode;
  authorOverride?: {
    pubkey: string;
    label?: string;
  };
}) {
  const { locale } = useGrimoire();
  const { canSign, signer, pubkey } = useAccount();
  const { settings } = useSettings();
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const actions = useEventActions(event);

  const handleReactClick = useCallback(() => {
    setEmojiPickerOpen(true);
  }, []);

  const handleEmojiSelect = useCallback(
    async (emoji: string, customEmoji?: EmojiTag) => {
      if (!signer || !pubkey) return;

      try {
        const factory = new EventFactory();
        factory.setSigner(signer);

        const emojiArg = customEmoji
          ? {
              shortcode: customEmoji.shortcode,
              url: customEmoji.url,
              address: customEmoji.address,
            }
          : emoji;

        const draft = await factory.create(ReactionBlueprint, event, emojiArg);
        const signed = await factory.sign(draft);

        const targetPubkey = getSemanticAuthor(event);
        const relays = await selectRelaysForInteraction(pubkey, targetPubkey);
        await publishEventToRelays(signed, relays);
      } catch (err) {
        console.error("[BaseEventContainer] Failed to send reaction:", err);
      }
    },
    [signer, pubkey, event],
  );

  const relativeTime = formatTimestamp(
    event.created_at,
    "relative",
    locale.locale,
  );

  const absoluteTime = formatTimestamp(
    event.created_at,
    "absolute",
    locale.locale,
  );

  const displayPubkey = authorOverride?.pubkey || event.pubkey;

  const clientTag = event.tags.find((t) => t[0] === "client");
  const clientName = clientTag?.[1];
  const clientAddress = clientTag?.[2];
  const parsedClientAddress = clientAddress
    ? parseAddressPointer(clientAddress)
    : null;
  const clientAppPointer =
    parsedClientAddress?.kind === 31990 ? parsedClientAddress : null;

  return (
    <>
      <EventContextMenu
        event={event}
        actions={actions}
        onReactClick={handleReactClick}
        canSign={canSign}
      >
        <div className="flex flex-col gap-1 p-3 border-b border-border/50 last:border-0">
          <div className="flex flex-row justify-between items-center gap-2">
            <div className="flex flex-row gap-2 items-baseline min-w-0 overflow-hidden">
              <EventAuthor pubkey={displayPubkey} className="min-w-0" />
              <span
                className="text-xs text-muted-foreground cursor-help shrink-0 whitespace-nowrap"
                title={absoluteTime}
              >
                {relativeTime}
              </span>
            </div>
            <EventMenu
              event={event}
              actions={actions}
              onReactClick={handleReactClick}
              canSign={canSign}
            />
          </div>
          {children}
          <EventFooter
            event={event}
            clientName={
              settings?.appearance?.showClientTags ? clientName : undefined
            }
            clientAppPointer={clientAppPointer}
          />
        </div>
      </EventContextMenu>
      <EventJsonDialog
        event={event}
        open={actions.jsonDialogOpen}
        onOpenChange={actions.setJsonDialogOpen}
      />
      <EmojiPickerDialog
        open={emojiPickerOpen}
        onOpenChange={setEmojiPickerOpen}
        onEmojiSelect={handleEmojiSelect}
      />
    </>
  );
}
