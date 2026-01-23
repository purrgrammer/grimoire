import { Wifi, Sparkles, Inbox, Link as LinkIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { RelayLink } from "../nostr/RelayLink";
import { useRelayState } from "@/hooks/useRelayState";
import { getConnectionIcon, getAuthIcon } from "@/lib/relay-status-utils";
import { normalizeRelayURL } from "@/lib/relay-url";
import type { RelaySelectionReasoning } from "@/types/relay-selection";

interface RelayDropdownProps {
  relays: string[];
  /** Reasoning for why these relays were selected (NIP-65 info) */
  reasoning?: RelaySelectionReasoning[];
  /** Per-relay states from req state machine (optional) */
  reqRelayStates?: Map<string, { eose: boolean; eventCount: number }>;
  /** Callback to open NIP window */
  onOpenNip?: (number: string) => void;
}

/**
 * RelayDropdown - Reusable component for displaying relay connection status
 * Extracted from ReqViewer to be reusable across spell tabs and other components
 */
export function RelayDropdown({
  relays,
  reasoning,
  reqRelayStates,
  onOpenNip,
}: RelayDropdownProps) {
  const { relays: relayStates } = useRelayState();

  // Normalize relays for consistent lookup
  const normalizedRelays = relays.map((r) => normalizeRelayURL(r));

  // Count connected relays
  const connectedCount = normalizedRelays.filter(
    (url) => relayStates[url]?.connectionState === "connected",
  ).length;

  // Determine relay selection strategy
  const isExplicitRelays = !reasoning || reasoning.length === 0;
  const isOutbox = reasoning && reasoning.some((r) => !r.isFallback);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
          <Wifi className="size-3" />
          <span>
            {connectedCount}/{normalizedRelays.length}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-96 max-h-96 overflow-y-auto"
      >
        {/* Header: Relay Selection Strategy */}
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            {isExplicitRelays ? (
              // Explicit relays
              <>
                <LinkIcon className="size-3 text-muted-foreground/60" />
                <span>Explicit Relays ({normalizedRelays.length})</span>
              </>
            ) : isOutbox ? (
              // NIP-65 Outbox
              <>
                <Sparkles className="size-3 text-muted-foreground/60" />
                <span>
                  {onOpenNip ? (
                    <button
                      className="text-accent underline decoration-dotted cursor-crosshair"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenNip("65");
                      }}
                    >
                      NIP-65 Outbox
                    </button>
                  ) : (
                    "NIP-65 Outbox"
                  )}{" "}
                  ({normalizedRelays.length} relays)
                </span>
              </>
            ) : (
              // Fallback relays
              <>
                <Inbox className="size-3 text-muted-foreground/60" />
                <span>Fallback Relays ({normalizedRelays.length})</span>
              </>
            )}
          </div>
        </div>

        {(() => {
          // Group relays by connection status
          const onlineRelays: string[] = [];
          const disconnectedRelays: string[] = [];

          normalizedRelays.forEach((url) => {
            const globalState = relayStates[url];
            const isConnected = globalState?.connectionState === "connected";

            if (isConnected) {
              onlineRelays.push(url);
            } else {
              disconnectedRelays.push(url);
            }
          });

          const renderRelay = (url: string) => {
            const globalState = relayStates[url];
            const reqState = reqRelayStates?.get(url);
            const connIcon = getConnectionIcon(globalState);
            const authIcon = getAuthIcon(globalState);

            // Find NIP-65 info for this relay (if using outbox)
            const nip65Info = reasoning?.find((r) => r.relay === url);

            // Build comprehensive tooltip content
            const tooltipParts: string[] = [];

            // Connection state
            if (globalState?.connectionState === "connected") {
              tooltipParts.push("✓ Connected");
            } else if (globalState?.connectionState === "connecting") {
              tooltipParts.push("⟳ Connecting...");
            } else if (globalState?.connectionState === "disconnected") {
              tooltipParts.push("✗ Disconnected");
            } else {
              tooltipParts.push("○ Not connected");
            }

            // Auth state
            if (globalState?.authStatus === "authenticated") {
              tooltipParts.push("🔐 Authenticated");
            } else if (globalState?.authStatus === "challenge_received") {
              tooltipParts.push("🔑 Auth challenge received");
            } else if (globalState?.authStatus === "rejected") {
              tooltipParts.push("🚫 Auth rejected");
            }

            // REQ state (if available)
            if (reqState) {
              if (reqState.eose) {
                tooltipParts.push(`✓ EOSE (${reqState.eventCount} events)`);
              } else {
                tooltipParts.push(`⟳ Loading (${reqState.eventCount} events)`);
              }
            }

            // NIP-65 info (if available)
            if (nip65Info) {
              if (nip65Info.isFallback) {
                tooltipParts.push("Fallback relay");
              } else {
                // Show writer/reader info
                if (nip65Info.writers.length > 0) {
                  tooltipParts.push(
                    `Outbox for ${nip65Info.writers.length} author${nip65Info.writers.length !== 1 ? "s" : ""}`,
                  );
                }
                if (nip65Info.readers.length > 0) {
                  tooltipParts.push(
                    `Inbox for ${nip65Info.readers.length} author${nip65Info.readers.length !== 1 ? "s" : ""}`,
                  );
                }
              }
            }

            return (
              <div
                key={url}
                className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {connIcon.icon}
                        {authIcon.icon}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      {tooltipParts.map((part, i) => (
                        <div key={i}>{part}</div>
                      ))}
                    </TooltipContent>
                  </Tooltip>
                  <RelayLink
                    url={url}
                    className="truncate text-foreground hover:text-primary"
                  />
                </div>
                {reqState && (
                  <span className="text-muted-foreground flex-shrink-0">
                    {reqState.eventCount}
                  </span>
                )}
              </div>
            );
          };

          return (
            <>
              {/* Online Relays */}
              {onlineRelays.length > 0 && (
                <div className="border-b border-border">
                  <div className="px-3 py-1.5 text-xs font-semibold text-green-600 dark:text-green-400">
                    Online ({onlineRelays.length})
                  </div>
                  {onlineRelays.map(renderRelay)}
                </div>
              )}

              {/* Disconnected Relays */}
              {disconnectedRelays.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">
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
  );
}
