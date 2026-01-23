import { useState, useMemo } from "react";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { DetailKindRenderer } from "./nostr/kinds";
import { EventErrorBoundary } from "./EventErrorBoundary";
import { JsonViewer } from "./JsonViewer";
import { RelayLink } from "./nostr/RelayLink";
import { EventDetailSkeleton } from "@/components/ui/skeleton";
import { Copy, CopyCheck, FileJson, Wifi, Wand2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { nip19 } from "nostr-tools";
import { useCopy } from "../hooks/useCopy";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { getTagValue } from "applesauce-core/helpers";
import { useRelayState } from "@/hooks/useRelayState";
import { getConnectionIcon, getAuthIcon } from "@/lib/relay-status-utils";
import { useGrimoire } from "@/core/state";
import { useUserParameterizedSpells } from "@/hooks/useParameterizedSpells";
import { EventFeed } from "./nostr/EventFeed";
import { useReqTimelineEnhanced } from "@/hooks/useReqTimelineEnhanced";
import { applySpellParameters, decodeSpell } from "@/lib/spell-conversion";
import { parseReqCommand } from "@/lib/req-parser";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { KindBadge } from "./KindBadge";
import { CreateParameterizedSpellDialog } from "./CreateParameterizedSpellDialog";
import { SpellHeader } from "./timeline/SpellHeader";

export interface EventDetailViewerProps {
  pointer: EventPointer | AddressPointer;
}

interface SpellTabContentProps {
  spellId: string;
  spell: {
    id: string;
    name?: string;
    command: string;
    parameterType: "$pubkey" | "$event" | "$relay";
    parameterDefault?: string[];
    event?: any;
  };
  targetEventId: string;
}

/**
 * SpellTabContent - Renders a parameterized spell applied to a specific event
 */
function SpellTabContent({
  spellId,
  spell,
  targetEventId,
  targetEvent,
}: SpellTabContentProps & { targetEvent: any }) {
  const { addWindow } = useGrimoire();
  // Parse spell and get filter - handle both published (with event) and local (command-only) spells
  const parsed = useMemo(() => {
    if (!targetEventId) {
      console.log(`[EventSpell:${spell.name || spellId}] No target event ID`);
      return null;
    }

    try {
      console.log(`[EventSpell:${spell.name || spellId}] Parsing spell:`, {
        hasEvent: !!spell.event,
        command: spell.command,
        parameterType: spell.parameterType,
      });

      // If we have a published event, decode it
      if (spell.event) {
        const decoded = decodeSpell(spell.event);
        console.log(
          `[EventSpell:${spell.name || spellId}] Decoded from event:`,
          {
            filter: decoded.filter,
            relays: decoded.relays,
            parameter: decoded.parameter,
          },
        );
        return decoded;
      }

      // For local spells, parse the command directly
      console.log(
        `[EventSpell:${spell.name || spellId}] Parsing local spell command`,
      );
      const commandWithoutPrefix = spell.command
        .replace(/^\s*(req|count)\s+/i, "")
        .trim();
      const tokens = commandWithoutPrefix.split(/\s+/);
      const commandParsed = parseReqCommand(tokens);

      // Create a ParsedSpell-like object for local spells
      const localParsed = {
        command: spell.command,
        filter: commandParsed.filter,
        relays: commandParsed.relays,
        closeOnEose: commandParsed.closeOnEose,
        parameter: spell.parameterType
          ? {
              type: spell.parameterType,
              default: spell.parameterDefault,
            }
          : undefined,
      };

      console.log(`[EventSpell:${spell.name || spellId}] Parsed local spell:`, {
        filter: localParsed.filter,
        relays: localParsed.relays,
        parameter: localParsed.parameter,
      });

      return localParsed;
    } catch (error) {
      console.error(
        `[EventSpell:${spell.name || spellId}] Failed to parse spell:`,
        error,
      );
      return null;
    }
  }, [spell, targetEventId, spellId]);

  // Apply parameters to get final filter
  const appliedFilter = useMemo(() => {
    if (!parsed || !targetEventId) return null;

    try {
      const applied = applySpellParameters(parsed, {
        targetEventId,
      });
      console.log(`[EventSpell:${spell.name || spellId}] Applied parameters:`, {
        targetEventId,
        result: applied,
      });
      return applied;
    } catch (error) {
      console.error(
        `[EventSpell:${spell.name || spellId}] Failed to apply parameters:`,
        error,
      );
      return null;
    }
  }, [parsed, targetEventId, spell.name, spellId]);

  // Resolve relays - use explicit relays from spell, or use relay hints from target event
  const finalRelays = useMemo(() => {
    // Don't select relays until filter is resolved (variables substituted)
    if (!appliedFilter) {
      console.log(
        `[EventSpell:${spell.name || spellId}] Waiting for filter resolution before selecting relays`,
      );
      return [];
    }

    // Use explicit relays from spell if provided
    if (parsed?.relays && parsed.relays.length > 0) {
      console.log(
        `[EventSpell:${spell.name || spellId}] Using explicit relays:`,
        parsed.relays,
      );
      return parsed.relays;
    }

    // Use relay hints from the target event
    if (targetEvent) {
      const seenRelaysSet = getSeenRelays(targetEvent);
      if (seenRelaysSet && seenRelaysSet.size > 0) {
        const eventRelays = Array.from(seenRelaysSet);
        console.log(
          `[EventSpell:${spell.name || spellId}] Using target event relays:`,
          eventRelays,
        );
        return eventRelays;
      }
    }

    // Fallback to aggregator relays
    console.log(
      `[EventSpell:${spell.name || spellId}] Using fallback AGGREGATOR_RELAYS`,
    );
    return AGGREGATOR_RELAYS;
  }, [appliedFilter, parsed?.relays, targetEvent, spell.name, spellId]);

  // Fetch events using the applied filter
  // Always call the hook unconditionally (React Rules of Hooks)
  const shouldFetch = !!(appliedFilter && finalRelays.length > 0);
  const { events, loading, eoseReceived, relayStates, overallState } =
    useReqTimelineEnhanced(
      shouldFetch ? `spell-${spellId}-${targetEventId}` : `disabled-${spellId}`,
      appliedFilter || {},
      shouldFetch ? finalRelays : [],
      { limit: appliedFilter?.limit || 50, stream: true },
    );

  console.log(`[EventSpell:${spell.name || spellId}] Render state:`, {
    hasFilter: !!appliedFilter,
    relayCount: finalRelays.length,
    eventCount: events.length,
    loading,
    eoseReceived,
  });

  // Convert relay states to format expected by SpellHeader
  const reqRelayStatesMap = useMemo(() => {
    const map = new Map<string, { eose: boolean; eventCount: number }>();
    relayStates.forEach((state, url) => {
      map.set(url, {
        eose: state.subscriptionState === "eose",
        eventCount: state.eventCount,
      });
    });
    return map;
  }, [relayStates]);

  return (
    <TabsContent
      value={spellId}
      className="flex-1 overflow-hidden m-0 flex flex-col"
    >
      {!appliedFilter ? (
        <div className="flex items-center justify-center h-full p-8 text-center text-muted-foreground">
          <div>
            <p className="text-sm">Unable to apply spell to this event</p>
            <p className="text-xs mt-2">Check console for details</p>
          </div>
        </div>
      ) : (
        <>
          <SpellHeader
            loading={loading}
            overallState={overallState}
            events={events}
            relays={finalRelays}
            filter={appliedFilter}
            spellEvent={spell.event}
            reqRelayStates={reqRelayStatesMap}
            exportFilename={spell.name || "spell-events"}
            onOpenNip={(number) => addWindow("nip", { number })}
          />
          <div className="flex-1 overflow-hidden">
            <EventFeed
              events={events}
              view="list"
              loading={loading}
              eoseReceived={eoseReceived}
              stream={true}
              enableFreeze={true}
            />
          </div>
        </>
      )}
    </TabsContent>
  );
}

/**
 * EventDetailViewer - Detailed view for a single event
 * Shows compact metadata header and rendered content
 */
export function EventDetailViewer({ pointer }: EventDetailViewerProps) {
  const event = useNostrEvent(pointer);
  const [showJson, setShowJson] = useState(false);
  const [createSpellDialogOpen, setCreateSpellDialogOpen] = useState(false);
  const { copy: copyBech32, copied: copiedBech32 } = useCopy();
  const { relays: relayStates } = useRelayState();
  const { state } = useGrimoire();

  // Get user's parameterized spells for $event
  const accountPubkey = state.activeAccount?.pubkey;
  const userRelays =
    state.activeAccount?.relays?.filter((r) => r.read).map((r) => r.url) || [];
  const { spells: eventSpells } = useUserParameterizedSpells(
    accountPubkey,
    "$event",
    userRelays,
  );

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

      {/* Rendered Content */}
      <div className="overflow-y-auto">
        <EventErrorBoundary event={event}>
          <DetailKindRenderer event={event} />
        </EventErrorBoundary>
      </div>

      {/* Spell Tabs */}
      <div className="border-t border-border flex-1 overflow-hidden flex flex-col min-h-0">
        {eventSpells.length > 0 ? (
          <Tabs className="flex flex-col h-full">
            <div className="flex items-center border-b">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCreateSpellDialogOpen(true)}
                className="rounded-none border-r h-10 w-10"
                title="Create spell for this event"
              >
                <Wand2 className="size-4" />
              </Button>
              <TabsList className="flex-1 justify-start rounded-none border-none bg-transparent p-0 h-auto flex-shrink-0 overflow-x-auto overflow-y-hidden scrollbar-hide">
                {eventSpells.map((spell) => {
                  // Extract kinds from spell for display
                  const spellKinds = (() => {
                    try {
                      if (spell.event) {
                        const decoded = decodeSpell(spell.event);
                        return decoded.filter.kinds?.slice(0, 3) || [];
                      }
                      // For local spells, parse command
                      const commandWithoutPrefix = spell.command
                        .replace(/^\s*(req|count)\s+/i, "")
                        .trim();
                      const tokens = commandWithoutPrefix.split(/\s+/);
                      const parsed = parseReqCommand(tokens);
                      return parsed.filter.kinds?.slice(0, 3) || [];
                    } catch {
                      return [];
                    }
                  })();

                  return (
                    <TabsTrigger
                      key={spell.id}
                      value={spell.id}
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 flex items-center gap-2 whitespace-nowrap"
                    >
                      {spellKinds.length > 0 && (
                        <div className="flex items-center gap-1">
                          {spellKinds.map((kind) => (
                            <KindBadge
                              key={kind}
                              kind={kind}
                              variant="compact"
                              iconClassname="size-3 text-muted-foreground"
                            />
                          ))}
                        </div>
                      )}
                      <span>
                        {spell.name || spell.alias || "Untitled Spell"}
                      </span>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            {/* Spell Tab Contents */}
            {eventSpells.map((spell) => (
              <SpellTabContent
                key={spell.id}
                spellId={spell.id}
                spell={spell}
                targetEventId={event.id}
                targetEvent={event}
              />
            ))}
          </Tabs>
        ) : (
          <div className="flex items-center justify-center border-b">
            <Button
              variant="ghost"
              onClick={() => setCreateSpellDialogOpen(true)}
              className="w-full justify-center rounded-none"
              title="Create spell for this event"
            >
              <Wand2 />
              Create spell
            </Button>
          </div>
        )}
      </div>

      {/* Create Parameterized Spell Dialog */}
      <CreateParameterizedSpellDialog
        open={createSpellDialogOpen}
        onOpenChange={setCreateSpellDialogOpen}
        parameterType="$event"
        onSuccess={() => {
          // Dialog will close automatically, spells will refresh via useUserParameterizedSpells
        }}
      />

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
