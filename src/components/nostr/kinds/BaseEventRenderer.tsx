import { useState } from "react";
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
  Check,
  FileJson,
  ExternalLink,
  Zap,
  MessageSquare,
} from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useCopy } from "@/hooks/useCopy";
import { JsonViewer } from "@/components/JsonViewer";
import { formatTimestamp } from "@/hooks/useLocale";
import { nip19 } from "nostr-tools";
import { getTagValue } from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { EventFooter } from "@/components/EventFooter";
import { cn } from "@/lib/utils";
import { isAddressableKind } from "@/lib/nostr-kinds";
import { getSemanticAuthor } from "@/lib/semantic-author";

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
 * Event menu - universal actions for any event
 */
export function EventMenu({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();
  const { copy, copied } = useCopy();
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);

  const openEventDetail = () => {
    let pointer;
    // For replaceable/parameterized replaceable events, use AddressPointer
    if (isAddressableKind(event.kind)) {
      // Find d-tag for identifier
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

  const copyEventId = () => {
    // Get relay hints from where the event has been seen
    const seenRelaysSet = getSeenRelays(event);
    const relays = seenRelaysSet ? Array.from(seenRelaysSet) : [];

    // For replaceable/parameterized replaceable events, encode as naddr
    if (isAddressableKind(event.kind)) {
      // Find d-tag for identifier
      const dTag = getTagValue(event, "d") || "";
      const naddr = nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag,
        relays: relays,
      });
      copy(naddr);
    } else {
      // For regular events, encode as nevent
      const nevent = nip19.neventEncode({
        id: event.id,
        author: event.pubkey,
        relays: relays,
      });
      copy(nevent);
    }
  };

  const viewEventJson = () => {
    setJsonDialogOpen(true);
  };

  const zapEvent = () => {
    // Get semantic author (e.g., zapper for zaps, host for streams)
    const recipientPubkey = getSemanticAuthor(event);

    // For addressable events, use addressPointer; for regular events, use eventPointer
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
  };

  const openChatWindow = () => {
    // Only kind 1 notes support NIP-10 thread chat
    if (event.kind === 1) {
      const seenRelaysSet = getSeenRelays(event);
      const relays = seenRelaysSet ? Array.from(seenRelaysSet) : [];

      // Open chat with NIP-10 thread protocol
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
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="hover:text-foreground text-muted-foreground transition-colors">
          <Menu className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={openEventDetail}>
          <ExternalLink className="size-4 mr-2" />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onClick={zapEvent}>
          <Zap className="size-4 mr-2 text-yellow-500" />
          Zap
        </DropdownMenuItem>
        {event.kind === 1 && (
          <DropdownMenuItem onClick={openChatWindow}>
            <MessageSquare className="size-4 mr-2" />
            Chat
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={copyEventId}>
          {copied ? (
            <Check className="size-4 mr-2 text-green-500" />
          ) : (
            <Copy className="size-4 mr-2" />
          )}
          {copied ? "Copied!" : "Copy ID"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={viewEventJson}>
          <FileJson className="size-4 mr-2" />
          View JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
      <JsonViewer
        data={event}
        open={jsonDialogOpen}
        onOpenChange={setJsonDialogOpen}
        title={`Event ${event.id.slice(0, 8)}... - Raw JSON`}
      />
    </DropdownMenu>
  );
}

/**
 * Event context menu - same actions as EventMenu but triggered by right-click
 * Used for generic event renderers that don't have a built-in menu button
 */
export function EventContextMenu({
  event,
  children,
}: {
  event: NostrEvent;
  children: React.ReactNode;
}) {
  const { addWindow } = useGrimoire();
  const { copy, copied } = useCopy();
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);

  const openEventDetail = () => {
    let pointer;
    // For replaceable/parameterized replaceable events, use AddressPointer
    if (isAddressableKind(event.kind)) {
      // Find d-tag for identifier
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

  const copyEventId = () => {
    // Get relay hints from where the event has been seen
    const seenRelaysSet = getSeenRelays(event);
    const relays = seenRelaysSet ? Array.from(seenRelaysSet) : [];

    // For replaceable/parameterized replaceable events, encode as naddr
    if (isAddressableKind(event.kind)) {
      // Find d-tag for identifier
      const dTag = getTagValue(event, "d") || "";
      const naddr = nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag,
        relays: relays,
      });
      copy(naddr);
    } else {
      // For regular events, encode as nevent
      const nevent = nip19.neventEncode({
        id: event.id,
        author: event.pubkey,
        relays: relays,
      });
      copy(nevent);
    }
  };

  const viewEventJson = () => {
    setJsonDialogOpen(true);
  };

  const zapEvent = () => {
    // Get semantic author (e.g., zapper for zaps, host for streams)
    const recipientPubkey = getSemanticAuthor(event);

    // For addressable events, use addressPointer; for regular events, use eventPointer
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
  };

  const openChatWindow = () => {
    // Only kind 1 notes support NIP-10 thread chat
    if (event.kind === 1) {
      const seenRelaysSet = getSeenRelays(event);
      const relays = seenRelaysSet ? Array.from(seenRelaysSet) : [];

      // Open chat with NIP-10 thread protocol
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
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={openEventDetail}>
          <ExternalLink className="size-4 mr-2" />
          Open
        </ContextMenuItem>
        <ContextMenuItem onClick={zapEvent}>
          <Zap className="size-4 mr-2 text-yellow-500" />
          Zap
        </ContextMenuItem>
        {event.kind === 1 && (
          <ContextMenuItem onClick={openChatWindow}>
            <MessageSquare className="size-4 mr-2" />
            Chat
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={copyEventId}>
          {copied ? (
            <Check className="size-4 mr-2 text-green-500" />
          ) : (
            <Copy className="size-4 mr-2" />
          )}
          {copied ? "Copied!" : "Copy ID"}
        </ContextMenuItem>
        <ContextMenuItem onClick={viewEventJson}>
          <FileJson className="size-4 mr-2" />
          View JSON
        </ContextMenuItem>
      </ContextMenuContent>
      <JsonViewer
        data={event}
        open={jsonDialogOpen}
        onOpenChange={setJsonDialogOpen}
        title={`Event ${event.id.slice(0, 8)}... - Raw JSON`}
      />
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
  const { addWindow } = useGrimoire();

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

  // Format relative time for display
  const relativeTime = formatTimestamp(
    event.created_at,
    "relative",
    locale.locale,
  );

  // Format absolute timestamp for hover (ISO-8601 style)
  const absoluteTime = formatTimestamp(
    event.created_at,
    "absolute",
    locale.locale,
  );

  // Use author override if provided, otherwise use event author
  const displayPubkey = authorOverride?.pubkey || event.pubkey;

  return (
    <EventContextMenu event={event}>
      <div className="flex flex-col gap-2 p-3 border-b border-border/50 last:border-0">
        <div className="flex flex-row justify-between items-center">
          <div className="flex flex-row gap-2 items-baseline">
            <EventAuthor pubkey={displayPubkey} />
            <span
              className="text-xs text-muted-foreground cursor-help"
              title={absoluteTime}
            >
              {relativeTime}
            </span>
          </div>
          <EventMenu event={event} />
        </div>
        {children}
        <EventFooter event={event} />
      </div>
    </EventContextMenu>
  );
}
