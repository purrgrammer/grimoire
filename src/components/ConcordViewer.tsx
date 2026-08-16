import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PanelLeft, RefreshCw, Search } from "lucide-react";

import { ChatViewer } from "./ChatViewer";
import {
  ChannelList,
  NotifLevelMenu,
  UnreadBadge,
} from "./concord/ConcordChannelList";
import { NoCommunitiesEmpty, StrandedBanner } from "./concord/ArmadaHandoff";
import { ConcordGuestbookPanel } from "./ConcordGuestbookPanel";
import { ConcordSearchPanel } from "./ConcordSearchPanel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  useConcordCommunities,
  useConcordCommunity,
  useConcordGuestbook,
  useConcordIcons,
} from "@/hooks/useConcord";
import {
  useConcordUnread,
  useConcordUnreadTotals,
} from "@/hooks/useConcordUnread";
import type { CommunityUnread } from "@/services/concord-reads";
import { useConcordSearch } from "@/hooks/useConcordSearch";
import type { ConcordSearchHit } from "@/services/concord-search";
import { useConcordWire } from "@/hooks/useConcordWire";
import {
  registerActiveChannel,
  unregisterActiveChannel,
} from "@/lib/concord/notify";
import { useConcordRekeyWatch } from "@/hooks/useConcordRekey";
import { useConcordDissolved } from "@/hooks/useConcordDissolved";
import { useConcordImage } from "@/hooks/useConcordImage";
import type { ImagePointer } from "@/lib/concord/types";
import { resolveOpenChannel } from "@/lib/concord/channels";
import { buildConcordWindowUpdate } from "@/lib/concord/window-props";
import { useConcordPrefs } from "@/hooks/useConcordPrefs";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import type { ConcordIdentifier, ProtocolIdentifier } from "@/types/chat";

interface ConcordViewerProps {
  /** community_id (lowercase hex), or a prefix of one. */
  communityId?: string;
  /** Channel to open on mount, if the caller already knows one. */
  channelId?: string;
  /** The window these props belong to, when there is one to write back to. */
  windowId?: string;
}

/**
 * ConcordViewer — one Concord community: channels on the left, chat on the right.
 *
 * Read-only as to membership and moderation: the community is joined, moderated
 * and rotated in Armada. What this renders is the member's own view of it — the
 * channels their keys can actually open, in the community's own arrangement.
 */
