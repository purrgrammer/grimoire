import { Radio, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { EventCountDropdown } from "./EventCountDropdown";
import { RelayDropdown } from "./RelayDropdown";
import { SpellFilterDropdown } from "./SpellFilterDropdown";
import {
  getStatusText,
  getStatusTooltip,
  getStatusColor,
  shouldAnimate,
} from "@/lib/req-state-machine";
import type { NostrFilter, NostrEvent } from "@/types/nostr";
import type { ReqOverallState } from "@/types/req-state";
import type { RelaySelectionReasoning } from "@/types/relay-selection";

interface SpellHeaderProps {
  /** Loading state */
  loading?: boolean;
  /** Overall state from req state machine */
  overallState?: ReqOverallState;
  /** Events loaded */
  events: NostrEvent[];
  /** Relays being used */
  relays: string[];
  /** Filter being applied */
  filter: NostrFilter;
  /** Spell event (if published) */
  spellEvent?: NostrEvent;
  /** Relay reasoning (for NIP-65 info) */
  reasoning?: RelaySelectionReasoning[];
  /** Per-relay states from req state machine */
  reqRelayStates?: Map<string, { eose: boolean; eventCount: number }>;
  /** Default filename for exports */
  exportFilename?: string;
  /** Callback to open NIP window */
  onOpenNip?: (number: string) => void;
}

/**
 * SpellHeader - Header for spell content showing live indicator, stats, and controls
 * Displays: [live-indicator] <- space -> [event-count] [relay-count] [filter]
 */
export function SpellHeader({
  loading = false,
  overallState,
  events,
  relays,
  filter,
  spellEvent,
  reasoning,
  reqRelayStates,
  exportFilename,
  onOpenNip,
}: SpellHeaderProps) {
  return (
    <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between">
      {/* Left: Live Indicator */}
      <div className="flex items-center gap-2">
        {loading || overallState ? (
          overallState ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 cursor-help">
                  <Radio
                    className={`size-3 ${getStatusColor(overallState.status)} ${
                      shouldAnimate(overallState.status) ? "animate-pulse" : ""
                    }`}
                  />
                  <span
                    className={`${getStatusColor(overallState.status)} font-semibold`}
                  >
                    {getStatusText(overallState)}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent className="bg-popover text-popover-foreground border border-border shadow-md">
                <p>{getStatusTooltip(overallState)}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          )
        ) : null}
      </div>

      {/* Right: Stats and Controls */}
      <div className="flex items-center gap-3">
        {/* Event Count (with export) */}
        <EventCountDropdown
          events={events}
          defaultFilename={exportFilename || spellName}
        />

        {/* Relay Count */}
        <RelayDropdown
          relays={relays}
          reasoning={reasoning}
          reqRelayStates={reqRelayStates}
          onOpenNip={onOpenNip}
        />

        {/* Filter */}
        <SpellFilterDropdown filter={filter} spellEvent={spellEvent} />
      </div>
    </div>
  );
}
