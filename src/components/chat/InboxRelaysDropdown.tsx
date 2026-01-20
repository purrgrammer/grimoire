/**
 * InboxRelaysDropdown - Shows DM inbox relays (kind 10050) for NIP-17 participants
 * Displays each participant's private inbox relays with connection status
 */

import { useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import { combineLatest, of } from "rxjs";
import { Inbox } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RelayLink } from "@/components/nostr/RelayLink";
import { UserName } from "@/components/nostr/UserName";
import { useRelayState } from "@/hooks/useRelayState";
import { getConnectionIcon, getAuthIcon } from "@/lib/relay-status-utils";
import eventStore from "@/services/event-store";
import type { Conversation } from "@/types/chat";

interface InboxRelaysDropdownProps {
  conversation: Conversation;
}

/**
 * InboxRelaysDropdown - Shows inbox relays for NIP-17 conversation participants
 */
export function InboxRelaysDropdown({
  conversation,
}: InboxRelaysDropdownProps) {
  const { relays: relayStates } = useRelayState();

  // Fetch inbox relay events for all participants reactively
  const inboxRelayEvents = use$(() => {
    const pubkeys = conversation.participants.map((p) => p.pubkey);
    // Create observables for each participant's kind 10050 event
    const observables = pubkeys.map((pubkey) =>
      eventStore.replaceable(10050, pubkey, ""),
    );
    // Combine all observables into a single observable that emits an array
    return observables.length > 0 ? combineLatest(observables) : of([]);
  }, [conversation.participants]);

  // Extract relays from participants' kind 10050 events
  const participantRelays = useMemo(() => {
    if (!inboxRelayEvents) return [];

    const results: Array<{ pubkey: string; relays: string[] }> = [];

    conversation.participants.forEach((participant, index) => {
      const event = inboxRelayEvents[index];
      if (!event) return;

      const relays = event.tags
        .filter((t: string[]) => t[0] === "relay" && t[1])
        .map((t: string[]) => t[1]);

      if (relays.length > 0) {
        results.push({
          pubkey: participant.pubkey,
          relays,
        });
      }
    });

    return results;
  }, [inboxRelayEvents, conversation.participants]);

  // Count total relays and connected relays
  const { totalRelays, connectedCount } = useMemo(() => {
    let total = 0;
    let connected = 0;

    for (const participant of participantRelays) {
      for (const relay of participant.relays) {
        total++;
        const state = relayStates[relay];
        if (state?.connectionState === "connected") {
          connected++;
        }
      }
    }

    return { totalRelays: total, connectedCount: connected };
  }, [participantRelays, relayStates]);

  // Don't show if no inbox relays found
  if (participantRelays.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
          <Inbox className="size-3" />
          <span>
            {connectedCount}/{totalRelays}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-96 max-h-96 overflow-y-auto"
      >
        <div className="px-3 py-2 border-b border-border">
          <div className="text-xs font-semibold text-muted-foreground">
            Inbox Relays
          </div>
        </div>
        <div className="p-2 space-y-3">
          {participantRelays.map(({ pubkey, relays }) => (
            <div key={pubkey}>
              <div className="px-2 py-1 text-xs font-medium">
                <UserName pubkey={pubkey} className="text-xs" />
              </div>
              <div className="space-y-1">
                {relays.map((relay) => {
                  const state = relayStates[relay];
                  const connIcon = getConnectionIcon(state);
                  const authIcon = getAuthIcon(state);

                  return (
                    <div
                      key={relay}
                      className="flex items-center justify-between gap-2 p-1.5 rounded hover:bg-muted/50"
                    >
                      <div className="flex-1 min-w-0">
                        <RelayLink url={relay} showInboxOutbox={false} />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help">{connIcon.icon}</div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{connIcon.label}</p>
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help">{authIcon.icon}</div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{authIcon.label}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