export function ConcordViewer({
  communityId,
  channelId,
  windowId,
}: ConcordViewerProps) {
  const isMobile = useIsMobile();
  const { state: grimoire, updateWindow } = useGrimoire();
  const { lastChannel, setLastChannel } = useConcordPrefs();
  const { communities, status, refresh: refreshList } = useConcordCommunities();
  const icons = useConcordIcons(communities);
  const [selectedId, setSelectedId] = useState<string | undefined>(communityId);
  const [selectedChannel, setSelectedChannel] = useState<string | undefined>(
    channelId,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Desktop only: the channel column is collapsible, the sheet is not. */
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [showGuestbook, setShowGuestbook] = useState(false);
  const [query, setQuery] = useState("");
  /** Search this channel only, or everywhere the member can read. */
  const [searchThisChannel, setSearchThisChannel] = useState(false);
  /**
   * A jump the reader asked for by clicking a result.
   *
   * A nonce rides along because the request has to survive being made twice:
   * clicking the same hit again, after wandering off, must jump again — and a
   * bare id could not tell the second click from the first.
   */
  const [jumpTo, setJumpTo] = useState<{
    messageId: string;
    nonce: number;
  }>();

  // Resolve the community by full id or by prefix — a user typing `concord
  // 3fa2` should land somewhere rather than nowhere.
  const community = useMemo(() => {
    if (communities.length === 0) return undefined;
    const wanted = (selectedId ?? "").toLowerCase();
    if (!wanted) return communities[0];
    return (
      communities.find((c) => c.idHex === wanted) ??
      communities.find((c) => c.idHex.startsWith(wanted)) ??
      communities[0]
    );
  }, [communities, selectedId]);
  const communityIdHex = community?.idHex;

  const { state, loading, error, refresh } = useConcordCommunity(community);
  const channels = useMemo(() => state?.channels ?? [], [state]);

  // Badges for the open community's channels, and for the rows of the ones the
  // reader is not looking at — which is the case a per-channel count alone
  // cannot serve.
  const channelIds = useMemo(() => channels.map((ch) => ch.idHex), [channels]);
  const unread = useConcordUnread(
    community?.idHex,
    channelIds,
    state?.folded.banned,
  );
  const totals = useConcordUnreadTotals(communities);

  // Live delivery for EVERY community in the list, not just the open one: a
  // channel you are not looking at is exactly the case pull-on-open could not
  // serve. Refcounted, so several Concord windows share one set of sockets.
  useConcordWire(communities);

  // Desktop alerts for what the wire brings in. Mounted here for the same
  // reason the wire is: this is the component whose existence means someone is
  // reading Concord at all.
  // Notifications are hidden for now — nothing rings, and no menu offers to
  // tune what does not. One call away from being back.
  // useConcordNotifier();

  // Adopt any CORD-06 rotation addressed to this member. Read-only: grimoire
  // never rotates and never writes the Community List, so an adoption lands in
  // Dexie and the list is re-read to pick it up — which is also what hands the
  // wire the new epoch's addresses and the sidebar its re-keyed channels.
  const handleAdopted = useCallback(() => {
    refreshList();
    refresh();
  }, [refreshList, refresh]);
  const { stranded } = useConcordRekeyWatch(
    community,
    state?.folded,
    handleAdopted,
  );

  // Terminal, one-way (CORD-02 §9). The write gates read the stored verdict
  // themselves; this is what tells the reader why.
  const dissolvedAtMs = useConcordDissolved(community);

  /**
   * The remembered channel, captured when the community changes — NEVER read
   * live.
   *
   * `lastChannel` is a device-wide preference every open window shares, so
   * reading it reactively made one window follow another: open a second window,
   * click a channel in it, and the first window — still on its fallback because
   * nobody had clicked in it yet — jumped to the same channel. Armada hit this
   * and kept the same state per-device for the same reason, and grimoire
   * reproduced it between two windows of one app.
   *
   * Freezing it per community keeps the fallback doing its job (fill the pane on
   * open) without letting a sibling window steer this one.
   */
  const remembered = useMemo(
    () => (communityIdHex ? lastChannel(communityIdHex) : undefined),
    // `lastChannel` is deliberately absent: a later write by another window
    // must not re-run this. `communityIdHex` is the only identity that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [communityIdHex],
  );

  // The OPEN channel is derived, not stored: falling back keeps the pane filled
  // the moment the fold lands, with no effect writing state during a render
  // pass. An explicit pick wins whenever it still resolves; failing that, the
  // channel this device was last left on in this community.
  const openChannel = resolveOpenChannel(channels, selectedChannel, remembered);

  /**
   * Record a deliberate move: on this device, and in this window's own props.
   *
   * Only ever called from a click. A fallback resolution must not write here —
   * it would record the first channel of a community whose fold had not landed
   * yet as the one the reader chose.
   */
  const rememberNavigation = useCallback(
    (idHex: string | undefined, channelIdHex?: string) => {
      if (!idHex) return;
      if (channelIdHex) setLastChannel(idHex, channelIdHex);
      if (!windowId) return;
      const existing = grimoire.windows[windowId]?.props;
      if (!existing) return;
      updateWindow(
        windowId,
        buildConcordWindowUpdate(existing, idHex, channelIdHex),
      );
    },
    [grimoire.windows, setLastChannel, updateWindow, windowId],
  );

  const handleChannelSelect = useCallback(
    (idHex: string) => {
      setSelectedChannel(idHex);
      rememberNavigation(communityIdHex, idHex);
      setShowGuestbook(false);
      // Abandon any pending jump. It is only ever pending because the channel
      // it named would not resolve, and picking a channel by hand says the
      // reader has moved on — without this, the next channel that DOES resolve
      // inherits the jump and walks its history looking for a message that was
      // never in it.
      setJumpTo(undefined);
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, communityIdHex, rememberNavigation],
  );

  const { feed: guestbook, loading: guestbookLoading } = useConcordGuestbook(
    showGuestbook ? community : undefined,
    state?.folded,
  );

  // Memoized BY VALUE, not rebuilt per render. ChatViewer keys its conversation
  // resolution on this object, so a fresh one every render made it re-resolve
  // and blank the timeline — the flicker on first load, where the community
  // paints twice (stored fold, then swept).
  const openChannelIdHex = openChannel?.idHex;

  // Search is Concord's alone for now: its corpus is the local plaintext rumor
  // store, and NIP-29 has no equivalent — its messages live in the EventStore
  // and are never mirrored to disk. Nothing here is generalized on spec.
  const searchFilters = useMemo(
    () => ({
      query,
      channelIds:
        searchThisChannel && openChannelIdHex ? [openChannelIdHex] : [],
    }),
    [query, searchThisChannel, openChannelIdHex],
  );
  const {
    hits,
    searching,
    waiting: searchWaiting,
    active: searchActive,
  } = useConcordSearch(community, state?.folded, channels, searchFilters);

  // Say which channel is ON SCREEN, so the notifier does not alert about the
  // messages the reader is watching arrive. Refcounted in the registry, because
  // a second Concord window showing the same channel must not be un-silenced by
  // the first one closing.
  //
  // "Selected" is not "on screen": the search results and the guestbook take
  // the whole pane, and a channel registered from behind one of them silences
  // alerts and badges for messages nobody can see. Both panes therefore hand
  // the channel back for as long as they are up.
  const channelOnScreen =
    searchActive || showGuestbook ? undefined : openChannelIdHex;
  useEffect(() => {
    if (!channelOnScreen) return;
    registerActiveChannel(channelOnScreen);
    return () => unregisterActiveChannel(channelOnScreen);
  }, [channelOnScreen]);

  const handleOpenHit = useCallback(
    (hit: ConcordSearchHit) => {
      // Leave BOTH panes on the way in: the results and the guestbook each take
      // the space the channel would occupy, so a jump has nowhere to land until
      // the timeline is the thing on screen. Searching from the guestbook is an
      // ordinary way to arrive here, and leaving that flag set put the reader
      // back in the guestbook with a jump pending against a viewer that never
      // mounted.
      setQuery("");
      setShowGuestbook(false);
      setSelectedChannel(hit.channelIdHex);
      // A result is a deliberate pick of the channel it was found in, so it is
      // remembered exactly like a click on the row would be. Leaving it out
      // would have a search land somewhere the next reload does not.
      rememberNavigation(communityIdHex, hit.channelIdHex);
      setJumpTo({ messageId: hit.message.rumorId, nonce: Date.now() });
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, communityIdHex, rememberNavigation],
  );

  /**
   * Forget a jump once the timeline has answered it.
   *
   * The request has to be dropped from HERE rather than remembered inside
   * ChatViewer, because opening search unmounts ChatViewer: a request it only
   * remembered in a ref would be honoured a second time by the fresh instance,
   * and the reader who typed a new query and pressed Escape would be scrolled
   * away from where they were. Guarded by the nonce so a jump that was already
   * superseded by a newer click cannot clear the newer one.
   */
  const handleJumpHandled = useCallback((nonce: number) => {
    setJumpTo((prev) => (prev?.nonce === nonce ? undefined : prev));
  }, []);

  const identifier: ConcordIdentifier | undefined = useMemo(
    () =>
      communityIdHex && openChannelIdHex
        ? {
            type: "concord",
            communityId: communityIdHex,
            channelId: openChannelIdHex,
          }
        : undefined,
    [communityIdHex, openChannelIdHex],
  );

  if (status === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <span>Loading your communities…</span>
      </div>
    );
  }

  if (status === "no-decryptor") {
    return (
      <Empty>
        Sign in with a signer that supports NIP-44 to read your Concord
        communities — the list is encrypted to yourself.
      </Empty>
    );
  }

  if (status === "decrypt-failed") {
    return (
      <Empty>
        Your community list would not decrypt, so nothing has been changed
        locally. Check that the signer holding your key is reachable.
      </Empty>
    );
  }

  if (communities.length === 0) {
    return <NoCommunitiesEmpty onRefresh={refreshList} />;
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* The heading IS the search box. The community name was redundant with
          the row that names it in the picker below and with the window title,
          and search is the thing worth reaching for at the top of a sidebar. */}
      <div className="flex h-8 items-center gap-1 border-b px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded border px-1.5 py-0.5">
          <Search className="size-3 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search messages"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        {stranded && (
          <span
            className="mr-auto ml-2 shrink-0 rounded border border-dotted px-1 text-[10px] text-muted-foreground"
            title="The invite link you joined with was out of date: this community has rotated its keys past the epoch you hold, and the rotation happened before you joined, so it carries nothing for you. Ask a member for a fresh link or a direct invite."
          >
            stale invite
          </span>
        )}
        {dissolvedAtMs !== undefined && (
          <span
            className="mr-auto ml-2 shrink-0 rounded border border-dotted px-1 text-[10px] text-muted-foreground"
            title="This community was dissolved by its owner. History stays readable; nothing new is accepted."
          >
            dissolved
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="Refresh channels"
          onClick={() => {
            refreshList();
            refresh();
          }}
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
        </Button>
      </div>
      {/* The scope control moved to the results heading — it describes what
          was searched, so it belongs beside the count, not under the box where
          it pushed the channel list down on every keystroke. */}
      <CommunityPicker
        communities={communities.map((c) => ({
          idHex: c.idHex,
          name: c.name,
          ...(icons.get(c.idHex) ? { icon: icons.get(c.idHex) } : {}),
          ...(totals.get(c.idHex) ? { unread: totals.get(c.idHex) } : {}),
        }))}
        selected={community?.idHex}
        onSelect={(idHex) => {
          setSelectedId(idHex);
          // Come back to where you left this community, not to its first
          // channel. Undefined is fine — the derived fallback covers it.
          const remembered = lastChannel(idHex);
          setSelectedChannel(remembered);
          rememberNavigation(idHex, remembered);
          setShowGuestbook(false);
          setJumpTo(undefined);
        }}
      >
        <>
          <ChannelList
            channels={channels}
            communityId={community?.idHex}
            selected={showGuestbook ? undefined : openChannel?.idHex}
            loading={loading}
            error={error}
            unread={unread}
            onSelect={handleChannelSelect}
          />
          {/* The guestbook entry is hidden for now: it sat between the channels
              and nothing else, reading as a channel that is not one. The panel
              and its state stay wired, so restoring the entry is one element. */}
        </>
      </CommunityPicker>
    </div>
  );

  // One control, two meanings: on mobile it opens the sheet, on desktop it
  // collapses and restores the column. Desktop kept the channels pinned open
  // with no way to reclaim the width, which a narrow tile cannot afford.
  const headerPrefix = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      title={
        isMobile
          ? "Show channels"
          : desktopSidebarOpen
            ? "Hide channels"
            : "Show channels"
      }
      onClick={() =>
        isMobile ? setSidebarOpen(true) : setDesktopSidebarOpen((v) => !v)
      }
    >
      <PanelLeft className="size-4" />
      <span className="sr-only">Toggle channels</span>
    </Button>
  );

  return (
    <div className="flex h-full">
      {isMobile ? (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          {/* `pt-10` clears the sheet's own close button, which otherwise sits
              on top of the search box in the sidebar heading. Same reason
              GroupListViewer pads its sheet. */}
          <SheetContent side="left" className="w-72 p-0 pt-10">
            <VisuallyHidden.Root>
              <SheetTitle>Channels</SheetTitle>
            </VisuallyHidden.Root>
            {sidebar}
          </SheetContent>
        </Sheet>
      ) : (
        desktopSidebarOpen && (
          <div className="w-64 flex-shrink-0 border-r">{sidebar}</div>
        )
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Above the pane, not instead of it: a stranded member can still read
            everything written before the rotation. */}
        {stranded && <StrandedBanner />}
        <div className="min-h-0 flex-1">
          {searchActive ? (
            <ConcordSearchPanel
              hits={hits}
              searching={searching}
              waiting={searchWaiting}
              query={query.trim()}
              onOpen={handleOpenHit}
              thisChannelOnly={searchThisChannel}
              {...(openChannel
                ? {
                    scopeChannelName: openChannel.name,
                    onToggleScope: () => setSearchThisChannel((v) => !v),
                  }
                : {})}
            />
          ) : showGuestbook ? (
            <ConcordGuestbookPanel
              feed={guestbook}
              loading={guestbookLoading}
            />
          ) : identifier ? (
            <ChatViewer
              protocol="concord"
              identifier={identifier as ProtocolIdentifier}
              headerPrefix={headerPrefix}
              onJumpHandled={handleJumpHandled}
              {...(jumpTo ? { jumpTo } : {})}
            />
          ) : (
            <Empty>
              {loading
                ? "Loading channels…"
                : "No channels here can be opened with the keys you hold."}
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <p className="max-w-sm">{children}</p>
    </div>
  );
}

/** One community's row: its icon (encrypted, CORD-02 §6) and its name. */
function CommunityRow({
  community,
  selected,
  onSelect,
}: {
  community: {
    idHex: string;
    name: string;
    icon?: ImagePointer;
    unread?: CommunityUnread;
  };
  selected: boolean;
  onSelect: (idHex: string) => void;
}) {
  const icon = useConcordImage(community.icon);
  const label = community.name || community.idHex.slice(0, 8);
  const hasUnread = (community.unread?.count ?? 0) > 0;
  return (
    <NotifLevelMenu>
      <button
        type="button"
        onClick={() => onSelect(community.idHex)}
        className={cn(
          "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-muted/50",
          selected && "bg-muted/70 font-medium",
          hasUnread && "font-semibold text-foreground",
        )}
      >
        {icon ? (
          <img
            src={icon}
            alt=""
            className="size-4 shrink-0 rounded-sm object-cover"
          />
        ) : (
          // A placeholder of the SAME size, so a community whose icon is absent,
          // unfetchable or failed verification does not shift its neighbours.
          <span
            aria-hidden
            className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-dotted text-[8px] text-muted-foreground"
          >
            {label.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="truncate">{label}</span>
        {community.unread && <UnreadBadge unread={community.unread} />}
      </button>
    </NotifLevelMenu>
  );
}

/**
 * The community list, with the selected community's channels nested directly
 * beneath its own row.
 *
 * Rendering the channels in a separate block below the whole list left nothing
 * saying which community they belonged to — the reader had to remember what
 * they had clicked. Nesting states it.
 */
function CommunityPicker({
  communities,
  selected,
  onSelect,
  children,
}: {
  communities: Array<{
    idHex: string;
    name: string;
    icon?: ImagePointer;
    unread?: CommunityUnread;
  }>;
  selected: string | undefined;
  onSelect: (idHex: string) => void;
  children: ReactNode;
}) {
  // With one community there is nothing to pick between, so the row would be
  // chrome; the channels stand alone under the header that already names it.
  // One community needs no picker, but it still needs the scroller the picker
  // would have been — the channel list itself is content-sized.
  if (communities.length <= 1)
    return <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {communities.map((c) => (
        // `shrink-0`, NOT `min-h-0`: inside a SCROLLING column, `min-h-0` lets
        // a row shrink below its own content, so the selected community's
        // channels spilled out of their box and the next community's row was
        // painted over the last of them. Rows in a scroller must be sized by
        // their content and let the scroller do the rest.
        <div key={c.idHex} className="flex shrink-0 flex-col">
          <CommunityRow
            community={c}
            selected={c.idHex === selected}
            onSelect={onSelect}
          />
          {c.idHex === selected && <div className="pl-2">{children}</div>}
        </div>
      ))}
    </div>
  );
}
