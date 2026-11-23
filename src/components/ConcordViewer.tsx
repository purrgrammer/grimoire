import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCheck,
  Globe,
  Loader2,
  Lock,
  Mail,
  PanelLeft,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";

import { ChatViewer } from "./ChatViewer";
import {
  ChannelList,
  NotifLevelMenu,
  UnreadBadge,
} from "./concord/ConcordChannelList";
import { NoCommunitiesEmpty, StrandedBanner } from "./concord/ArmadaHandoff";
import { ConcordPinsList, PinsHeaderButton } from "@/components/ConcordPinsBar";
import { ChannelRepoBadge } from "@/components/concord/ChannelRepoBadge";
import { CallHeaderButton } from "@/components/call/CallHeaderButton";
import {
  ConcordInvitesPanel,
  InvitesRow,
} from "@/components/ConcordInvitesPanel";
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
import type {
  CommunityReadTarget,
  CommunityUnread,
} from "@/services/concord-reads";
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
import {
  buildBrowserGroupUpdate,
  buildConcordDmUpdate,
  buildConcordWindowUpdate,
} from "@/lib/concord/window-props";
import { Nip29GroupList } from "./nip29/Nip29GroupList";
import { groupKey, type GroupSelection } from "@/lib/nip29/group-selection";
import { groupRowRef } from "@/lib/nip29/row-ref";
import { markAllGroupsRead, markGroupRead } from "@/services/nip29-reads";
import { useNip29Groups } from "@/hooks/useNip29Groups";
import {
  useGroupCallCounts,
  useGroupParticipants,
} from "@/hooks/useNip29Participants";
import { useGroupMetadata } from "@/hooks/useGroupMetadata";
import { useConcordInvites } from "@/hooks/useConcordInvites";
import { useConcordPins } from "@/hooks/useConcordPins";
import {
  useChannelVoice,
  useCommunityVoiceCounts,
} from "@/hooks/useConcordVoice";
import { DirectMessageList } from "./dm/DirectMessageList";
import { dmRowRef } from "@/lib/dm/row-ref";
import { markDmRead } from "@/services/dm-reads";
import {
  markAllCommunitiesRead,
  markChannelRead,
  markCommunityRead,
} from "@/services/concord-reads";
import { readStoredState } from "@/services/concord-state";
import { NewConversationDialog } from "./dm/NewConversationDialog";
import { DmConsentGate } from "./dm/DmConsentGate";
import { useDirectMessages } from "@/hooks/useDirectMessages";
import type { DMIdentifier } from "@/types/chat";
import { useConcordPrefs } from "@/hooks/useConcordPrefs";
import {
  windowCursor,
  setWindowCursor,
} from "@/components/concord/window-cursor";
import { useAccount } from "@/hooks/useAccount";
import { dmConversationIdFor } from "@/lib/dm/conversation-id";
import { useAtomValue } from "jotai";
import { useAddWindow } from "@/core/state";
import { banVerdictPostdatesMembership } from "@/lib/concord/call-sync";
import { callStateAtom, isGroupCall } from "@/services/call-state";
import { readJoinedAtMs } from "@/services/concord-communities";
import { inviteStanding } from "@/lib/concord/invite";
import { bytesToHex } from "@/lib/concord/derive";
import { joinFromInvite } from "@/services/concord-join";
import { openInviteLink } from "@/services/concord-invites";
import type { PendingInvite } from "@/services/concord-invites";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import type { ConcordIdentifier, ProtocolIdentifier } from "@/types/chat";

/** A stable empty list, so a community-less render keeps constant hook inputs. */
const EMPTY_RELAYS: string[] = [];

