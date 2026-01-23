import { useProfile } from "@/hooks/useProfile";
import { UserName } from "./nostr/UserName";
import Nip05 from "./nostr/nip05";
import { ProfileCardSkeleton } from "@/components/ui/skeleton";
import {
  Copy,
  CopyCheck,
  User as UserIcon,
  Inbox,
  Send,
  Wifi,
  HardDrive,
  Zap,
  Wand2,
} from "lucide-react";
import { kinds, nip19 } from "nostr-tools";
import { useEventStore, use$ } from "applesauce-react/hooks";
import { getInboxes, getOutboxes } from "applesauce-core/helpers/mailboxes";
import { useCopy } from "../hooks/useCopy";
import { RichText } from "./nostr/RichText";
import { RelayLink } from "./nostr/RelayLink";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { useRelayState } from "@/hooks/useRelayState";
import { getConnectionIcon, getAuthIcon } from "@/lib/relay-status-utils";
import { addressLoader } from "@/services/loaders";
import { relayListCache } from "@/services/relay-list-cache";
import { useEffect, useState, useMemo } from "react";
import type { Subscription } from "rxjs";
import { useGrimoire } from "@/core/state";
import { USER_SERVER_LIST_KIND, getServersFromEvent } from "@/services/blossom";
import blossomServerCache from "@/services/blossom-server-cache";
import { useUserParameterizedSpells } from "@/hooks/useParameterizedSpells";
import { EventFeed } from "./nostr/EventFeed";
import { useReqTimelineEnhanced } from "@/hooks/useReqTimelineEnhanced";
import { applySpellParameters, decodeSpell } from "@/lib/spell-conversion";
import { parseReqCommand } from "@/lib/req-parser";
import { useOutboxRelays } from "@/hooks/useOutboxRelays";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { KindBadge } from "./KindBadge";
import { CreateParameterizedSpellDialog } from "./CreateParameterizedSpellDialog";
import { SpellHeader } from "./timeline/SpellHeader";

export interface ProfileViewerProps {
  pubkey: string;
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
  targetPubkey: string | undefined;
}

/**
 * SpellTabContent - Renders a parameterized spell applied to a specific target
 */
