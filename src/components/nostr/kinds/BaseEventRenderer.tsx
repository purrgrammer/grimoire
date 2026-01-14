import { useState, useEffect, useMemo, useCallback } from "react";
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Menu,
  Copy,
  Check,
  FileJson,
  ExternalLink,
  Send,
  Loader2,
} from "lucide-react";
import { useGrimoire } from "@/core/state";
import { useCopy } from "@/hooks/useCopy";
import { JsonViewer } from "@/components/JsonViewer";
import { formatTimestamp } from "@/hooks/useLocale";
import { nip19 } from "nostr-tools";
import { getTagValue } from "applesauce-core/helpers";
import { getSeenRelays, addSeenRelay } from "applesauce-core/helpers/relays";
import { EventFooter } from "@/components/EventFooter";
import { cn } from "@/lib/utils";
import { isAddressableKind } from "@/lib/nostr-kinds";
import { publishEventToRelays } from "@/services/hub";
import { relayListCache } from "@/services/relay-list-cache";
import accountManager from "@/services/accounts";
import { toast } from "sonner";
import { use$ } from "applesauce-react/hooks";
import { Button } from "@/components/ui/button";
import { useRelayInfo } from "@/hooks/useRelayInfo";

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
 * Format relay URL for display by removing protocol and trailing slashes
 */
