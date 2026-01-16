import { Wifi } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RelayLink } from "@/components/nostr/RelayLink";
import { UserName } from "@/components/nostr/UserName";
import { useRelayState } from "@/hooks/useRelayState";
import { getConnectionIcon, getAuthIcon } from "@/lib/relay-status-utils";
import { normalizeRelayURL } from "@/lib/relay-url";
import type { Conversation } from "@/types/chat";

interface RelaysDropdownProps {
  conversation: Conversation;
}

/**
 * RelaysDropdown - Shows relay count and list with connection status
 * Similar to relay indicators in ReqViewer
 * For NIP-17 DMs, shows per-participant inbox relays
 */
export function RelaysDropdown({ conversation }: RelaysDropdownProps) {
  const { relays: relayStates } = useRelayState();

  // Check for per-participant inbox relays (NIP-17)
  const participantInboxRelays = conversation.metadata?.participantInboxRelays;
  const hasParticipantRelays =
    participantInboxRelays && Object.keys(participantInboxRelays).length > 0;

  // Get relays for this conversation (immutable pattern)
  // Priority: liveActivity relays > inbox relays (NIP-17) > single relayUrl
  const liveActivityRelays = conversation.metadata?.liveActivity?.relays;
  const inboxRelays = conversation.metadata?.inboxRelays;
  const relays: string[] =
    Array.isArray(liveActivityRelays) && liveActivityRelays.length > 0
      ? liveActivityRelays
      : Array.isArray(inboxRelays) && inboxRelays.length > 0
        ? inboxRelays
        : conversation.metadata?.relayUrl
          ? [conversation.metadata.relayUrl]
          : [];

  // Get label for the relays section
  const relayLabel =
    conversation.protocol === "nip-17" ? "Inbox Relays" : "Relays";

  // Helper to normalize and get state for a relay URL
  const getRelayInfo = (url: string) => {
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeRelayURL(url);
    } catch {
      normalizedUrl = url;
    }
    const state = relayStates[normalizedUrl];
    return {
      url,
      normalizedUrl,
      state,
      isConnected: state?.connectionState === "connected",
    };
  };

  // Pre-compute relay data for all relays
  const relayData = relays.map(getRelayInfo);

  // Count connected relays
  const connectedCount = relayData.filter((r) => r.isConnected).length;

  if (relays.length === 0 && !hasParticipantRelays) {
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
      <DropdownMenuContent align="end" className="w-72">
        {/* For NIP-17, show per-participant breakdown */}
        {hasParticipantRelays ? (
          <div className="space-y-2 p-1">
            {Object.entries(participantInboxRelays).map(
              ([pubkey, pubkeyRelays]) => (
                <div key={pubkey}>
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <UserName pubkey={pubkey} className="font-medium" />
                    <span className="text-muted-foreground/60">
                      ({pubkeyRelays.length})
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {pubkeyRelays.map((url) => {
                      const info = getRelayInfo(url);
                      const connIcon = getConnectionIcon(info.state);
                      const authIcon = getAuthIcon(info.state);

                      return (
                        <div
                          key={url}
                          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 transition-colors"
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
                </div>
              ),
            )}
          </div>
        ) : (
          <>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {relayLabel} ({relays.length})
            </div>
            <div className="space-y-1 p-1">
              {relayData.map(({ url, state }) => {
                const connIcon = getConnectionIcon(state);
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
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
