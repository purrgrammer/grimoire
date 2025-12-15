import { useState } from "react";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { KindRenderer } from "./nostr/kinds";
import { Kind0DetailRenderer } from "./nostr/kinds/ProfileDetailRenderer";
import { Kind3DetailView } from "./nostr/kinds/ContactListRenderer";
import { IssueDetailRenderer } from "./nostr/kinds/IssueDetailRenderer";
import { PatchDetailRenderer } from "./nostr/kinds/PatchDetailRenderer";
import { PullRequestDetailRenderer } from "./nostr/kinds/PullRequestDetailRenderer";
import { Kind1337DetailRenderer } from "./nostr/kinds/CodeSnippetDetailRenderer";
import { Kind9802DetailRenderer } from "./nostr/kinds/HighlightDetailRenderer";
import { Kind10002DetailRenderer } from "./nostr/kinds/RelayListDetailRenderer";
import { Kind30023DetailRenderer } from "./nostr/kinds/ArticleDetailRenderer";
import { CommunityNIPDetailRenderer } from "./nostr/kinds/CommunityNIPDetailRenderer";
import { RepositoryDetailRenderer } from "./nostr/kinds/RepositoryDetailRenderer";
import { JsonViewer } from "./JsonViewer";
import { RelayLink } from "./nostr/RelayLink";
import { EventDetailSkeleton } from "@/components/ui/skeleton";
import { Copy, CopyCheck, FileJson, Wifi } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { nip19, kinds } from "nostr-tools";
import { useCopy } from "../hooks/useCopy";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { getTagValue } from "applesauce-core/helpers";
import { useRelayState } from "@/hooks/useRelayState";
import { getConnectionIcon, getAuthIcon } from "@/lib/relay-status-utils";

export interface EventDetailViewerProps {
  pointer: EventPointer | AddressPointer;
}

/**
 * EventDetailViewer - Detailed view for a single event
 * Shows compact metadata header and rendered content
 */
export function EventDetailViewer({ pointer }: EventDetailViewerProps) {
  const event = useNostrEvent(pointer);
  const [showJson, setShowJson] = useState(false);
  const { copy: copyBech32, copied: copiedBech32 } = useCopy();
  const { relays: relayStates } = useRelayState();

  // Loading state
  if (!event) {
    return (
      <div className="flex flex-col h-full p-8">
        <EventDetailSkeleton />
      </div>
    );
  }

  // Get relays this event was seen on using applesauce
  const seenRelaysSet = getSeenRelays(event);
  const relays = seenRelaysSet ? Array.from(seenRelaysSet) : undefined;

  // Generate nevent/naddr bech32 ID for display (always use nevent, not note)
  const bech32Id =
    "id" in pointer
      ? nip19.neventEncode({
          id: event.id,
          relays: relays,
          author: event.pubkey,
        })
      : nip19.naddrEncode({
          kind: event.kind,
          pubkey: event.pubkey,
          identifier: getTagValue(event, "d") || "",
          relays: relays,
        });

  // Get relay state for each relay
  const relayStatesForEvent = relays
    ? relays.map((url) => ({
        url,
        state: relayStates[url],
      }))
    : [];
  const connectedCount = relayStatesForEvent.filter(
    (r) => r.state?.connectionState === "connected",
  ).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Header - Single Line */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between gap-3">
        {/* Left: Event ID */}
        <button
          onClick={() => copyBech32(bech32Id)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors truncate min-w-0"
          title={bech32Id}
          aria-label="Copy event ID"
        >
          {copiedBech32 ? (
            <CopyCheck className="size-3 flex-shrink-0" />
          ) : (
            <Copy className="size-3 flex-shrink-0" />
          )}
          <code className="truncate">
            {bech32Id.slice(0, 16)}...{bech32Id.slice(-8)}
          </code>
        </button>

        {/* Right: Relay Count and JSON Toggle */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Relay Dropdown */}
          {relays && relays.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Event seen on ${relays.length} relay${relays.length !== 1 ? "s" : ""}`}
                >
                  <Wifi className="size-3" />
                  <span>
                    {connectedCount}/{relays.length}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {relayStatesForEvent.map(({ url, state }) => {
                  const connIcon = getConnectionIcon(state);
                  const authIcon = getAuthIcon(state);

                  return (
                    <DropdownMenuItem
                      key={url}
                      className="flex items-center justify-between gap-2"
                    >
                      <RelayLink
                        url={url}
                        showInboxOutbox={false}
                        className="flex-1 min-w-0 hover:bg-transparent"
                        iconClassname="size-3"
                        urlClassname="text-xs"
                      />
                      <div
                        className="flex items-center gap-1.5 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {authIcon && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="cursor-help">{authIcon.icon}</div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{authIcon.label}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help">{connIcon.icon}</div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{connIcon.label}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* JSON Toggle */}
          <button
            onClick={() => setShowJson(!showJson)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="View raw JSON"
          >
            <FileJson className="size-3" />
          </button>
        </div>
      </div>

      {/* Rendered Content - Focus Here */}
      <div className="flex-1 overflow-y-auto">
        {event.kind === kinds.Metadata ? (
          <Kind0DetailRenderer event={event} />
        ) : event.kind === kinds.Contacts ? (
          <Kind3DetailView event={event} />
        ) : event.kind === 1337 ? (
          <Kind1337DetailRenderer event={event} />
        ) : event.kind === 1617 ? (
          <PatchDetailRenderer event={event} />
        ) : event.kind === 1618 ? (
          <PullRequestDetailRenderer event={event} />
        ) : event.kind === 1621 ? (
          <IssueDetailRenderer event={event} />
        ) : event.kind === kinds.Highlights ? (
          <Kind9802DetailRenderer event={event} />
        ) : event.kind === kinds.RelayList ? (
          <Kind10002DetailRenderer event={event} />
        ) : event.kind === kinds.LongFormArticle ? (
          <Kind30023DetailRenderer event={event} />
        ) : event.kind === 30817 ? (
          <CommunityNIPDetailRenderer event={event} />
        ) : event.kind === 30617 ? (
          <RepositoryDetailRenderer event={event} />
        ) : (
          <KindRenderer event={event} />
        )}
      </div>

      {/* JSON Viewer Dialog */}
      <JsonViewer
        data={event}
        open={showJson}
        onOpenChange={setShowJson}
        title="Event JSON"
      />
    </div>
  );
}
