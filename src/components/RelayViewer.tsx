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
import {
  applySpellParameters,
  detectCommandType,
} from "@/lib/spell-conversion";
import { useMemo, useState } from "react";
import { NIPBadge } from "./NIPBadge";
import { KindBadge } from "./KindBadge";
import { CreateParameterizedSpellDialog } from "./CreateParameterizedSpellDialog";
import { SpellHeader } from "./timeline/SpellHeader";
import CountViewer from "./CountViewer";
import { extractSpellKinds } from "@/lib/spell-display";
import { useParseSpell } from "@/hooks/useParseSpell";

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
  const parsed = useParseSpell(spell, targetRelay || "", spellId);

  // Apply parameters to get final filter
  const appliedFilter = useMemo(() => {
    if (!parsed || !targetRelay) return null;

    try {
      const applied = applySpellParameters(parsed, {
        targetRelay,
      });
      console.log(`[RelaySpell:${spell.name || spellId}] Applied parameters:`, {
        targetRelay,
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
    // Don't select relays until filter is resolved (variables substituted)
    if (!appliedFilter) {
      console.log(
        `[RelaySpell:${spell.name || spellId}] Waiting for filter resolution before selecting relays`,
      );
      return [];
    }

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
  }, [appliedFilter, parsed?.relays, targetRelay, spell.name, spellId]);

  // Fetch events using the applied filter
  // Always call the hook unconditionally (React Rules of Hooks)
  const shouldFetch = !!(appliedFilter && finalRelays.length > 0);
  const { events, loading, eoseReceived, relayStates, overallState } =
    useReqTimelineEnhanced(
      shouldFetch ? `spell-${spellId}-${targetRelay}` : `disabled-${spellId}`,
      appliedFilter || {},
      shouldFetch ? finalRelays : [],
      { limit: appliedFilter?.limit || 50, stream: true },
    );

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

  console.log(`[RelaySpell:${spell.name || spellId}] Render state:`, {
    hasFilter: !!appliedFilter,
    relayCount: finalRelays.length,
    eventCount: events.length,
    loading,
    eoseReceived,
  });

  // Determine if this is a COUNT spell or REQ spell
  const isCountSpell = useMemo(() => {
    if (!parsed) return false;
    return detectCommandType(parsed.command) === "COUNT";
  }, [parsed]);

  return (
    <TabsContent
      value={spellId}
      className="flex-1 overflow-auto m-0 flex flex-col"
    >
      {!appliedFilter ? (
        <div className="flex items-center justify-center h-full p-8 text-center text-muted-foreground">
          <div>
            <p className="text-sm">Unable to apply spell to this relay</p>
            <p className="text-xs mt-2">Check console for details</p>
          </div>
        </div>
      ) : isCountSpell ? (
        <CountViewer
          filter={appliedFilter}
          relays={finalRelays}
          needsAccount={false}
        />
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

export function RelayViewer({ url }: RelayViewerProps) {
  const info = useRelayInfo(url);
  const { copy, copied } = useCopy();
  const { state } = useGrimoire();
  const [createSpellDialogOpen, setCreateSpellDialogOpen] = useState(false);

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
      <div className="flex-1 overflow-y-auto min-h-0 p-4 flex flex-col gap-6">
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
      <div className="border-t border-border flex-1 overflow-hidden flex flex-col min-h-0">
        {relaySpells.length > 0 ? (
          <Tabs
            defaultValue={relaySpells[0]?.id}
            className="flex flex-col h-full"
          >
            <div className="flex items-center border-b">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCreateSpellDialogOpen(true)}
                className="rounded-none border-r h-10 w-10"
                title="Create spell for this relay"
              >
                <Wand2 className="size-4" />
              </Button>
              <TabsList className="flex-1 justify-start rounded-none border-none bg-transparent p-0 h-auto flex-shrink-0 overflow-x-auto overflow-y-hidden scrollbar-hide">
                {relaySpells.map((spell) => {
                  // Extract kinds from spell for display
                  const spellKinds = extractSpellKinds(spell);

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
            {relaySpells.map((spell) => (
              <SpellTabContent
                key={spell.id}
                spellId={spell.id}
                spell={spell}
                targetRelay={url}
              />
            ))}
          </Tabs>
        ) : (
          <div className="flex items-center justify-center border-b">
            <Button
              variant="ghost"
              onClick={() => setCreateSpellDialogOpen(true)}
              className="w-full justify-center rounded-none"
              title="Create spell for this relay"
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
        parameterType="$relay"
        onSuccess={() => {
          // Dialog will close automatically, spells will refresh via useUserParameterizedSpells
        }}
      />
    </div>
  );
}
