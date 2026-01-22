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
import { useMemo, useState } from "react";
import { KindBadge } from "./KindBadge";
import { CreateParameterizedSpellDialog } from "./CreateParameterizedSpellDialog";
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

  // Decode spell and apply parameters
  const { appliedFilter, relays } = useMemo(() => {
    if (!targetRelay || !spell.event) {
      return { appliedFilter: null, relays: [] };
    }

    try {
      const parsed = decodeSpell(spell.event);
      const applied = applySpellParameters(parsed, [targetRelay]);
      return {
        appliedFilter: applied,
        relays: parsed.relays || [],
      };
    } catch (error) {
      console.error("Failed to apply spell parameters:", error);
      return { appliedFilter: null, relays: [] };
    }
  }, [spell.event, targetRelay]);

  // Fetch events using the applied filter
  const { events, loading, eoseReceived, relayStates, overallState } =
    appliedFilter
      ? useReqTimelineEnhanced(
          `spell-${spellId}-${targetRelay}`,
          appliedFilter,
          relays,
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

  return (
    <TabsContent
      value={spellId}
      className="flex-1 overflow-hidden m-0 flex flex-col"
    >
      {!appliedFilter ? (
        <div className="flex items-center justify-center h-full p-8 text-center text-muted-foreground">
          <div>
            <p className="text-sm">Unable to apply spell to this relay</p>
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
            relays={relays}
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
      <Tabs defaultValue="info" className="flex flex-col h-full">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 h-auto">
          <TabsTrigger
            value="info"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
          >
            Info
          </TabsTrigger>
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

        {/* Info Tab Content */}
        <TabsContent
          value="info"
          className="flex-1 overflow-y-auto p-4 m-0 flex flex-col gap-6"
        >
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
        </TabsContent>

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
  );
}