function SpellTabContent({
  spellId,
  spell,
  targetPubkey,
}: SpellTabContentProps) {
  const { state, addWindow } = useGrimoire();
  const eventStore = useEventStore();

  // Fetch target pubkey's contacts (kind 3 contact list)
  const contactListEvent = use$(
    () =>
      targetPubkey
        ? eventStore.replaceable(kinds.Contacts, targetPubkey)
        : undefined,
    [targetPubkey, eventStore],
  );

  const targetContacts = useMemo(() => {
    if (!contactListEvent) return [];

    try {
      // Extract pubkeys from p tags
      const contacts = contactListEvent.tags
        .filter((tag: string[]) => tag[0] === "p" && tag[1])
        .map((tag: string[]) => tag[1]);

      console.log(
        `[SpellTabContent:${spell.name || spellId}] Target contacts:`,
        {
          count: contacts.length,
          targetPubkey,
        },
      );

      return contacts;
    } catch (error) {
      console.error(
        `[SpellTabContent:${spell.name || spellId}] Failed to fetch contacts:`,
        error,
      );
      return [];
    }
  }, [contactListEvent, targetPubkey, spell.name, spellId]);

  // Parse spell and get filter - handle both published (with event) and local (command-only) spells
  const parsed = useMemo(() => {
    if (!targetPubkey) {
      console.log(
        `[SpellTabContent:${spell.name || spellId}] No target pubkey`,
      );
      return null;
    }

    try {
      console.log(`[SpellTabContent:${spell.name || spellId}] Parsing spell:`, {
        hasEvent: !!spell.event,
        command: spell.command,
        parameterType: spell.parameterType,
      });

      // If we have a published event, decode it
      if (spell.event) {
        const decoded = decodeSpell(spell.event);
        console.log(
          `[SpellTabContent:${spell.name || spellId}] Decoded from event:`,
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
        `[SpellTabContent:${spell.name || spellId}] Parsing local spell command`,
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

      console.log(
        `[SpellTabContent:${spell.name || spellId}] Parsed local spell:`,
        {
          filter: localParsed.filter,
          relays: localParsed.relays,
          parameter: localParsed.parameter,
        },
      );

      return localParsed;
    } catch (error) {
      console.error(
        `[SpellTabContent:${spell.name || spellId}] Failed to parse spell:`,
        error,
      );
      return null;
    }
  }, [spell, targetPubkey, spellId]);

  // Apply parameters to get final filter
  const appliedFilter = useMemo(() => {
    if (!parsed || !targetPubkey) return null;

    try {
      const applied = applySpellParameters(parsed, {
        targetPubkey,
        targetContacts,
      });
      console.log(
        `[SpellTabContent:${spell.name || spellId}] Applied parameters:`,
        {
          targetPubkey,
          targetContactsCount: targetContacts.length,
          result: applied,
        },
      );
      return applied;
    } catch (error) {
      console.error(
        `[SpellTabContent:${spell.name || spellId}] Failed to apply parameters:`,
        error,
      );
      return null;
    }
  }, [parsed, targetPubkey, targetContacts, spell.name, spellId]);

  // Resolve relays - use explicit relays from spell, or use NIP-65 outbox selection
  const fallbackRelays = useMemo(
    () =>
      state.activeAccount?.relays?.filter((r) => r.read).map((r) => r.url) ||
      AGGREGATOR_RELAYS,
    [state.activeAccount?.relays],
  );

  const outboxOptions = useMemo(
    () => ({
      fallbackRelays,
      timeout: 1000,
      maxRelays: 42,
    }),
    [fallbackRelays],
  );

  // Use outbox relay selection if no explicit relays provided in spell
  const { relays: selectedRelays, phase: relaySelectionPhase } =
    useOutboxRelays(appliedFilter || {}, outboxOptions);

  const finalRelays = useMemo(() => {
    // Use explicit relays from spell if provided
    if (parsed?.relays && parsed.relays.length > 0) {
      console.log(
        `[SpellTabContent:${spell.name || spellId}] Using explicit relays:`,
        parsed.relays,
      );
      return parsed.relays;
    }

    // Wait for outbox relay selection to complete
    if (relaySelectionPhase !== "ready") {
      console.log(
        `[SpellTabContent:${spell.name || spellId}] Waiting for relay selection (phase: ${relaySelectionPhase})`,
      );
      return [];
    }

    console.log(
      `[SpellTabContent:${spell.name || spellId}] Using outbox-selected relays:`,
      selectedRelays,
    );
    return selectedRelays;
  }, [
    parsed?.relays,
    relaySelectionPhase,
    selectedRelays,
    spell.name,
    spellId,
  ]);

  // Fetch events using the applied filter
  // Always call the hook unconditionally (React Rules of Hooks)
  const shouldFetch = !!(appliedFilter && finalRelays.length > 0);
  const { events, loading, eoseReceived, relayStates, overallState } =
    useReqTimelineEnhanced(
      shouldFetch ? `spell-${spellId}-${targetPubkey}` : `disabled-${spellId}`,
      appliedFilter || {},
      shouldFetch ? finalRelays : [],
      { limit: appliedFilter?.limit || 50, stream: true },
    );

  console.log(`[SpellTabContent:${spell.name || spellId}] Render state:`, {
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
            <p className="text-sm">Unable to apply spell to this profile</p>
            <p className="text-xs mt-2">Check console for details</p>
          </div>
        </div>
      ) : finalRelays.length === 0 ? (
        <div className="flex items-center justify-center h-full p-8 text-center text-muted-foreground">
          <div>
            <p className="text-sm">Selecting relays...</p>
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
 * ProfileViewer - Detailed view for a user profile
 * Shows profile metadata, inbox/outbox relays, and raw JSON
 */
export function ProfileViewer({ pubkey }: ProfileViewerProps) {
  const { state, addWindow } = useGrimoire();
  const accountPubkey = state.activeAccount?.pubkey;
  const [createSpellDialogOpen, setCreateSpellDialogOpen] = useState(false);

  // Resolve $me alias
  const resolvedPubkey = pubkey === "$me" ? accountPubkey : pubkey;

  const profile = useProfile(resolvedPubkey);
  const eventStore = useEventStore();
  const { copy, copied } = useCopy();
  const { relays: relayStates } = useRelayState();

  // Get user's parameterized spells for $pubkey
  const userRelays =
    state.activeAccount?.relays?.filter((r) => r.read).map((r) => r.url) || [];
  const { spells: pubkeySpells } = useUserParameterizedSpells(
    accountPubkey,
    "$pubkey",
    userRelays,
  );

  // Fetch fresh relay list from network only if not cached or stale
  useEffect(() => {
    let subscription: Subscription | null = null;
    if (!resolvedPubkey) return;

    // Check if we have a valid cached relay list
    relayListCache.has(resolvedPubkey).then(async (hasCached) => {
      if (hasCached) {
        console.debug(
          `[ProfileViewer] Using cached relay list for ${resolvedPubkey.slice(0, 8)}`,
        );

        // Load cached event into EventStore so UI can display it
        const cached = await relayListCache.get(resolvedPubkey);
        if (cached?.event) {
          eventStore.add(cached.event);
          console.debug(
            `[ProfileViewer] Loaded cached relay list into EventStore for ${resolvedPubkey.slice(0, 8)}`,
          );
        }
        return;
      }

      // No cached or stale - fetch fresh from network
      console.debug(
        `[ProfileViewer] Fetching fresh relay list for ${resolvedPubkey.slice(0, 8)}`,
      );
      subscription = addressLoader({
        kind: kinds.RelayList,
        pubkey: resolvedPubkey,
        identifier: "",
      }).subscribe({
        error: (err) => {
          console.debug(
            `[ProfileViewer] Failed to fetch relay list for ${resolvedPubkey.slice(0, 8)}:`,
            err,
          );
        },
      });
    });

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [resolvedPubkey, eventStore]);

  // Get mailbox relays (kind 10002) - will update when fresh data arrives
  const mailboxEvent = use$(
    () =>
      resolvedPubkey
        ? eventStore.replaceable(kinds.RelayList, resolvedPubkey, "")
        : undefined,
    [eventStore, resolvedPubkey],
  );
  const inboxRelays =
    mailboxEvent && mailboxEvent.tags ? getInboxes(mailboxEvent) : [];
  const outboxRelays =
    mailboxEvent && mailboxEvent.tags ? getOutboxes(mailboxEvent) : [];

  // Get profile metadata event (kind 0)
  const profileEvent = use$(
    () =>
      resolvedPubkey
        ? eventStore.replaceable(0, resolvedPubkey, "")
        : undefined,
    [eventStore, resolvedPubkey],
  );

  // Blossom servers state (kind 10063)
  const [blossomServers, setBlossomServers] = useState<string[]>([]);

  // Fetch Blossom server list (kind 10063)
  useEffect(() => {
    if (!resolvedPubkey) {
      setBlossomServers([]);
      return;
    }

    // First, check cache for instant display
    blossomServerCache.getServers(resolvedPubkey).then((cachedServers) => {
      if (cachedServers && cachedServers.length > 0) {
        setBlossomServers(cachedServers);
      }
    });

    // Check if we already have the event in EventStore
    const existingEvent = eventStore.getReplaceable(
      USER_SERVER_LIST_KIND,
      resolvedPubkey,
      "",
    );
    if (existingEvent) {
      const servers = getServersFromEvent(existingEvent);
      setBlossomServers(servers);
      // Also update cache
      blossomServerCache.set(existingEvent);
    }

    // Subscribe to EventStore for reactive updates
    const storeSubscription = eventStore
      .replaceable(USER_SERVER_LIST_KIND, resolvedPubkey, "")
      .subscribe((event) => {
        if (event) {
          const servers = getServersFromEvent(event);
          setBlossomServers(servers);
          // Also update cache
          blossomServerCache.set(event);
        } else {
          setBlossomServers([]);
        }
      });

    // Also fetch from network to get latest data
    const networkSubscription = addressLoader({
      kind: USER_SERVER_LIST_KIND,
      pubkey: resolvedPubkey,
      identifier: "",
    }).subscribe();

    return () => {
      storeSubscription.unsubscribe();
      networkSubscription.unsubscribe();
    };
  }, [resolvedPubkey, eventStore]);

  // Combine all relays (inbox + outbox) for nprofile
  const allRelays = [...new Set([...inboxRelays, ...outboxRelays])];

  // Calculate connection count for relay dropdown
  const connectedCount = allRelays.filter(
    (url) => relayStates[url]?.connectionState === "connected",
  ).length;

  // Generate npub or nprofile depending on relay availability
  const identifier =
    resolvedPubkey && allRelays.length > 0
      ? nip19.nprofileEncode({
          pubkey: resolvedPubkey,
          relays: allRelays,
        })
      : resolvedPubkey
        ? nip19.npubEncode(resolvedPubkey)
        : "";

  if (pubkey === "$me" && !accountPubkey) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <div className="text-muted-foreground">
          <UserIcon className="size-12 mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-2">Account Required</h3>
          <p className="text-sm max-w-md">
            The <code className="bg-muted px-1.5 py-0.5">$me</code> alias
            requires an active account. Please log in to view your profile.
          </p>
        </div>
      </div>
    );
  }

  if (!resolvedPubkey) {
    return (
      <div className="p-4 text-muted-foreground">Invalid profile pubkey.</div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Header - Single Line */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between gap-3">
        {/* Left: npub/nprofile */}
        <button
          onClick={() => copy(identifier)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors truncate min-w-0"
          title={identifier}
          aria-label="Copy profile ID"
        >
          {copied ? (
            <CopyCheck className="size-3 flex-shrink-0" />
          ) : (
            <Copy className="size-3 flex-shrink-0" />
          )}
          <code className="truncate">
            {identifier.slice(0, 16)}...{identifier.slice(-8)}
          </code>
        </button>

        {/* Right: Profile icon and Relay dropdown */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1 text-muted-foreground">
            <UserIcon className="size-3" />
            <span>Profile</span>
          </div>

          {allRelays.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`${allRelays.length} relay${allRelays.length !== 1 ? "s" : ""}`}
                >
                  <Wifi className="size-3" />
                  <span>
                    {connectedCount}/{allRelays.length}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {allRelays.map((url) => {
                  const state = relayStates[url];
                  const connIcon = getConnectionIcon(state);
                  const authIcon = getAuthIcon(state);
                  const isInbox = inboxRelays.includes(url);
                  const isOutbox = outboxRelays.includes(url);

                  return (
                    <DropdownMenuItem
                      key={url}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {isInbox && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Inbox className="size-3 text-muted-foreground flex-shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Inbox</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {isOutbox && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Send className="size-3 text-muted-foreground flex-shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Outbox</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <RelayLink
                          url={url}
                          showInboxOutbox={false}
                          className="flex-1 min-w-0 hover:bg-transparent"
                          iconClassname="size-3"
                          urlClassname="text-xs"
                        />
                      </div>
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

          {/* Blossom servers dropdown */}
          {blossomServers.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`${blossomServers.length} Blossom server${blossomServers.length !== 1 ? "s" : ""}`}
                >
                  <HardDrive className="size-3" />
                  <span>{blossomServers.length}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {blossomServers.map((url) => (
                  <DropdownMenuItem
                    key={url}
                    className="flex items-center justify-between gap-2 cursor-crosshair"
                    onClick={() => {
                      if (resolvedPubkey) {
                        addWindow(
                          "blossom",
                          {
                            subcommand: "list",
                            pubkey: resolvedPubkey,
                            serverUrl: url,
                          },
                          `Files on ${url}`,
                        );
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <HardDrive className="size-3 text-muted-foreground flex-shrink-0" />
                      <span className="font-mono text-xs truncate">{url}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Profile Content */}
      <div
        className={`overflow-y-auto p-4 ${pubkeySpells.length > 0 ? "flex-1 min-h-0" : ""}`}
      >
        {!profile && !profileEvent && <ProfileCardSkeleton variant="full" />}

        {!profile && profileEvent && (
          <div className="text-center text-muted-foreground text-sm">
            No profile metadata found
          </div>
        )}

        {profile && (
          <div className="flex flex-col gap-4 max-w-2xl">
            <div className="flex flex-col gap-0">
              {/* Display Name */}
              <UserName
                pubkey={pubkey}
                className="text-2xl font-bold pointer-events-none"
              />
              {/* NIP-05 */}
              {profile.nip05 && (
                <div className="text-xs">
                  <Nip05 pubkey={pubkey} profile={profile} />
                </div>
              )}
            </div>

            {/* About/Bio */}
            {profile.about && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  About
                </div>
                <RichText
                  className="text-sm whitespace-pre-wrap break-words"
                  content={profile.about}
                />
              </div>
            )}

            {/* Website */}
            {profile.website && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  Website
                </div>
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent underline decoration-dotted"
                >
                  {profile.website}
                </a>
              </div>
            )}

            {/* Lightning Address */}
            {profile.lud16 && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  Lightning Address
                </div>
                <button
                  onClick={() =>
                    addWindow("zap", { recipientPubkey: resolvedPubkey })
                  }
                  className="flex items-center gap-2 w-full text-left hover:bg-muted/50 rounded px-2 py-1 -mx-2 transition-colors group"
                  title="Send zap"
                >
                  <Zap className="size-4 text-yellow-500 group-hover:text-yellow-600 transition-colors flex-shrink-0" />
                  <code className="text-sm font-mono flex-1 min-w-0 truncate">
                    {profile.lud16}
                  </code>
                </button>
              </div>
            )}

            {/* LUD06 (LNURL) */}
            {profile.lud06 && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  LNURL
                </div>
                <code className="text-sm font-mono break-all">
                  {profile.lud06}
                </code>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Spell Tabs */}
      <div className="border-t border-border flex-1 overflow-hidden flex flex-col min-h-0">
        {pubkeySpells.length > 0 ? (
          <Tabs className="flex flex-col h-full">
            <div className="flex items-center border-b">
              <button
                onClick={() => setCreateSpellDialogOpen(true)}
                className="px-4 py-2 flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border-r"
                title="Create spell for this profile"
              >
                <Wand2 className="size-4" />
              </button>
              <TabsList className="flex-1 justify-start rounded-none border-none bg-transparent p-0 h-auto flex-shrink-0 overflow-x-auto overflow-y-hidden scrollbar-hide">
                {pubkeySpells.map((spell) => {
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
            {pubkeySpells.map((spell) => (
              <SpellTabContent
                key={spell.id}
                spellId={spell.id}
                spell={spell}
                targetPubkey={resolvedPubkey}
              />
            ))}
          </Tabs>
        ) : (
          <div className="flex items-center justify-center p-4 border-b">
            <button
              onClick={() => setCreateSpellDialogOpen(true)}
              className="px-4 py-2 flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors rounded-md"
              title="Create spell for this profile"
            >
              <Wand2 className="size-4" />
              <span className="text-sm">Create spell</span>
            </button>
          </div>
        )}
      </div>

      {/* Create Parameterized Spell Dialog */}
      <CreateParameterizedSpellDialog
        open={createSpellDialogOpen}
        onOpenChange={setCreateSpellDialogOpen}
        parameterType="$pubkey"
        onSuccess={() => {
          // Dialog will close automatically, spells will refresh via useUserParameterizedSpells
        }}
      />
    </div>
  );
}
