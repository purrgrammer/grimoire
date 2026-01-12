import { Wifi } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RelayLink } from "@/components/nostr/RelayLink";
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
 */
export function RelaysDropdown({ conversation }: RelaysDropdownProps) {
  const { relays: relayStates } = useRelayState();

  // Get relays for this conversation
  const relays: string[] = [];

  // NIP-29: Single group relay
  if (conversation.metadata?.relayUrl) {
    relays.push(conversation.metadata.relayUrl);
  }

  // Normalize URLs for state lookup
  const normalizedRelays = relays.map((url) => {
    try {
      return normalizeRelayURL(url);
    } catch {
      return url;
    }
  });

  // Count connected relays
  const connectedCount = normalizedRelays.filter((url) => {
    const state = relayStates[url];
    return state?.connectionState === "connected";
  }).length;

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
          {relays.map((url) => {
            const normalizedUrl = normalizedRelays[relays.indexOf(url)];
            const state = relayStates[normalizedUrl];
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