interface ConcordViewerProps {
  /** community_id (lowercase hex), or a prefix of one. */
  communityId?: string;
  /** Channel to open on mount, if the caller already knows one. */
  channelId?: string;
  /**
   * A private conversation to open instead of a channel: one peer pubkey for a
   * 1:1, or the conversation id — the participants, colon-joined — for a group.
   */
  dmPeer?: string;
  /** A NIP-29 group to open instead. Both halves: an id alone names no room. */
  groupId?: string;
  groupRelay?: string;
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
  dmPeer,
  groupId,
  groupRelay,
  windowId,
}: ConcordViewerProps) {
  const isMobile = useIsMobile();
  const { state: grimoire, updateWindow } = useGrimoire();
  const { isRowMuted } = useConcordPrefs();
  const { communities, status, refresh: refreshList } = useConcordCommunities();
  const icons = useConcordIcons(communities);
  const [selectedId, setSelectedId] = useState<string | undefined>(communityId);
  const [selectedChannel, setSelectedChannel] = useState<string | undefined>(
    channelId,
  );
  /**
   * The open private conversation, by peer pubkey.
   *
   * One selection with two families: a DM and a channel cannot both be open,
   * so each setter clears the other. Keeping them independent would leave the
   * sidebar highlighting a channel while the pane showed a conversation.
   */
  const [selectedDm, setSelectedDm] = useState<string | undefined>(dmPeer);
  /**
   * Whether the Direct messages row is the one expanded.
   *
   * Not derived from `selectedDm`: opening the row to look at the list is a
   * different act from having a conversation open, and a reader who clicks
   * back into a channel should find the list where they left it.
   */
  const [dmSectionOpen, setDmSectionOpen] = useState(dmPeer !== undefined);
  /**
   * The open NIP-29 group, by id AND relay.
   *
   * The third family of the one selection: a group, a channel and a private
   * conversation are mutually exclusive, so each setter clears the other two.
   */
  const [selectedGroup, setSelectedGroup] = useState<
    GroupSelection | undefined
  >(groupId && groupRelay ? { groupId, relayUrl: groupRelay } : undefined);
  const [groupSectionOpen, setGroupSectionOpen] = useState(
    groupId !== undefined,
  );
  const [composing, setComposing] = useState(false);
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
   * Where THIS window was last left in this community — see
   * `concord/window-cursor.ts` for why the memory is not device-wide. It can be
   * read live now: nothing else writes this window's entry, so a sibling window
   * cannot steer this one.
   */
  const remembered = windowCursor(windowId, communityIdHex);

  // The OPEN channel is derived, not stored: falling back keeps the pane filled
  // the moment the fold lands, with no effect writing state during a render
  // pass. An explicit pick wins whenever it still resolves; failing that, the
  // channel this window was last left on in this community.
  const openChannel = resolveOpenChannel(channels, selectedChannel, remembered);

  /**
   * Public or private, as the protocol defines it (CORD-05 §5): the aggregate
   * of every creator's invite Registry. A live link means anyone holding it can
   * join; an empty set means membership only moves by direct handoff.
   *
   * Absent until the fold lands — an unread community is not a private one.
   */
  const openness = state?.folded
    ? state.folded.inviteLinks.size > 0
      ? "public"
      : "private"
    : undefined;
  const linkCount = state?.folded
    ? [...state.folded.inviteLinks.values()].reduce(
        (n, links) => n + links.length,
        0,
      )
    : 0;
  const opennessDetail =
    linkCount === 1 ? "one live link" : `${linkCount} live links`;

  // The open channel's pins, verified here rather than trusted: §7's proof
  // bundle is what lets a member with none of the history read them.
  const { pins, unavailable: pinsUnavailable } = useConcordPins(
    state?.folded,
    openChannel,
  );
  const [showPins, setShowPins] = useState(false);

  // Who is in a call, per channel and for the open one (CORD-07 §4). Watching
  // every channel rather than just the open one costs one REQ per relay in
  // total — and a call nobody can see is a call nobody joins.
  const voiceRelays = community?.relays ?? EMPTY_RELAYS;
  const inCall = useCommunityVoiceCounts(voiceRelays, channels);
  const openCall = useChannelVoice(voiceRelays, openChannel);
  const call = useAtomValue(callStateAtom);
  const addWindow = useAddWindow();

  /**
   * The call opens in its own window, tiled beside the chat rather than folded
   * into it — a call needs room for faces and controls, and a chat pane that
   * grew one would take it from the conversation.
   */
  const openCallWindow = useCallback(() => {
    if (!community || !openChannel) return;
    // No `commandString`: it would be stored verbatim and win over
    // `reconstructCommand`, so editing the window would rewrite its props from
    // a bare `call` that names no channel.
    addWindow("call", {
      communityId: community.idHex,
      channelId: openChannel.idHex,
    });
  }, [addWindow, community, openChannel]);

  /**
   * Open the selected group's AV space in its own window.
   *
   * No `commandString`, for the reason the Concord one gives: it would be
   * stored verbatim and win over `reconstructCommand`, so editing the window
   * would rewrite its props from a bare `call` that names no room.
   */
  // Whether the OPEN group has a space, and who is in it. The metadata read is
  // the same subscription the group's own row already holds, so this costs
  // nothing beyond the tag check.
  const openGroupMetadata = useGroupMetadata(
    selectedGroup?.groupId ?? "",
    selectedGroup?.relayUrl ?? "",
  );
  const groupHasSpace = Boolean(selectedGroup && openGroupMetadata?.av);
  const groupCallCount = useGroupParticipants(
    selectedGroup?.relayUrl,
    selectedGroup?.groupId,
  ).length;

  const openGroupCallWindow = useCallback(() => {
    if (!selectedGroup) return;
    addWindow("call", {
      protocol: "nip-29",
      relayUrl: selectedGroup.relayUrl,
      groupId: selectedGroup.groupId,
    });
  }, [addWindow, selectedGroup]);

  /**
   * Clicking a pin lands on the message itself — the same walk a search hit
   * takes, since a pin names a rumor id and nothing else about where it sits.
   */
  const handleOpenPin = useCallback((rumorId: string) => {
    setJumpTo({ messageId: rumorId, nonce: Date.now() });
    setShowPins(false);
  }, []);

  // The invite inbox: pulled once per session (and on demand), never pushed —
  // an invite is a giftwrap sitting on a relay, and nothing about it is urgent.
  const { account } = useAccount();

  /**
   * When this member joined, which is what makes a ban verdict a verdict: a
   * compaction re-wraps banlist editions verbatim, so a sentence older than a
   * re-admission is stale rather than current. Undefined means "we do not
   * know", and the check then declines to act at all.
   */
  const [joinedAtMs, setJoinedAtMs] = useState<number>();
  useEffect(() => {
    if (!account?.pubkey || !communityIdHex) {
      setJoinedAtMs(undefined);
      return;
    }
    let cancelled = false;
    void readJoinedAtMs(account.pubkey, communityIdHex).then((ms) => {
      if (!cancelled) setJoinedAtMs(ms);
    });
    return () => {
      cancelled = true;
    };
  }, [account?.pubkey, communityIdHex]);

  /**
   * CORD-07 §7, live: a call is a join-time snapshot, so while one runs the
   * viewer — which is what actually holds fresh vault and fold state — hands it
   * to the service to decide stay, rejoin the rotated room, or hang up.
   */
  useEffect(() => {
    if (call.status !== "connected") return;
    if (call.communityIdHex !== communityIdHex) return;
    // Lazily, so opening a community does not pull `livekit-client` in for a
    // reader who never makes a call — the import only resolves while one is
    // actually connected, by which point the chunk is already loaded.
    // eslint-disable-next-line grimoire/no-inline-dynamic-import -- keeps livekit-client out of the community window
    void import("@/services/concord-call").then((service) =>
      service.syncCall({
        listLoaded: !loading,
        community,
        folded: state?.folded,
        channels,
        selfBanned: banVerdictPostdatesMembership(
          state?.folded,
          account?.pubkey,
          joinedAtMs,
        ),
      }),
    );
  }, [
    call.status,
    call.communityIdHex,
    communityIdHex,
    community,
    state?.folded,
    channels,
    loading,
    account?.pubkey,
    joinedAtMs,
  ]);
  const [showInvites, setShowInvites] = useState(false);
  // Only while the panel is open. Reading the inbox costs two signer
  // round-trips per wrap, and a stranger can put wraps there — so it must not
  // be something every Concord window does on mount.
  const {
    invites,
    loading: invitesLoading,
    error: invitesError,
    refresh: refreshInvites,
  } = useConcordInvites(showInvites);
  const [joining, setJoining] = useState<string>();
  const [joinError, setJoinError] = useState<string>();
  /** Invites opened from a pasted link — they arrive by no other route. */
  const [linkInvites, setLinkInvites] = useState<PendingInvite[]>([]);

  /**
   * Open or close the invites pane, and say so in the window's props — the
   * title is derived from those, and a reload should come back where it was.
   */
  /** Leave the invites pane — navigation does this implicitly. */
  const closeInvites = useCallback(() => {
    setShowInvites(false);
    if (!windowId) return;
    const existing = grimoire.windows[windowId]?.props;
    if (!existing || existing.view === undefined) return;
    const { view: _was, ...rest } = existing;
    updateWindow(windowId, { props: rest });
  }, [grimoire.windows, updateWindow, windowId]);

  const toggleInvites = useCallback(() => {
    // One thing open at a time: the invites pane takes the whole pane, so a
    // conversation left selected underneath would come back on the next
    // render with the sidebar highlighting neither.
    setSelectedDm(undefined);
    setDmSectionOpen(false);
    setSelectedGroup(undefined);
    setGroupSectionOpen(false);
    setShowInvites((open) => {
      const next = !open;
      if (windowId) {
        const existing = grimoire.windows[windowId]?.props;
        if (existing) {
          const { view: _was, ...rest } = existing;
          updateWindow(windowId, {
            props: { ...rest, ...(next ? { view: "invites" } : {}) },
          });
        }
      }
      return next;
    });
  }, [grimoire.windows, updateWindow, windowId]);

  const handleOpenLink = useCallback(
    async (url: string) => {
      const invite = await openInviteLink(url, account?.pubkey);
      setLinkInvites((prev) => [
        invite,
        ...prev.filter((p) => p.id !== invite.id),
      ]);
    },
    [account?.pubkey],
  );

  /**
   * A link-opened invite and a giftwrapped one are the same thing once open;
   * the link's own copy wins, being the fresher fetch.
   *
   * Standing is resolved HERE, against the live vault, rather than trusting the
   * snapshot each invite was fetched with: joining does not re-fetch the inbox,
   * and an invite for a community you are now in must stop presenting itself as
   * something waiting the moment you are in it.
   */
  const allInvites = useMemo(() => {
    const seen = new Set(linkInvites.map((i) => i.bundle.community_id));
    const held = new Map(communities.map((c) => [c.idHex, c]));
    return [
      ...linkInvites,
      ...invites.filter((i) => !seen.has(i.bundle.community_id)),
    ].map((invite) => {
      const standing = inviteStanding(
        invite.bundle,
        held.get(invite.bundle.community_id.toLowerCase()),
        bytesToHex,
      );
      return { ...invite, standing, alreadyJoined: standing !== "new" };
    });
  }, [linkInvites, invites, communities]);

  /** Only what is worth acting on gets counted — a held invite is not news. */
  const pendingInviteCount = useMemo(
    () => allInvites.filter((i) => i.standing !== "held" && !i.expired).length,
    [allInvites],
  );

  /**
   * Accept: keep the keys, save the membership, announce it. The vault re-read
   * is what makes the community appear — the join wrote it, this reads it back.
   */
  const handleJoin = useCallback(
    async (invite: PendingInvite) => {
      if (!account?.pubkey || !account.signer) return;
      setJoining(invite.id);
      setJoinError(undefined);
      try {
        const outcome = await joinFromInvite(
          invite.bundle,
          account.pubkey,
          account.signer,
        );
        refreshList();
        refreshInvites();
        setSelectedId(outcome.communityId);
        setShowInvites(false);
        if (outcome.guestbook === "failed") {
          // The membership is real regardless: the Guestbook is off-consensus,
          // and a missing Join costs a row in the members list, never access.
          setJoinError(
            `You are in, but your arrival was not announced: ${outcome.guestbookError ?? "the guestbook publish failed"}`,
          );
        }
      } catch (err) {
        setJoinError(err instanceof Error ? err.message : String(err));
      } finally {
        setJoining(undefined);
      }
    },
    [account, refreshList, refreshInvites],
  );

  /**
   * Record a deliberate move: in this window's cursor, and in its own props.
   *
   * Only ever called from a click. A fallback resolution must not write here —
   * it would record the first channel of a community whose fold had not landed
   * yet as the one the reader chose.
   */
  const rememberNavigation = useCallback(
    (idHex: string | undefined, channelIdHex?: string) => {
      if (!idHex) return;
      if (channelIdHex) setWindowCursor(windowId, idHex, channelIdHex);
      if (!windowId) return;
      const existing = grimoire.windows[windowId]?.props;
      if (!existing) return;
      updateWindow(
        windowId,
        buildConcordWindowUpdate(existing, idHex, channelIdHex),
      );
    },
    [grimoire.windows, updateWindow, windowId],
  );

  const handleChannelSelect = useCallback(
    (idHex: string) => {
      setSelectedDm(undefined);
      setDmSectionOpen(false);
      setSelectedGroup(undefined);
      setGroupSectionOpen(false);
      setSelectedChannel(idHex);
      rememberNavigation(communityIdHex, idHex);
      setShowGuestbook(false);
      setShowPins(false);
      closeInvites();
      // Abandon any pending jump. It is only ever pending because the channel
      // it named would not resolve, and picking a channel by hand says the
      // reader has moved on — without this, the next channel that DOES resolve
      // inherits the jump and walks its history looking for a message that was
      // never in it.
      setJumpTo(undefined);
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, communityIdHex, rememberNavigation, closeInvites],
  );

  const dms = useDirectMessages();

  /**
   * One number for the row, the way a community row totals its channels.
   *
   * MESSAGES, not conversations: a row saying 2 when four messages are waiting
   * in two conversations is counting the wrong noun, and the channel badge
   * beside it counts messages.
   *
   * A muted conversation adds nothing. A count on the heading that a muted row
   * underneath refuses to explain is worse than no count at all.
   */
  const dmUnreadCount = dms.conversations.reduce(
    (total, c) =>
      isRowMuted(dmRowRef(c.conversationId)) ? total : total + c.unreadCount,
    0,
  );

  const openDirectMessages = useCallback(() => {
    setDmSectionOpen((open) => !open);
  }, []);

  /**
   * Open a conversation, by peer for a 1:1 or by conversation id for a group.
   *
   * One argument for both because the adapter normalises either into the same
   * id — a group's id IS its participants, so there is nothing else to pass.
   */
  const handleDmSelect = useCallback(
    (peer: string) => {
      setSelectedDm(peer);
      setSelectedGroup(undefined);
      setShowGuestbook(false);
      // The invites pane takes the whole pane too, so opening a conversation
      // has to leave it — the same rule in the other direction.
      setShowInvites(false);
      setQuery("");
      setJumpTo(undefined);
      if (windowId) {
        const existing = grimoire.windows[windowId]?.props;
        if (existing)
          updateWindow(windowId, buildConcordDmUpdate(existing, peer));
      }
      if (isMobile) setSidebarOpen(false);
    },
    [grimoire.windows, isMobile, updateWindow, windowId],
  );

  /**
   * Always, not only while the section is open — and the cost is stated rather
   * than hidden: one standing REQ per group relay for as long as this window
   * lives.
   *
   * It used to be gated on the section being expanded, which was right while the
   * heading carried no count. It carries one now, and a collapsed section that
   * could not tell you something was waiting would be most of an unread badge
   * missing.
   */
  const {
    groups: nip29Groups,
    loading: nip29Loading,
    unread: nip29Unread,
  } = useNip29Groups();

  /**
   * Who is in each group's AV space.
   *
   * Every group is watched, not only the ones whose `kind:39000` advertises a
   * `livekit` tag: the whole set costs one filter per relay either way, and
   * gating on metadata would mean a room stays invisible until its group's
   * metadata happens to have resolved. A group with no room simply never has a
   * `kind:39004` to report.
   */
  const nip29InCall = useGroupCallCounts(nip29Groups);

  const viewerPubkey = account?.pubkey;

  /**
   * Clear one community's channels, whether or not it is the open one.
   *
   * The fold is re-read here rather than taken from `state`, because a row for
   * a community the reader is NOT in has no loaded fold — and that is the case
   * this exists for: the open one you can simply read.
   */
  const markCommunityAllRead = useCallback(
    async (idHex: string) => {
      const target = communities.find((c) => c.idHex === idHex);
      if (!viewerPubkey || !target) return;
      const stored = await readStoredState(target).catch(() => undefined);
      if (!stored) return;
      await markCommunityRead(
        viewerPubkey,
        idHex,
        stored.channels.map((ch) => ch.idHex.toLowerCase()),
        stored.folded.banned,
      );
    },
    [viewerPubkey, communities],
  );

  /**
   * Every community's count added up — what the heading's clear-all speaks
   * for. The per-community numbers already sit on the rows themselves, so the
   * heading carries the control and no count of its own.
   */
  const concordUnreadCount = useMemo(() => {
    let total = 0;
    for (const unread of totals.values()) total += unread.count;
    return total;
  }, [totals]);

  /**
   * Clear EVERY community at once — the heading's twin of the row menu's
   * "Mark as read". The folds are re-read here rather than taken from
   * `state`, the rule `markCommunityAllRead` already follows: only the OPEN
   * community has one loaded, and this walks all of them.
   */
  const markAllCommunitiesAsRead = useCallback(async () => {
    if (!viewerPubkey) return;
    const targets: CommunityReadTarget[] = [];
    for (const target of communities) {
      const stored = await readStoredState(target).catch(() => undefined);
      if (!stored) continue;
      targets.push({
        communityId: target.idHex,
        channelIdsHex: stored.channels.map((ch) => ch.idHex.toLowerCase()),
        bannedAuthors: stored.folded.banned,
      });
    }
    await markAllCommunitiesRead(viewerPubkey, targets);
  }, [viewerPubkey, communities]);

  const markChannelAllRead = useCallback(
    (channelIdHex: string, atSecs: number) => {
      if (!viewerPubkey || !communityIdHex) return;
      void markChannelRead(viewerPubkey, communityIdHex, channelIdHex, atSecs);
    },
    [viewerPubkey, communityIdHex],
  );

  /**
   * The groups the heading speaks for: something waiting, not muted, and with a
   * message that can actually be stamped.
   *
   * One pass rather than two, because the number in the heading and the list the
   * clear-all button walks have to agree by construction. A count that included a
   * group the button skipped would leave a badge that the control claiming to
   * clear everything could not.
   *
   * `latest` is 0 while every counted message is still ahead of the clock, so
   * such a group badges but is not stampable yet — it is counted and left out of
   * the walk, which is the honest pairing.
   */
  const groupsWaiting = useMemo(() => {
    let total = 0;
    const stampable: Array<{
      relayUrl: string;
      groupId: string;
      latest: number;
    }> = [];
    for (const [key, summary] of nip29Unread) {
      const group = nip29Groups.find((g) => groupKey(g) === key);
      if (!group || isRowMuted(groupRowRef(group))) continue;
      total += summary.count;
      if (summary.latest > 0)
        stampable.push({
          relayUrl: group.relayUrl,
          groupId: group.groupId,
          latest: summary.latest,
        });
    }
    return { total, stampable };
  }, [nip29Unread, nip29Groups, isRowMuted]);
  const groupUnreadCount = groupsWaiting.total;

  /** Clear every group at once, each at its own newest counted message. */
  const markAllGroupsAsRead = useCallback(() => {
    if (!viewerPubkey || groupsWaiting.stampable.length === 0) return;
    void markAllGroupsRead(viewerPubkey, groupsWaiting.stampable);
  }, [viewerPubkey, groupsWaiting]);

  /** Stamp a group read without opening it, at its newest counted message. */
  const markGroupAllRead = useCallback(
    (selection: GroupSelection, latest: number) => {
      if (!viewerPubkey || latest <= 0) return;
      void markGroupRead(
        viewerPubkey,
        selection.relayUrl,
        selection.groupId,
        latest,
      );
    },
    [viewerPubkey],
  );

  const handleGroupSelect = useCallback(
    (selection: GroupSelection) => {
      setSelectedGroup(selection);
      setSelectedDm(undefined);
      setShowGuestbook(false);
      setShowInvites(false);
      setQuery("");
      setJumpTo(undefined);
      if (windowId) {
        const existing = grimoire.windows[windowId]?.props;
        if (existing)
          updateWindow(
            windowId,
            buildBrowserGroupUpdate(
              existing,
              selection.groupId,
              selection.relayUrl,
            ),
          );
      }
      if (isMobile) setSidebarOpen(false);
    },
    [grimoire.windows, isMobile, updateWindow, windowId],
  );

  /**
   * Memoized BY VALUE, on both halves.
   *
   * `ChatViewer` keys its conversation resolution on this object, so a fresh
   * one every render makes it re-resolve and blank the timeline — the same trap
   * the DM identifier below carries a note about.
   */
  const groupIdentifier: ProtocolIdentifier | undefined = useMemo(
    () =>
      selectedGroup
        ? ({
            type: "group",
            value: selectedGroup.groupId,
            relays: [selectedGroup.relayUrl],
          } as ProtocolIdentifier)
        : undefined,
    [selectedGroup],
  );

  /**
   * The open conversation as the sidebar names it: the whole participant set.
   *
   * `selectedDm` can be either form — a window reopened from `dmPeer` carries
   * one pubkey, a row click carries the id — and only the canonical id matches
   * a row, so a group conversation would otherwise highlight nothing.
   */
  const selectedDmId =
    viewerPubkey && selectedDm
      ? dmConversationIdFor(viewerPubkey, selectedDm)
      : undefined;

  const dmIdentifier: DMIdentifier | undefined = useMemo(
    () =>
      selectedDm ? { type: "chat-partner", value: selectedDm } : undefined,
    // Memoized BY VALUE: ChatViewer keys its conversation resolution on this
    // object, and a fresh one per render makes it re-resolve and blank.
    [selectedDm],
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
  // "Selected" is not "on screen": the search results, the guestbook, the
  // invites pane and the other two conversation families each take the whole
  // pane, and a channel registered from behind one of them silences alerts and
  // badges for messages nobody can see. All of them therefore hand the channel
  // back for as long as they are up.
  const channelOnScreen =
    searchActive || showGuestbook || showInvites || selectedDm || selectedGroup
      ? undefined
      : openChannelIdHex;
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
      setShowPins(false);
      closeInvites();
      // And the other two families. Search reaches the whole community from
      // wherever the reader was, so a hit can be clicked with a private
      // conversation or a group still selected — and those branches render
      // BEFORE the channel, so the jump would land in a timeline nobody could
      // see while the pane showed the conversation it was clicked from.
      setSelectedDm(undefined);
      setSelectedGroup(undefined);
      setSelectedChannel(hit.channelIdHex);
      // A result is a deliberate pick of the channel it was found in, so it is
      // remembered exactly like a click on the row would be. Leaving it out
      // would have a search land somewhere the next reload does not.
      rememberNavigation(communityIdHex, hit.channelIdHex);
      setJumpTo({ messageId: hit.message.rumorId, nonce: Date.now() });
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile, communityIdHex, rememberNavigation, closeInvites],
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

  /**
   * What the communities half of the sidebar has to say — INSIDE the sidebar,
   * not instead of the whole pane.
   *
   * Each of these used to be an early return, which meant an account with
   * private messages and no Concord communities saw no sidebar at all and had
   * no way to reach its own mail. A community list that is loading, undecryptable
   * or empty is a fact about the communities, not about the window.
   */
  const communitiesSlot: ReactNode =
    status === "loading" ? (
      // Sized like the channel list's own "loading…", not like a headline: this
      // is a wait of a few hundred milliseconds, and a large centred sentence
      // announces it as an event.
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        <span>Loading communities…</span>
      </div>
    ) : status === "no-decryptor" ? (
      <p className="px-2 py-1 text-xs text-muted-foreground">
        Sign in with a signer that supports NIP-44 to read your Concord
        communities — the list is encrypted to yourself.
      </p>
    ) : status === "decrypt-failed" ? (
      <p className="px-2 py-1 text-xs text-muted-foreground">
        Your community list would not decrypt, so nothing has been changed
        locally. Check that the signer holding your key is reachable.
      </p>
    ) : communities.length === 0 ? (
      <NoCommunitiesEmpty onRefresh={refreshList} />
    ) : (
      <CommunityPicker
        communities={communities.map((c) => ({
          idHex: c.idHex,
          name: c.name,
          ...(icons.get(c.idHex) ? { icon: icons.get(c.idHex) } : {}),
          ...(totals.get(c.idHex) ? { unread: totals.get(c.idHex) } : {}),
        }))}
        selected={selectedDm || selectedGroup ? undefined : community?.idHex}
        // The channels stay listed — only the ACTIVE marks go, because while
        // the invites pane, a conversation or a group is open, neither a
        // channel nor a community is what the window is showing.
        highlight={!showInvites && !selectedDm && !selectedGroup}
        openness={openness}
        opennessDetail={opennessDetail}
        onMarkRead={(idHex) => void markCommunityAllRead(idHex)}
        {...(concordUnreadCount > 0
          ? { onMarkAllRead: () => void markAllCommunitiesAsRead() }
          : {})}
        onSelect={(idHex) => {
          setSelectedDm(undefined);
          setDmSectionOpen(false);
          // The group too. Without this the pane kept rendering the group —
          // it branches before the channel — while `rememberNavigation` below
          // wrote a channel into the window props and dropped the group's
          // address from them. The window then reloaded somewhere the reader
          // had never navigated to.
          setSelectedGroup(undefined);
          setGroupSectionOpen(false);
          setSelectedId(idHex);
          // Come back to where you left this community, not to its first
          // channel. Undefined is fine — the derived fallback covers it.
          const remembered = windowCursor(windowId, idHex);
          setSelectedChannel(remembered);
          rememberNavigation(idHex, remembered);
          setShowGuestbook(false);
          setShowInvites(false);
          setJumpTo(undefined);
        }}
      >
        <>
          <ChannelList
            channels={channels}
            communityId={community?.idHex}
            selected={
              showGuestbook || showInvites || selectedDm || selectedGroup
                ? undefined
                : openChannel?.idHex
            }
            loading={loading}
            error={error}
            unread={unread}
            inCall={inCall}
            onSelect={handleChannelSelect}
            onMarkRead={markChannelAllRead}
          />
          {/* The guestbook entry is hidden for now: it sat between the channels
              and nothing else, reading as a channel that is not one. The panel
              and its state stay wired, so restoring the entry is one element. */}
        </>
      </CommunityPicker>
    );

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
        {/* One community means the picker renders no rows, so there is no name
            in the sidebar for the openness badge to sit beside. */}
        {openness && communities.length <= 1 && (
          <OpennessBadge openness={openness} detail={opennessDetail} />
        )}
        {/* Moved into the community row's own right-click menu — "Mark all
            as read" there, reachable from any row, not only from a badge
            standing alone above the search box. */}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Direct messages is a row like a community is a row: click it to
            select it, and its conversations nest underneath the way a
            community's channels do. Above the communities because mail is the
            thing people check first, and because it is the one row every
            account has whether or not it has joined anything. */}
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={openDirectMessages}
            className={cn(
              "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-muted/50",
              dmSectionOpen && "bg-muted/70 font-medium",
              dmUnreadCount > 0 && "font-semibold text-foreground",
            )}
          >
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Direct messages</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {dmUnreadCount > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {dmUnreadCount}
                </span>
              )}
              {/* Only while there is something to clear, so the control
                  appears exactly when it means anything and takes no width the
                  rest of the time. */}
              {dmUnreadCount > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  title="Mark all as read"
                  onClick={(e) => {
                    e.stopPropagation();
                    void dms.markAllRead();
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.stopPropagation();
                    e.preventDefault();
                    void dms.markAllRead();
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <CheckCheck className="size-3" />
                  <span className="sr-only">Mark all as read</span>
                </span>
              )}
              {/* Icon only, and in the heading: the walk finishes on its own
                  and re-runs when the relay set changes, so this is for the
                  cases that mechanism cannot see — a relay that was down, a
                  signer that was refusing. A labelled row in the list would
                  give a rare escape hatch the weight of a conversation. */}
              {dms.status === "ready" && (
                <span
                  role="button"
                  tabIndex={0}
                  title="Check for older messages"
                  onClick={(e) => {
                    e.stopPropagation();
                    void dms.rescan();
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.stopPropagation();
                    e.preventDefault();
                    void dms.rescan();
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <RefreshCw
                    className={cn("size-3", dms.backfill && "animate-spin")}
                  />
                  <span className="sr-only">Check for older messages</span>
                </span>
              )}
            </span>
          </button>
          {dmSectionOpen && (
            <div className="pl-2">
              {dms.status === "ready" ? (
                <DirectMessageList
                  conversations={dms.conversations}
                  onSelect={handleDmSelect}
                  onCompose={() => setComposing(true)}
                  onMarkRead={(conversation) =>
                    void markDmRead(
                      conversation.viewer,
                      conversation.conversationId,
                      conversation.lastAt,
                    )
                  }
                  {...(selectedDmId ? { selected: selectedDmId } : {})}
                  {...(dms.backfill ? { backfill: dms.backfill } : {})}
                />
              ) : (
                <DmConsentGate
                  status={dms.status}
                  onGrant={dms.grantConsent}
                  compact
                />
              )}
            </div>
          )}
        </div>
        {/* Relay groups, the third conversation family. Beneath the private
            ones and above the Concord rows because that is the order of how
            personal they are, and because the two above are the ones every
            account has whether or not it joined anything. */}
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={() => setGroupSectionOpen((open) => !open)}
            className={cn(
              "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-muted/50",
              groupSectionOpen && "bg-muted/70 font-medium",
              groupUnreadCount > 0 && "font-semibold text-foreground",
            )}
          >
            <Users className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Groups</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {/* Messages waiting, never how many groups you are in. The count
                  is what the section total means everywhere else in this
                  column. */}
              {groupUnreadCount > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {groupUnreadCount}
                </span>
              )}
              {/* Only while something can actually be cleared — so the control
                  appears exactly when it means anything and takes no width the
                  rest of the time, as the DM heading's does. Nested in a button,
                  hence the stopPropagation: clearing the section must not also
                  expand it. */}
              {groupsWaiting.stampable.length > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  title="Mark all as read"
                  onClick={(e) => {
                    e.stopPropagation();
                    markAllGroupsAsRead();
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.stopPropagation();
                    e.preventDefault();
                    markAllGroupsAsRead();
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <CheckCheck className="size-3" />
                  <span className="sr-only">Mark all as read</span>
                </span>
              )}
            </span>
          </button>
          {groupSectionOpen && (
            <div className="pl-2">
              <Nip29GroupList
                groups={nip29Groups}
                onSelect={handleGroupSelect}
                selected={selectedGroup}
                loading={nip29Loading}
                unread={nip29Unread}
                inCall={nip29InCall}
                onMarkRead={markGroupAllRead}
              />
            </div>
          )}
        </div>
        {/* Always offered, not only when something is waiting: a link is
            opened from here, and a panel that appears only when you already
            have an invite is one you cannot reach to paste one into. */}
        <InvitesRow
          count={pendingInviteCount}
          active={showInvites}
          onClick={toggleInvites}
        />
        {communitiesSlot}
      </div>
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
      <NewConversationDialog
        open={composing}
        onOpenChange={setComposing}
        {...(account?.pubkey ? { self: account.pubkey } : {})}
        onCreate={(participants) => {
          // The conversation id is the participants sorted and joined, which
          // is exactly what the adapter normalises to — so a group and a 1:1
          // are opened by the same call.
          if (participants.length > 0) handleDmSelect(participants.join(":"));
          setDmSectionOpen(true);
        }}
      />
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
            // FIRST, above every selection. Search only becomes active when
            // something has been typed, which is as deliberate an act as
            // clicking a row — and the search box lives in the sidebar, which
            // is on screen whatever the pane below is showing. Underneath the
            // conversation branches it was a box that did nothing at all while
            // a private conversation or a group was open.
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
          ) : dmIdentifier ? (
            // Before every Concord branch, because a DM is a whole different
            // conversation family and the panes below all belong to the
            // community the reader has stepped away from.
            <ChatViewer
              protocol="nip-17"
              identifier={dmIdentifier as ProtocolIdentifier}
              headerPrefix={headerPrefix}
            />
          ) : groupIdentifier ? (
            // Keyed on the relay too: the same group id on two relays is two
            // rooms, and without the key the second selection would reuse the
            // first one's mounted timeline.
            <ChatViewer
              key={groupKey(selectedGroup!)}
              protocol="nip-29"
              identifier={groupIdentifier}
              headerPrefix={headerPrefix}
              {...(groupHasSpace
                ? {
                    headerExtra: (
                      <CallHeaderButton
                        count={groupCallCount}
                        active={
                          call.status === "connected" &&
                          isGroupCall(
                            call,
                            selectedGroup!.relayUrl,
                            selectedGroup!.groupId,
                          )
                        }
                        onOpen={openGroupCallWindow}
                        emptyTitle="Start this group's space"
                      />
                    ),
                  }
                : {})}
            />
          ) : showInvites ? (
            <ConcordInvitesPanel
              invites={allInvites}
              loading={invitesLoading}
              {...(invitesError ? { error: invitesError } : {})}
              {...(joining ? { joining } : {})}
              {...(joinError ? { joinError } : {})}
              onJoin={(invite) => void handleJoin(invite)}
              onOpenLink={handleOpenLink}
              headerPrefix={headerPrefix}
              onRefresh={refreshInvites}
            />
          ) : showGuestbook ? (
            <ConcordGuestbookPanel
              feed={guestbook}
              loading={guestbookLoading}
            />
          ) : identifier ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1">
                <ChatViewer
                  protocol="concord"
                  identifier={identifier as ProtocolIdentifier}
                  headerPrefix={headerPrefix}
                  headerExtra={
                    <>
                      {/* Only the newest still-attached repository: a channel
                          carries intervals, and a header naming a detached one
                          would point at history. */}
                      {openChannel?.repositories[0] && (
                        <ChannelRepoBadge
                          attachment={openChannel.repositories[0]}
                        />
                      )}
                      <CallHeaderButton
                        count={openCall.present.length}
                        active={
                          call.status === "connected" &&
                          call.protocol === "concord" &&
                          call.channelIdHex === openChannel?.idHex
                        }
                        onOpen={openCallWindow}
                        emptyTitle="Start a call in this channel"
                      />
                      <PinsHeaderButton
                        count={pins.length}
                        unavailable={pinsUnavailable}
                        open={showPins}
                        onToggle={() => setShowPins((v) => !v)}
                      />
                    </>
                  }
                  belowHeader={
                    showPins ? (
                      <ConcordPinsList pins={pins} onOpen={handleOpenPin} />
                    ) : undefined
                  }
                  onJumpHandled={handleJumpHandled}
                  {...(jumpTo ? { jumpTo } : {})}
                />
              </div>
            </div>
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
/**
 * Whether anyone holding a link can join (CORD-05 §5).
 *
 * The aggregate of every creator's invite Registry is the protocol's own
 * answer, so this reports a folded fact rather than a setting.
 */
function OpennessBadge({
  openness,
  detail,
}: {
  openness: "public" | "private";
  detail: string;
}) {
  const Icon = openness === "public" ? Globe : Lock;
  return (
    <span
      className="flex shrink-0 items-center text-muted-foreground"
      title={
        openness === "public"
          ? `Public: anyone holding a live invite link can join (${detail}). Retiring the last one turns the community private again.`
          : "Private: no live invite link exists, so nobody can join without a member handing them the keys directly."
      }
    >
      <Icon className="size-3" aria-label={openness} />
    </span>
  );
}

function CommunityRow({
  community,
  selected,
  highlight = true,
  openness,
  opennessDetail,
  onSelect,
  onMarkRead,
  onMarkAllRead,
}: {
  community: {
    idHex: string;
    name: string;
    icon?: ImagePointer;
    unread?: CommunityUnread;
  };
  selected: boolean;
  highlight?: boolean;
  openness?: "public" | "private";
  opennessDetail?: string;
  onSelect: (idHex: string) => void;
  /** Clear every channel of this community at once. */
  onMarkRead?: (idHex: string) => void;
  /** Clear every channel of every community at once. Offered from every row —
   * not only unread ones — because the community you right-click need not be
   * the one holding the messages you want gone. */
  onMarkAllRead?: () => void;
}) {
  const icon = useConcordImage(community.icon);
  const label = community.name || community.idHex.slice(0, 8);
  const hasUnread = (community.unread?.count ?? 0) > 0;
  // The full id, not the prefix the row displays: it is what `chat <id>`
  // takes back, and what names the community in a filter or a bug report.
  const copyId = () => void navigator.clipboard.writeText(community.idHex);
  return (
    <NotifLevelMenu
      {...(onMarkRead && hasUnread
        ? { onMarkRead: () => onMarkRead(community.idHex) }
        : {})}
      {...(onMarkAllRead ? { onMarkAllRead } : {})}
      onCopyId={copyId}
    >
      <button
        type="button"
        onClick={() => onSelect(community.idHex)}
        className={cn(
          "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-muted/50",
          selected && highlight && "bg-muted/70 font-medium",
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
        {/* One right-aligned group, so the openness icon and the unread count
            sit together instead of the icon floating off on its own. */}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {openness && (
            <OpennessBadge openness={openness} detail={opennessDetail ?? ""} />
          )}
          {community.unread && <UnreadBadge unread={community.unread} />}
        </span>
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
  highlight,
  openness,
  opennessDetail,
  onSelect,
  onMarkRead,
  onMarkAllRead,
  children,
}: {
  communities: Array<{
    idHex: string;
    name: string;
    icon?: ImagePointer;
    unread?: CommunityUnread;
  }>;
  selected: string | undefined;
  /** Whether the selected row renders as active (false while a pane overrides it). */
  highlight: boolean;
  /** Known for the SELECTED community only — it is the one whose fold is read. */
  openness?: "public" | "private";
  opennessDetail: string;
  onSelect: (idHex: string) => void;
  /** Clear every channel of one community at once. */
  onMarkRead?: (idHex: string) => void;
  /** Clear every channel of every community at once. Only passed when there
   * is something anywhere to clear — the row menu's twin of that rule. */
  onMarkAllRead?: () => void;
  children: ReactNode;
}) {
  // Every community gets a row, including the only one. It used to be hidden as
  // chrome — with nothing to pick between, the channels stood alone under a
  // header that already named them — but Direct messages is a sibling row now,
  // and a reader who steps into their mail needs a row to step back out to.
  //
  // The scroller belongs to the sidebar, not here: this list and the DM row
  // scroll together as one column.
  return (
    <div className="flex flex-col">
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
            highlight={highlight}
            {...(c.idHex === selected && openness
              ? { openness, opennessDetail }
              : {})}
            onSelect={onSelect}
            {...(onMarkRead ? { onMarkRead } : {})}
            {...(onMarkAllRead ? { onMarkAllRead } : {})}
          />
          {c.idHex === selected && <div className="pl-2">{children}</div>}
        </div>
      ))}
    </div>
  );
}
