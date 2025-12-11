import { useState } from "react";
import { NostrEvent } from "@/types/nostr";
import { UserName } from "../UserName";
import { KindBadge } from "@/components/KindBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, Copy, Check, FileJson, ExternalLink } from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useCopy } from "@/hooks/useCopy";
import { JsonViewer } from "@/components/JsonViewer";
import { formatTimestamp } from "@/hooks/useLocale";

/**
 * Universal event properties and utilities shared across all kind renderers
 */
export interface BaseEventProps {
  event: NostrEvent;
  depth?: number;
}

/**
 * User component - displays author info with profile
 */
export function EventAuthor({ pubkey }: { pubkey: string }) {
  return (
    <div className="flex flex-col gap-0">
      <UserName pubkey={pubkey} className="text-md" />
    </div>
  );
}

/**
 * Event menu - universal actions for any event
 */
export function EventMenu({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();
  const { copy, copied } = useCopy();
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);

  const openEventDetail = () => {
    // For replaceable/parameterized replaceable events, use AddressPointer
    // Replaceable: 10000-19999, Parameterized: 30000-39999
    const isAddressable =
      (event.kind >= 10000 && event.kind < 20000) ||
      (event.kind >= 30000 && event.kind < 40000);

    let pointer;
    if (isAddressable) {
      // Find d-tag for identifier
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
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

    addWindow("open", { pointer }, `Event ${event.id.slice(0, 8)}...`);
  };

  const copyEventId = () => {
    copy(event.id);
  };

  const viewEventJson = () => {
    setJsonDialogOpen(true);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="hover:text-foreground text-muted-foreground transition-colors">
          <Menu className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-row items-center gap-4">
            <KindBadge kind={event.kind} variant="compact" />
            <KindBadge
              kind={event.kind}
              showName
              showKindNumber
              showIcon={false}
            />
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={openEventDetail}>
          <ExternalLink className="size-4 mr-2" />
          Open
        </DropdownMenuItem>
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
 * Base event container with universal header
 * Kind-specific renderers can wrap their content with this
 */
/**
 * Format relative time (e.g., "2m ago", "3h ago", "5d ago")
 */

export function BaseEventContainer({
  event,
  children,
}: {
  event: NostrEvent;
  children: React.ReactNode;
}) {
  // Format relative time for display
  const { locale } = useGrimoire();
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

  return (
    <div className="flex flex-col gap-2 p-3 border-b border-border/50 last:border-0">
      <div className="flex flex-row justify-between items-center">
        <div className="flex flex-row gap-2 items-baseline">
          <EventAuthor pubkey={event.pubkey} />
          <span
            className="text-xs font-light text-muted-foreground cursor-help"
            title={absoluteTime}
          >
            {relativeTime}
          </span>
        </div>
        <EventMenu event={event} />
      </div>
      {children}
    </div>
  );
}
