import { Copy, CopyCheck, Wand2 } from "lucide-react";
import { useRelayInfo } from "../hooks/useRelayInfo";
import { useCopy } from "../hooks/useCopy";
import { Button } from "./ui/button";
import { UserName } from "./nostr/UserName";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { useGrimoire } from "@/core/state";
import { useUserParameterizedSpells } from "@/hooks/useParameterizedSpells";
import { EventFeed } from "./nostr/EventFeed";
import { useReqTimelineEnhanced } from "@/hooks/useReqTimelineEnhanced";
import { applySpellParameters, decodeSpell } from "@/lib/spell-conversion";
import { parseReqCommand } from "@/lib/req-parser";
import { useMemo } from "react";
import { NIPBadge } from "./NIPBadge";
import { SpellHeader } from "./timeline/SpellHeader";

export interface RelayViewerProps {
  url: string;
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
  targetRelay: string;
}

/**
 * SpellTabContent - Renders a parameterized spell applied to a specific relay
 */
function SpellTabContent({
  spellId,
  spell,
  targetRelay,
}: SpellTabContentProps) {
  const { addWindow } = useGrimoire();

  // Parse spell and get filter - handle both published (with event) and local (command-only) spells
  const parsed = useMemo(() => {
    if (!targetRelay) {
      console.log(`[RelaySpell:${spell.name || spellId}] No target relay`);
      return null;
    }

    try {
      console.log(`[RelaySpell:${spell.name || spellId}] Parsing spell:`, {
        hasEvent: !!spell.event,
        command: spell.command,
        parameterType: spell.parameterType,
      });

      // If we have a published event, decode it
      if (spell.event) {
        const decoded = decodeSpell(spell.event);
        console.log(
          `[RelaySpell:${spell.name || spellId}] Decoded from event:`,
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
        `[RelaySpell:${spell.name || spellId}] Parsing local spell command`,
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

      console.log(`[RelaySpell:${spell.name || spellId}] Parsed local spell:`, {
        filter: localParsed.filter,
        relays: localParsed.relays,
        parameter: localParsed.parameter,
      });

      return localParsed;
    } catch (error) {
      console.error(
        `[RelaySpell:${spell.name || spellId}] Failed to parse spell:`,
        error,
      );
      return null;
    }
  }, [spell, targetRelay, spellId]);

  // Apply parameters to get final filter
  const appliedFilter = useMemo(() => {
    if (!parsed || !targetRelay) return null;

    try {
      const applied = applySpellParameters(parsed, [targetRelay]);
      console.log(`[RelaySpell:${spell.name || spellId}] Applied parameters:`, {
        input: targetRelay,
        result: applied,
      });
      return applied;
    } catch (error) {
      console.error(
        `[RelaySpell:${spell.name || spellId}] Failed to apply parameters:`,
        error,
      );
      return null;
    }
  }, [parsed, targetRelay, spell.name, spellId]);

  // Resolve relays - for $relay spells, we query FROM the target relay itself
  const finalRelays = useMemo(() => {
    // Use explicit relays from spell if provided
    if (parsed?.relays && parsed.relays.length > 0) {
      console.log(
        `[RelaySpell:${spell.name || spellId}] Using explicit relays:`,
        parsed.relays,
      );
      return parsed.relays;
    }

    // For $relay spells, query FROM the target relay
    console.log(`[RelaySpell:${spell.name || spellId}] Using target relay:`, [
      targetRelay,
    ]);
    return [targetRelay];
  }, [parsed?.relays, targetRelay, spell.name, spellId]);

  // Fetch events using the applied filter
  const { events, loading, eoseReceived, relayStates, overallState } =
    appliedFilter && finalRelays.length > 0
      ? useReqTimelineEnhanced(
          `spell-${spellId}-${targetRelay}`,
          appliedFilter,
          finalRelays,
          { limit: appliedFilter.limit || 50, stream: true },
        )
      : {
          events: [],
          loading: false,
          eoseReceived: false,
          relayStates: new Map(),
          overallState: undefined,
        };

  // Convert relay states to the format expected by SpellHeader
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

  console.log(`[RelaySpell:${spell.name || spellId}] Render state:`, {
    hasFilter: !!appliedFilter,
    relayCount: finalRelays.length,
    eventCount: events.length,
    loading,
    eoseReceived,
  });

  return (
    <TabsContent
      value={spellId}
      className="flex-1 overflow-hidden m-0 flex flex-col"
    >
      {!appliedFilter ? (
        <div className="flex items-center justify-center h-full p-8 text-center text-muted-foreground">
          <div>
            <p className="text-sm">Unable to apply spell to this relay</p>
            <p className="text-xs mt-2">Check console for details</p>
          </div>
        </div>
      ) : (
        <>
          <SpellHeader
            spellName={spell.name || "Unnamed Spell"}
            spellEventId={spell.event?.id}
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
          <EventFeed
            events={events}
            view="list"
            loading={loading}
            eoseReceived={eoseReceived}
            stream={true}
            enableFreeze={true}
          />
        </>
      )}
    </TabsContent>
  );
}

export function RelayViewer({ url }: RelayViewerProps) {
  const info = useRelayInfo(url);
  const { copy, copied } = useCopy();
  const { state } = useGrimoire();

  // Get user's parameterized spells for $relay
  const accountPubkey = state.activeAccount?.pubkey;
  const userRelays =
    state.activeAccount?.relays?.filter((r) => r.read).map((r) => r.url) || [];
  const { spells: relaySpells } = useUserParameterizedSpells(
    accountPubkey,
    "$relay",
    userRelays,
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Relay Info Content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <h2 className="text-2xl font-bold">
              {info?.name || "Unknown Relay"}
            </h2>
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
              {url}
              <Button
                variant="link"
                size="icon"
                className="size-4 text-muted-foreground"
                onClick={() => copy(url)}
              >
                {copied ? (
                  <CopyCheck className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
              </Button>
            </div>
            {info?.description && (
              <p className="text-sm mt-2">{info.description}</p>
            )}
          </div>
        </div>

        {/* Operator */}
        {(info?.contact || info?.pubkey) && (
          <div>
            <h3 className="mb-2 font-semibold text-sm">Operator</h3>
            <div className="space-y-2 text-sm text-accent">
              {info.contact && info.contact.length == 64 && (
                <UserName pubkey={info.contact} />
              )}
              {info.pubkey && info.pubkey.length === 64 && (
                <UserName pubkey={info.pubkey} />
              )}
            </div>
          </div>
        )}

        {/* Software */}
        {(info?.software || info?.version) && (
          <div>
            <h3 className="mb-2 font-semibold text-sm">Software</h3>
            <span className="text-sm text-muted-foreground">
              {info.software || info.version}
            </span>
          </div>
        )}

        {/* Supported NIPs */}
        {info?.supported_nips && info.supported_nips.length > 0 && (
          <div>
            <h3 className="mb-3 font-semibold text-sm">Supported NIPs</h3>
            <div className="flex flex-wrap gap-2">
              {info.supported_nips.map((num: number) => (
                <NIPBadge
                  key={num}
                  nipNumber={String(num).padStart(2, "0")}
                  showName={true}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Spell Tabs */}
      {relaySpells.length > 0 && (
        <div className="border-t border-border flex-1 overflow-hidden flex flex-col min-h-0">
          <Tabs
            defaultValue={relaySpells[0]?.id}
            className="flex flex-col h-full"
          >
            <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 h-auto flex-shrink-0">
              {relaySpells.map((spell) => (
                <TabsTrigger
                  key={spell.id}
                  value={spell.id}
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
                >
                  {spell.name || spell.alias || "Untitled Spell"}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* Spell Tab Contents */}
            {relaySpells.map((spell) => (
              <SpellTabContent
                key={spell.id}
                spellId={spell.id}
                spell={spell}
                targetRelay={url}
              />
            ))}
          </Tabs>
        </div>
      )}
    </div>
  );
}
