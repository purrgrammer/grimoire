import { useCallback, useMemo, useState } from "react";
import { Hash, Loader2, Lock, PanelLeft, RefreshCw } from "lucide-react";

import { ChatViewer } from "./ChatViewer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useConcordCommunities, useConcordCommunity } from "@/hooks/useConcord";
import { useConcordWire } from "@/hooks/useConcordWire";
import { useConcordRekeyWatch } from "@/hooks/useConcordRekey";
import { useConcordDissolved } from "@/hooks/useConcordDissolved";
import {
  channelCategory,
  groupChannelsByCategory,
} from "@/lib/concord/channels";
import type { Channel } from "@/lib/concord/types";
import { cn } from "@/lib/utils";
import type { ConcordIdentifier, ProtocolIdentifier } from "@/types/chat";

interface ConcordViewerProps {
  /** community_id (lowercase hex), or a prefix of one. */
  communityId?: string;
  /** Channel to open on mount, if the caller already knows one. */
  channelId?: string;
}

/**
 * ConcordViewer — one Concord community: channels on the left, chat on the right.
 *
 * Read-only as to membership and moderation: the community is joined, moderated
 * and rotated in Armada. What this renders is the member's own view of it — the
 * channels their keys can actually open, in the community's own arrangement.
 */
export function ConcordViewer({ communityId, channelId }: ConcordViewerProps) {
  const isMobile = useIsMobile();
  const { communities, status, refresh: refreshList } = useConcordCommunities();
  const [selectedId, setSelectedId] = useState<string | undefined>(communityId);
  const [selectedChannel, setSelectedChannel] = useState<string | undefined>(
    channelId,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  const { state, loading, error, refresh } = useConcordCommunity(community);
  const channels = useMemo(() => state?.channels ?? [], [state]);

  // Live delivery for EVERY community in the list, not just the open one: a
  // channel you are not looking at is exactly the case pull-on-open could not
  // serve. Refcounted, so several Concord windows share one set of sockets.
  useConcordWire(communities);

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

  // The OPEN channel is derived, not stored: falling back to the first one keeps
  // the pane filled the moment the fold lands, with no effect writing state
  // during a render pass. An explicit pick wins whenever it still resolves.
  const openChannel =
    channels.find((ch) => ch.idHex === selectedChannel) ?? channels[0];

  const handleChannelSelect = useCallback(
    (idHex: string) => {
      setSelectedChannel(idHex);
      if (isMobile) setSidebarOpen(false);
    },
    [isMobile],
  );

  // Memoized BY VALUE, not rebuilt per render. ChatViewer keys its conversation
  // resolution on this object, so a fresh one every render made it re-resolve
  // and blank the timeline — the flicker on first load, where the community
  // paints twice (stored fold, then swept).
  const communityIdHex = community?.idHex;
  const openChannelIdHex = openChannel?.idHex;
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
    return (
      <Empty>
        No Concord communities found. Join one in Armada — it publishes the
        encrypted membership list this reads.
      </Empty>
    );
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <CommunityPicker
        communities={communities.map((c) => ({
          idHex: c.idHex,
          name: c.name,
        }))}
        selected={community?.idHex}
        onSelect={(idHex) => {
          setSelectedId(idHex);
          setSelectedChannel(undefined);
        }}
      />
      <div className="flex items-center justify-between border-b px-2 py-1">
        <span className="truncate text-xs font-medium text-muted-foreground">
          {state?.folded.metadata?.name ?? community?.name ?? "Community"}
        </span>
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
      <ChannelList
        channels={channels}
        selected={openChannel?.idHex}
        loading={loading}
        error={error}
        onSelect={handleChannelSelect}
      />
    </div>
  );

  const headerPrefix = isMobile ? (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      onClick={() => setSidebarOpen(true)}
    >
      <PanelLeft className="size-4" />
    </Button>
  ) : undefined;

  return (
    <div className="flex h-full">
      {isMobile ? (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <VisuallyHidden.Root>
              <SheetTitle>Channels</SheetTitle>
            </VisuallyHidden.Root>
            {sidebar}
          </SheetContent>
        </Sheet>
      ) : (
        <div className="w-64 flex-shrink-0 border-r">{sidebar}</div>
      )}
      <div className="min-w-0 flex-1">
        {identifier ? (
          <ChatViewer
            protocol="concord"
            identifier={identifier as ProtocolIdentifier}
            headerPrefix={headerPrefix}
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
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      <p className="max-w-sm">{children}</p>
    </div>
  );
}

function CommunityPicker({
  communities,
  selected,
  onSelect,
}: {
  communities: Array<{ idHex: string; name: string }>;
  selected: string | undefined;
  onSelect: (idHex: string) => void;
}) {
  if (communities.length <= 1) return null;
  return (
    <div className="border-b">
      {communities.map((c) => (
        <button
          key={c.idHex}
          type="button"
          onClick={() => onSelect(c.idHex)}
          className={cn(
            "block w-full cursor-crosshair truncate px-2 py-1 text-left text-sm hover:bg-muted/50",
            c.idHex === selected && "bg-muted/70 font-medium",
          )}
        >
          {c.name || c.idHex.slice(0, 8)}
        </button>
      ))}
    </div>
  );
}

function ChannelList({
  channels,
  selected,
  loading,
  error,
  onSelect,
}: {
  channels: Channel[];
  selected: string | undefined;
  loading: boolean;
  error: string | undefined;
  onSelect: (idHex: string) => void;
}) {
  // `channelsView` already returns display order, so the grouping reads the
  // categories straight off it — the arrangement is one act, not two.
  const { uncategorized, categories } = useMemo(
    () =>
      groupChannelsByCategory(channels, (ch) =>
        ch.category !== undefined
          ? ch.category
          : channelCategory({ name: ch.name, private: ch.isPrivate }),
      ),
    [channels],
  );

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}
      {loading && channels.length === 0 && (
        <p className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> loading…
        </p>
      )}
      {uncategorized.map((ch) => (
        <ChannelRow
          key={ch.idHex}
          channel={ch}
          selected={ch.idHex === selected}
          onSelect={onSelect}
        />
      ))}
      {categories.map((group) => (
        <div key={group.key} className="mt-1">
          <p className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.name}
          </p>
          {group.channels.map((ch) => (
            <ChannelRow
              key={ch.idHex}
              channel={ch}
              selected={ch.idHex === selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ChannelRow({
  channel,
  selected,
  onSelect,
}: {
  channel: Channel;
  selected: boolean;
  onSelect: (idHex: string) => void;
}) {
  const Icon = channel.isPrivate ? Lock : Hash;
  return (
    <button
      type="button"
      onClick={() => onSelect(channel.idHex)}
      title={channel.idHex}
      className={cn(
        "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-0.5 text-left text-sm hover:bg-muted/50",
        selected && "bg-muted/70 font-medium",
      )}
    >
      <Icon className="size-3 flex-shrink-0 text-muted-foreground" />
      <span className="truncate">{channel.name}</span>
    </button>
  );
}
