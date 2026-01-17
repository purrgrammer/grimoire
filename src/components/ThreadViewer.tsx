import { useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { DetailKindRenderer } from "./nostr/kinds";
import { EventErrorBoundary } from "./EventErrorBoundary";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { getNip10References } from "applesauce-common/helpers/threading";
import { getCommentReplyPointer } from "applesauce-common/helpers/comment";
import { getTagValues } from "@/lib/nostr-utils";
import { UserName } from "./nostr/UserName";
import { Wifi, MessageSquare } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { RelayLink } from "./nostr/RelayLink";
import { useRelayState } from "@/hooks/useRelayState";
import { getConnectionIcon, getAuthIcon } from "@/lib/relay-status-utils";
import { TimelineSkeleton } from "@/components/ui/skeleton";
import eventStore from "@/services/event-store";
import type { NostrEvent } from "@/types/nostr";
import { ThreadConversation } from "./ThreadConversation";

export interface ThreadViewerProps {
  pointer: EventPointer | AddressPointer;
}

/**
 * Get the root event of a thread
 * - For kind 1 (NIP-10): Follow root pointer or use event itself if no root
 * - For kind 1111 (NIP-22): Follow root pointer (uppercase tags) or use event itself
 * - For other kinds: The event IS the root (comments/replies point to it)
 */
function getThreadRoot(
  event: NostrEvent,
): EventPointer | AddressPointer | null {
  // Kind 1: NIP-10 threading
  if (event.kind === 1) {
    const refs = getNip10References(event);
    // If there's a root, use it; otherwise this event is the root
    if (refs.root) {
      return refs.root.e || refs.root.a || null;
    }
    // This is a root post (no root tag)
    return { id: event.id };
  }

  // Kind 1111: NIP-22 comments
  if (event.kind === 1111) {
    const pointer = getCommentReplyPointer(event);
    // Comments always have a root (the thing being commented on)
    // If this is a top-level comment, root === parent
    // We need to check uppercase tags (E, A) for the root
    const eTags = getTagValues(event, "E");
    const aTags = getTagValues(event, "A");

    if (eTags.length > 0) {
      return { id: eTags[0] };
    }

    if (aTags.length > 0) {
      const [kind, pubkey, identifier] = aTags[0].split(":");
      return {
        kind: parseInt(kind, 10),
        pubkey,
        identifier: identifier || "",
      };
    }

    // Fallback to parent pointer if no root found
    if (pointer) {
      if ("id" in pointer) {
        return pointer.id ? { id: pointer.id } : null;
      } else if ("kind" in pointer && "pubkey" in pointer) {
        return {
          kind: pointer.kind as number,
          pubkey: pointer.pubkey as string,
          identifier: (pointer.identifier as string | undefined) || "",
        };
      }
    }

    return null;
  }

  // For all other kinds, the event itself is the root
  // (e.g., articles, videos that can receive comments)
  return { id: event.id };
}

/**
 * ThreadViewer - Displays a Nostr thread with root post and replies
 * Supports both NIP-10 (kind 1 replies) and NIP-22 (kind 1111 comments)
 */
export function ThreadViewer({ pointer }: ThreadViewerProps) {
  const event = useNostrEvent(pointer);
  const { relays: relayStates } = useRelayState();

  // Get thread root
  const rootPointer = useMemo(() => {
    if (!event) return undefined;
    return getThreadRoot(event);
  }, [event]);

  // Load root event (might be the same as event)
  const rootEvent = useNostrEvent(rootPointer ?? undefined);

  // Get relays for the root event
  const rootRelays = useMemo(() => {
    if (!rootEvent) return [];
    const seenRelaysSet = getSeenRelays(rootEvent);
    return seenRelaysSet ? Array.from(seenRelaysSet) : [];
  }, [rootEvent]);

  // Load all replies to the root
  const replyFilter = useMemo(() => {
    if (!rootEvent) return null;

    // For kind 1: load kind 1 replies with "e" tag pointing to root
    if (rootEvent.kind === 1) {
      return { kinds: [1], "#e": [rootEvent.id] };
    }

    // For other kinds: load kind 1111 comments with "E" tag pointing to root
    return { kinds: [1111], "#E": [rootEvent.id] };
  }, [rootEvent]);

  // Subscribe to replies timeline
  const replies = use$(() => {
    if (!replyFilter) return eventStore.timeline([]);
    return eventStore.timeline([replyFilter]);
  }, [replyFilter]);

  // Extract all participants (unique pubkeys from root + all replies)
  const participants = useMemo(() => {
    if (!rootEvent) return [];

    const pubkeys = new Set<string>();
    pubkeys.add(rootEvent.pubkey);

    // Add reply authors
    if (replies) {
      replies.forEach((reply) => pubkeys.add(reply.pubkey));
    }

    // Also add all mentioned pubkeys from p tags
    getTagValues(rootEvent, "p").forEach((pk) => pubkeys.add(pk));
    if (replies) {
      replies.forEach((reply) => {
        getTagValues(reply, "p").forEach((pk) => pubkeys.add(pk));
      });
    }

    return Array.from(pubkeys);
  }, [rootEvent, replies]);

  // Get relay state for each relay
  const relayStatesForEvent = useMemo(() => {
    return rootRelays.map((url) => ({
      url,
      state: relayStates[url],
    }));
  }, [rootRelays, relayStates]);

  const connectedCount = useMemo(() => {
    return relayStatesForEvent.filter(
      (r) => r.state?.connectionState === "connected",
    ).length;
  }, [relayStatesForEvent]);

  // Loading state
  if (!event || !rootEvent) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between gap-3">
          <div className="text-muted-foreground">Loading thread...</div>
        </div>
        <div className="p-4">
          <TimelineSkeleton count={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between gap-3">
        {/* Left: Participants */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <MessageSquare className="size-3 text-muted-foreground flex-shrink-0" />
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="text-muted-foreground flex-shrink-0">By:</span>
            {participants.slice(0, 5).map((pubkey, idx) => (
              <span key={pubkey} className="flex items-center gap-1.5">
                <UserName pubkey={pubkey} className="text-xs" />
                {idx < Math.min(participants.length - 1, 4) && (
                  <span className="text-muted-foreground">,</span>
                )}
              </span>
            ))}
            {participants.length > 5 && (
              <span className="text-muted-foreground">
                +{participants.length - 5} more
              </span>
            )}
          </div>
        </div>

        {/* Right: Relay Count (Dropdown) */}
        <div className="flex-shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                <Wifi className="size-3" />
                <span>
                  {connectedCount}/{rootRelays.length}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-96 max-h-96 overflow-y-auto"
            >
              {/* Relay List */}
              <div className="px-3 py-2 border-b border-border">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  Relays ({rootRelays.length})
                </div>
              </div>

              {(() => {
                // Group relays by connection status
                const onlineRelays: string[] = [];
                const disconnectedRelays: string[] = [];

                rootRelays.forEach((url) => {
                  const globalState = relayStates[url];
                  const isConnected =
                    globalState?.connectionState === "connected";

                  if (isConnected) {
                    onlineRelays.push(url);
                  } else {
                    disconnectedRelays.push(url);
                  }
                });

                const renderRelay = (url: string) => {
                  const globalState = relayStates[url];
                  const connIcon = getConnectionIcon(globalState);
                  const authIcon = getAuthIcon(globalState);

                  return (
                    <Tooltip key={url}>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-2 text-xs py-1 px-3 hover:bg-accent/5 cursor-default">
                          <RelayLink
                            url={url}
                            showInboxOutbox={false}
                            className="flex-1 min-w-0 truncate font-mono text-foreground/80"
                          />
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div>{authIcon.icon}</div>
                            <div>{connIcon.icon}</div>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="left"
                        className="max-w-xs bg-popover text-popover-foreground border border-border shadow-md"
                      >
                        <div className="space-y-2 text-xs p-1">
                          <div className="font-mono font-bold border-b border-border pb-2 break-all text-primary">
                            {url}
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            <div className="space-y-0.5">
                              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">
                                Connection
                              </div>
                              <div className="flex items-center gap-1.5 font-medium">
                                <span className="shrink-0">
                                  {connIcon.icon}
                                </span>
                                <span>{connIcon.label}</span>
                              </div>
                            </div>
                            <div className="space-y-0.5">
                              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">
                                Authentication
                              </div>
                              <div className="flex items-center gap-1.5 font-medium">
                                <span className="shrink-0">
                                  {authIcon.icon}
                                </span>
                                <span>{authIcon.label}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                };

                return (
                  <>
                    {onlineRelays.length > 0 && (
                      <div className="py-2">
                        <div className="px-3 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Online ({onlineRelays.length})
                        </div>
                        {onlineRelays.map(renderRelay)}
                      </div>
                    )}

                    {disconnectedRelays.length > 0 && (
                      <div className="py-2 border-t border-border">
                        <div className="px-3 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Disconnected ({disconnectedRelays.length})
                        </div>
                        {disconnectedRelays.map(renderRelay)}
                      </div>
                    )}
                  </>
                );
              })()}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content: Root + Replies */}
      <div className="flex-1 overflow-y-auto">
        {/* Root Event Detail */}
        <div className="border-b border-border">
          <EventErrorBoundary event={rootEvent}>
            <DetailKindRenderer event={rootEvent} />
          </EventErrorBoundary>
        </div>

        {/* Replies Section */}
        <div className="px-3 py-2">
          {replies && replies.length > 0 ? (
            <ThreadConversation
              rootEventId={rootEvent.id}
              replies={replies}
              threadKind={rootEvent.kind === 1 ? "nip10" : "nip22"}
            />
          ) : (
            <div className="text-sm text-muted-foreground italic p-2">
              No replies yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
