import { Wifi } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RelayLink } from "@/components/nostr/RelayLink";
import { useRelayState } from "@/hooks/useRelayState";
import { getConnectionIcon, getAuthIcon } from "@/lib/relay-status-utils";
import { useConcordRelayStatus } from "@/hooks/useConcordRelayStatus";
import { normalizeRelayURL } from "@/lib/relay-url";
import type { Conversation } from "@/types/chat";

interface RelaysDropdownProps {
  conversation: Conversation;
}

/**
 * RelaysDropdown - Shows relay count and list with connection status
 * Similar to relay indicators in ReqViewer
 */
export function RelaysDropdown({ conversation }: RelaysDropdownProps) {
  const { relays: relayStates } = useRelayState();

  // Get relays for this conversation (immutable pattern)
  const liveActivityRelays = conversation.metadata?.liveActivity?.relays;
  const metadataRelays = conversation.metadata?.relays;
  const relays: string[] =
    Array.isArray(liveActivityRelays) && liveActivityRelays.length > 0
      ? liveActivityRelays
      : Array.isArray(metadataRelays) && metadataRelays.length > 0
        ? metadataRelays
        : conversation.metadata?.relayUrl
          ? [conversation.metadata.relayUrl]
          : [];

  /**
   * Concord reads over its OWN pool, so the singleton's relay state describes
   * a different socket. `useConcordRelayStatus` asks the pool that actually
   * holds this conversation's connections; every other protocol is on the
   * singleton and this map stays empty.
   */
  const concordStatus = useConcordRelayStatus(
    conversation.protocol === "concord" ? relays : undefined,
  );

  // Pre-compute normalized URLs and state lookups in a single pass (O(n))
  const relayData = relays.map((url) => {
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeRelayURL(url);
    } catch {
      normalizedUrl = url;
    }
    const state = relayStates[normalizedUrl];
    const owned = concordStatus.get(url);
    return {
      url,
      normalizedUrl,
      state,
      isConnected:
        owned !== undefined ? owned : state?.connectionState === "connected",
    };
  });

  // Count connected relays
  const connectedCount = relayData.filter((r) => r.isConnected).length;

  if (relays.length === 0) {
    return null; // Don't show if no relays
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
          <Wifi className="size-3" />
          <span>
            {connectedCount}/{relays.length}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Relays ({relays.length})
        </div>
        <div className="space-y-1 p-1">
          {relayData.map(({ url, state, isConnected }) => {
            // Same substitution as the count: on Concord the singleton's
            // `state` describes a socket this conversation does not use, so
            // the row is drawn from the owning pool's answer instead.
            const connIcon = getConnectionIcon(
              conversation.protocol === "concord"
                ? {
                    ...state,
                    connectionState: isConnected ? "connected" : "disconnected",
                  }
                : state,
            );
            const authIcon = getAuthIcon(state);

            return (
              <div
                key={url}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-1 flex-shrink-0">
                  {connIcon.icon}
                  {authIcon.icon}
                </div>
                <RelayLink
                  url={url}
                  className="text-sm truncate flex-1 min-w-0"
                />
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
