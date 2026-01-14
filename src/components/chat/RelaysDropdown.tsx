import { useState, useEffect } from "react";
import { Wifi, Inbox } from "lucide-react";
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
import { Nip17Adapter } from "@/lib/chat/adapters/nip-17-adapter";

interface RelaysDropdownProps {
  conversation: Conversation;
}

/** Inbox relay info per participant */
interface ParticipantRelays {
  pubkey: string;
  relays: string[];
  loading: boolean;
}

/**
 * RelaysDropdown - Shows relay count and list with connection status
 * For NIP-17 DMs, shows each participant's private inbox relays
 */
export function RelaysDropdown({ conversation }: RelaysDropdownProps) {
  const { relays: relayStates } = useRelayState();
  const [participantRelays, setParticipantRelays] = useState<
    ParticipantRelays[]
  >([]);

  // For NIP-17, fetch inbox relays for each participant
  useEffect(() => {
    if (conversation.protocol !== "nip-17") return;

    const adapter = new Nip17Adapter();
    const participants = conversation.participants;

    // Initialize with loading state
    setParticipantRelays(
      participants.map((p) => ({
        pubkey: p.pubkey,
        relays: [],
        loading: true,
      })),
    );

    // Fetch relays for each participant
    const fetchAll = async () => {
      const results = await Promise.all(
        participants.map(async (p) => {
          try {
            const relays = await adapter.getInboxRelays(p.pubkey);
            return { pubkey: p.pubkey, relays, loading: false };
          } catch {
            return { pubkey: p.pubkey, relays: [], loading: false };
          }
        }),
      );
      setParticipantRelays(results);
    };

    fetchAll();
  }, [conversation.protocol, conversation.participants]);

  // Get relays for non-NIP-17 conversations
  const liveActivityRelays = conversation.metadata?.liveActivity?.relays;
  const standardRelays: string[] =
    Array.isArray(liveActivityRelays) && liveActivityRelays.length > 0
      ? liveActivityRelays
      : conversation.metadata?.relayUrl
        ? [conversation.metadata.relayUrl]
        : [];

  // Pre-compute normalized URLs and state lookups for standard relays
  const standardRelayData = standardRelays.map((url) => {
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
  });

  // For NIP-17, compute relay data per participant
  const nip17RelayData = participantRelays.map((p) => ({
    ...p,
    relayData: p.relays.map((url) => {
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
    }),
  }));

  // Count total and connected relays
  const isNip17 = conversation.protocol === "nip-17";
  const totalRelays = isNip17
    ? participantRelays.reduce((sum, p) => sum + p.relays.length, 0)
    : standardRelays.length;

  const connectedCount = isNip17
    ? nip17RelayData.reduce(
        (sum, p) => sum + p.relayData.filter((r) => r.isConnected).length,
        0,
      )
    : standardRelayData.filter((r) => r.isConnected).length;

  // Check if still loading
  const isLoading = isNip17 && participantRelays.some((p) => p.loading);

  if (!isNip17 && standardRelays.length === 0) {
    return null; // Don't show if no relays for non-NIP-17
  }

  // For NIP-17 DMs, always show the button (even if relays are loading or empty)
  if (isNip17) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <Inbox className="size-3" />
            <span>
              {isLoading ? "..." : `${connectedCount}/${totalRelays}`}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Private Inbox Relays (NIP-17)
          </div>
          <div className="space-y-2 p-1 max-h-64 overflow-y-auto">
            {nip17RelayData.map(({ pubkey, relays, loading, relayData }) => (
              <div key={pubkey} className="space-y-1">
                <div className="flex items-center gap-2 px-2 py-1 bg-muted/30 rounded text-xs">
                  <UserName pubkey={pubkey} className="font-medium truncate" />
                  <span className="text-muted-foreground ml-auto">
                    {loading
                      ? "..."
                      : `${relays.length} relay${relays.length !== 1 ? "s" : ""}`}
                  </span>
                </div>
                {loading ? (
                  <div className="px-2 py-1 text-xs text-muted-foreground">
                    Loading...
                  </div>
                ) : relays.length === 0 ? (
                  <div className="px-2 py-1 text-xs text-muted-foreground italic">
                    No inbox relays configured
                  </div>
                ) : (
                  relayData.map(({ url, state }) => {
                    const connIcon = getConnectionIcon(state);
                    const authIcon = getAuthIcon(state);
                    return (
                      <div
                        key={url}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 transition-colors ml-2"
                      >
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {connIcon.icon}
                          {authIcon.icon}
                        </div>
                        <RelayLink
                          url={url}
                          className="text-xs truncate flex-1 min-w-0"
                        />
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Standard relay display for other protocols
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
          <Wifi className="size-3" />
          <span>
            {connectedCount}/{standardRelays.length}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Relays ({standardRelays.length})
        </div>
        <div className="space-y-1 p-1">
          {standardRelayData.map(({ url, state }) => {
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
