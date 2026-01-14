import { useState } from "react";
import { NostrEvent } from "@/types/nostr";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Copy,
  Check,
  FileJson,
  ExternalLink,
  Reply,
  MessageSquare,
} from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useCopy } from "@/hooks/useCopy";
import { JsonViewer } from "@/components/JsonViewer";
import { KindBadge } from "@/components/KindBadge";
import { nip19 } from "nostr-tools";
import { getTagValue } from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { isAddressableKind } from "@/lib/nostr-kinds";

interface ChatMessageContextMenuProps {
  event: NostrEvent;
  children: React.ReactNode;
  onReply?: () => void;
}

/**
 * Context menu for chat messages
 * Provides right-click/long-press actions for chat messages:
 * - Reply to message
 * - Copy message text
 * - Open event detail
 * - Copy event ID (nevent/naddr)
 * - View raw JSON
 */
export function ChatMessageContextMenu({
  event,
  children,
  onReply,
}: ChatMessageContextMenuProps) {
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

  const copyMessageText = () => {
    copy(event.content);
  };

  const viewEventJson = () => {
    setJsonDialogOpen(true);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>
            <div className="flex flex-row items-center gap-4">
              <KindBadge kind={event.kind} variant="compact" />
              <KindBadge
                kind={event.kind}
                showName
                showKindNumber
                showIcon={false}
              />
            </div>
          </ContextMenuLabel>
          <ContextMenuSeparator />
          {onReply && (
            <>
              <ContextMenuItem onClick={onReply}>
                <Reply className="size-4 mr-2" />
                Reply
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={copyMessageText}>
            <MessageSquare className="size-4 mr-2" />
            Copy Text
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={openEventDetail}>
            <ExternalLink className="size-4 mr-2" />
            Open Event
          </ContextMenuItem>
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
      </ContextMenu>
      <JsonViewer
        data={event}
        open={jsonDialogOpen}
        onOpenChange={setJsonDialogOpen}
        title={`Event ${event.id.slice(0, 8)}... - Raw JSON`}
      />
    </>
  );
}