function formatRelayUrlForDisplay(url: string): string {
  return url
    .replace(/^wss?:\/\//, "") // Remove ws:// or wss://
    .replace(/\/$/, ""); // Remove trailing slash
}

/**
 * RelayPublishItem - Clickable relay item for republish submenu
 * Shows relay info (icon, name, URL) with publish status
 */
function RelayPublishItem({
  url,
  isPublishing,
  isPublished,
  onClick,
}: {
  url: string;
  isPublishing: boolean;
  isPublished: boolean;
  onClick: () => void;
}) {
  const relayInfo = useRelayInfo(url);
  const displayUrl = formatRelayUrlForDisplay(url);

  // Determine button label for accessibility
  const ariaLabel = isPublished
    ? `${displayUrl} - Already published`
    : isPublishing
      ? `${displayUrl} - Publishing...`
      : `Publish event to ${displayUrl}`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPublishing}
      aria-label={ariaLabel}
      className={cn(
        "flex items-center gap-2 px-2 py-2 w-full text-left rounded-sm transition-colors",
        "hover:bg-accent/10 focus:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        isPublished && "bg-green-500/10",
      )}
    >
      {/* Relay icon and info */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {relayInfo?.icon ? (
          <img
            src={relayInfo.icon}
            alt=""
            className="size-4 flex-shrink-0 rounded-sm"
            aria-hidden="true"
          />
        ) : (
          <div
            className="size-4 flex-shrink-0 rounded-sm bg-muted/50"
            aria-hidden="true"
          />
        )}
        <div className="flex flex-col min-w-0 flex-1">
          {relayInfo?.name && (
            <span className="text-xs font-medium truncate">
              {relayInfo.name}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground truncate">
            {displayUrl}
          </span>
        </div>
      </div>

      {/* Status icon */}
      <div className="flex-shrink-0" aria-hidden="true">
        {isPublishing ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : isPublished ? (
          <Check className="size-3 text-green-500" />
        ) : (
          <Send className="size-3 text-muted-foreground" />
        )}
      </div>
    </button>
  );
}

/**
 * Event menu - universal actions for any event
 */
export function EventMenu({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();
  const { copy, copied } = useCopy();
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [myRelays, setMyRelays] = useState<string[]>([]);
  const [publishingRelays, setPublishingRelays] = useState<Set<string>>(
    new Set(),
  );
  const [publishedRelays, setPublishedRelays] = useState<Set<string>>(
    new Set(),
  );
  const account = use$(accountManager.active$);

  // Fetch user's outbox relays when account changes
  useEffect(() => {
    if (!account) {
      setMyRelays([]);
      return;
    }

    relayListCache
      .getOutboxRelays(account.pubkey)
      .then((relays) => {
        setMyRelays(relays || []);
      })
      .catch((error) => {
        console.error("Failed to fetch outbox relays:", error);
        setMyRelays([]);
      });
  }, [account]);

  // Memoize relay lists to avoid unnecessary recalculations
  const seenRelays = useMemo(() => {
    const seenRelaysSet = getSeenRelays(event);
    return seenRelaysSet ? Array.from(seenRelaysSet) : [];
  }, [event]);

  // Connected relays: seen relays that are not in user's relay list
  const connectedRelays = useMemo(() => {
    return seenRelays.filter((relay) => !myRelays.includes(relay));
  }, [seenRelays, myRelays]);

  // All available relays (for checking if submenu should be disabled)
  const allRelays = useMemo(() => {
    return Array.from(new Set([...myRelays, ...seenRelays]));
  }, [myRelays, seenRelays]);

  // Check if any publish operation is in progress
  const isPublishing = publishingRelays.size > 0;

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

  const viewEventJson = useCallback(() => {
    setJsonDialogOpen(true);
  }, []);

  /**
   * Publish event to all user's outbox relays
   */
  const handleRepublishToMyRelays = useCallback(async () => {
    if (myRelays.length === 0) {
      toast.error("No relays found in your relay list");
      return;
    }

    // Prevent duplicate publishes
    if (isPublishing) {
      return;
    }

    // Mark all relays as publishing
    setPublishingRelays(new Set(myRelays));

    try {
      await publishEventToRelays(event, myRelays);

      // Mark event as seen on all relays after successful publish
      // This updates the event's internal state so it appears in "Seen on" dropdown
      myRelays.forEach((relay) => addSeenRelay(event, relay));

      // Mark all as published in UI
      setPublishedRelays((prev) => new Set([...prev, ...myRelays]));

      toast.success(
        `Published to ${myRelays.length} relay${myRelays.length > 1 ? "s" : ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Failed to publish to relays:", error);
      toast.error(`Failed to publish: ${message}`);
    } finally {
      setPublishingRelays(new Set());
    }
  }, [event, myRelays, isPublishing]);

  /**
   * Publish event to a specific relay
   */
  const handleRepublishToRelay = useCallback(
    async (relay: string) => {
      // Prevent duplicate publishes to the same relay
      if (publishingRelays.has(relay)) {
        return;
      }

      // Mark this relay as publishing
      setPublishingRelays((prev) => new Set([...prev, relay]));

      try {
        await publishEventToRelays(event, [relay]);

        // Mark event as seen on this relay after successful publish
        addSeenRelay(event, relay);

        // Mark as published in UI
        setPublishedRelays((prev) => new Set([...prev, relay]));

        toast.success("Published successfully");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`Failed to publish to ${relay}:`, error);
        toast.error(`Failed to publish: ${message}`);
      } finally {
        // Remove from publishing set
        setPublishingRelays((prev) => {
          const next = new Set(prev);
          next.delete(relay);
          return next;
        });
      }
    },
    [event, publishingRelays],
  );

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

        {/* Republish submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={allRelays.length === 0}>
            <Send className="size-4 mr-2" />
            Republish
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72 max-h-96 overflow-y-auto">
            {/* Quick action: Publish to all user's outbox relays */}
            {account && myRelays.length > 0 && (
              <>
                <div className="px-1 py-1">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={handleRepublishToMyRelays}
                    disabled={isPublishing}
                    aria-label={`Publish event to all ${myRelays.length} of your relays`}
                  >
                    {isPublishing ? (
                      <Loader2
                        className="size-3 mr-2 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Send className="size-3 mr-2" aria-hidden="true" />
                    )}
                    Publish to all my relays ({myRelays.length})
                  </Button>
                </div>
                <DropdownMenuSeparator />
              </>
            )}

            {/* No relays available */}
            {allRelays.length === 0 && (
              <div
                className="px-2 py-6 text-center text-sm text-muted-foreground"
                role="status"
              >
                No relays available
              </div>
            )}

            {/* User's outbox relays */}
            {account && myRelays.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs px-2 py-1.5 text-muted-foreground">
                  My relays
                </DropdownMenuLabel>
                <div
                  className="px-1 space-y-0.5"
                  role="group"
                  aria-label="Your outbox relays"
                >
                  {myRelays.map((relay) => (
                    <RelayPublishItem
                      key={relay}
                      url={relay}
                      isPublishing={publishingRelays.has(relay)}
                      isPublished={publishedRelays.has(relay)}
                      onClick={() => handleRepublishToRelay(relay)}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Connected relays (seen on but not in user's list) */}
            {connectedRelays.length > 0 && (
              <>
                {account && myRelays.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs px-2 py-1.5 text-muted-foreground">
                  Connected relays
                </DropdownMenuLabel>
                <div
                  className="px-1 space-y-0.5"
                  role="group"
                  aria-label="Relays where this event was seen"
                >
                  {connectedRelays.map((relay) => (
                    <RelayPublishItem
                      key={relay}
                      url={relay}
                      isPublishing={publishingRelays.has(relay)}
                      isPublished={publishedRelays.has(relay)}
                      onClick={() => handleRepublishToRelay(relay)}
                    />
                  ))}
                </div>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

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
  );
}
