/**
 * A chat sidebar's channel list: the rows, their badges, and the menu that says
 * how loudly each one may interrupt.
 *
 * Split out of `ConcordViewer` so it can be rendered on its own — the viewer
 * pulls in the whole timeline beneath it, and a sidebar is not the timeline.
 * Nothing here reaches for a community's membership or its moderation: a row is
 * a name, a count and a level, which is all a NIP-29 group would bring too.
 */

import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  BellOff,
  ChevronDown,
  ChevronRight,
  Hash,
  Loader2,
  Lock,
  Pin,
  PinOff,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useConcordNotifLevel } from "@/hooks/useConcordNotifLevel";
import { useConcordPrefs } from "@/hooks/useConcordPrefs";
import { useLocale } from "@/hooks/useLocale";
import type { NotifLevel } from "@/services/concord-notif-prefs";
import type { ChannelUnread } from "@/services/concord-rumor-store";
import {
  channelCategory,
  groupChannelsByCategory,
  partitionPinned,
} from "@/lib/concord/channels";
import type { Channel } from "@/lib/concord/types";
import { cn } from "@/lib/utils";

/**
 * The waiting-messages badge: a count, or an `@` when one of them names you.
 *
 * `font-semibold` marks an unread row rather than `font-medium`, which the
 * SELECTED row already uses — otherwise the row you are reading and the row you
 * have not read look identical.
 *
 * A silenced scope still shows its count — the messages are there and the
 * reader asked for quiet, not for blindness — but drops the `@`: an accent that
 * says "come and look" is the one thing `nothing` was set to stop.
 */
export function UnreadBadge({
  unread,
  silenced,
}: {
  unread: { count: number; mention: boolean; capped?: boolean };
  silenced?: boolean;
}) {
  const { locale } = useLocale();
  if (unread.count <= 0) return null;
  const label = unread.capped
    ? `${new Intl.NumberFormat(locale).format(unread.count)}+`
    : new Intl.NumberFormat(locale).format(unread.count);
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {unread.mention && !silenced && (
        <span
          aria-label="You were mentioned"
          title="You were mentioned"
          className="flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground"
        >
          @
        </span>
      )}
      <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
        {label}
      </span>
    </span>
  );
}

/**
 * Right-click a row to say how loudly it may interrupt you.
 *
 * Armada's three levels, with a fourth entry for the cascade itself: a channel
 * set to "Use community default" has no level of its own and follows whatever
 * its community — or Settings — says. The distinction matters, because clearing
 * an override is otherwise impossible once set.
 *
 * The levels are stored on THIS DEVICE and are erased when you sign out.
 * Nothing about them is published: no CORD document defines a mute, and
 * grimoire uploads nothing but the messages you type.
 */
export function NotifLevelMenu({
  communityId,
  channelIdHex,
  label,
  pinned,
  onTogglePin,
  children,
}: {
  communityId: string | undefined;
  channelIdHex?: string;
  label: string;
  /** Channel rows only — a container is not something you pin above itself. */
  pinned?: boolean;
  onTogglePin?: () => void;
  children: ReactNode;
}) {
  const { override, inherited, set } = useConcordNotifLevel(
    communityId,
    channelIdHex,
  );
  // `inherited`, never the resolved level: with an override set the resolved
  // level is the override, so naming it here would promise the state you are
  // already in and deliver its opposite — a community muted to "nothing" with
  // this channel raised to "all" would read "Use community default (all
  // messages)" and silence the channel when clicked.
  const inheritLabel = channelIdHex
    ? `Use community default (${LEVEL_LABELS[inherited]})`
    : `Use app default (${LEVEL_LABELS[inherited]})`;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {onTogglePin && (
          <>
            <ContextMenuItem onSelect={onTogglePin}>
              {pinned ? (
                <PinOff className="size-3" />
              ) : (
                <Pin className="size-3" />
              )}
              {pinned ? "Unpin" : "Pin to the top"}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          Notify me about {label}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuRadioGroup
          value={override ?? "inherit"}
          onValueChange={(next) =>
            set(next === "inherit" ? undefined : (next as NotifLevel))
          }
        >
          <ContextMenuRadioItem value="inherit">
            {inheritLabel}
          </ContextMenuRadioItem>
          <ContextMenuRadioItem value="all">All messages</ContextMenuRadioItem>
          <ContextMenuRadioItem value="mentions">
            Mentions only
          </ContextMenuRadioItem>
          <ContextMenuRadioItem value="nothing">Nothing</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const LEVEL_LABELS: Record<NotifLevel, string> = {
  all: "all messages",
  mentions: "mentions only",
  nothing: "nothing",
};

/**
 * The channels, in the community's own arrangement, with categories that fold.
 *
 * A folded category is not a hidden one: rows with messages waiting — and the
 * row being read — stay visible under the closed heading. Folding is a way to
 * quiet a sidebar, and a fold that swallowed an unread badge would take the one
 * thing the reader folded the category to still be able to notice.
 *
 * The fold is keyed by the category's casefolded NAME, because a category is
 * emergent from channel metadata and has no id. Renaming one therefore opens it
 * — armada's documented right failure, and the alternative is a fold that
 * outlives the thing it was folding.
 */
export function ChannelList({
  channels,
  communityId,
  selected,
  loading,
  error,
  unread,
  onSelect,
}: {
  channels: Channel[];
  communityId: string | undefined;
  selected: string | undefined;
  loading: boolean;
  error: string | undefined;
  unread: Map<string, ChannelUnread>;
  onSelect: (idHex: string) => void;
}) {
  const { isCollapsed, toggleCollapsed, isPinned } = useConcordPrefs();
  // Pins come off the front first, so a pinned channel is never also drawn
  // inside its category — and never disappears when that category is folded.
  const { pinned, rest } = useMemo(
    () =>
      partitionPinned(channels, (ch) => isPinned(communityId ?? "", ch.idHex)),
    [channels, communityId, isPinned],
  );
  // `channelsView` already returns display order, so the grouping reads the
  // categories straight off it — the arrangement is one act, not two.
  const { uncategorized, categories } = useMemo(
    () =>
      groupChannelsByCategory(rest, (ch) =>
        ch.category !== undefined
          ? ch.category
          : channelCategory({ name: ch.name, private: ch.isPrivate }),
      ),
    [rest],
  );

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}
      {loading && channels.length === 0 && (
        <p className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> loading…
        </p>
      )}
      {pinned.length > 0 && (
        <div className="mb-1">
          <p className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Pin className="size-3 shrink-0" />
            <span className="truncate">pinned</span>
          </p>
          {pinned.map((ch) => (
            <ChannelRow
              key={ch.idHex}
              channel={ch}
              communityId={communityId}
              selected={ch.idHex === selected}
              unread={unread.get(ch.idHex.toLowerCase())}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
      {uncategorized.map((ch) => (
        <ChannelRow
          key={ch.idHex}
          channel={ch}
          communityId={communityId}
          selected={ch.idHex === selected}
          unread={unread.get(ch.idHex.toLowerCase())}
          onSelect={onSelect}
        />
      ))}
      {categories.map((group) => {
        const collapsed = isCollapsed(communityId ?? "", group.key);
        const shown = collapsed
          ? group.channels.filter(
              (ch) =>
                ch.idHex === selected ||
                (unread.get(ch.idHex.toLowerCase())?.count ?? 0) > 0,
            )
          : group.channels;
        const Chevron = collapsed ? ChevronRight : ChevronDown;
        return (
          <div key={group.key} className="mt-1">
            <button
              type="button"
              onClick={() => toggleCollapsed(communityId ?? "", group.key)}
              aria-expanded={!collapsed}
              title={collapsed ? "Show every channel" : "Fold this category"}
              className="flex w-full cursor-crosshair items-center gap-0.5 px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              <Chevron className="size-3 shrink-0" />
              <span className="truncate">{group.name}</span>
            </button>
            {shown.map((ch) => (
              <ChannelRow
                key={ch.idHex}
                channel={ch}
                communityId={communityId}
                selected={ch.idHex === selected}
                unread={unread.get(ch.idHex.toLowerCase())}
                onSelect={onSelect}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ChannelRow({
  channel,
  communityId,
  selected,
  unread,
  onSelect,
}: {
  channel: Channel;
  communityId: string | undefined;
  selected: boolean;
  unread: ChannelUnread | undefined;
  onSelect: (idHex: string) => void;
}) {
  const Icon = channel.isPrivate ? Lock : Hash;
  const hasUnread = (unread?.count ?? 0) > 0;
  const { level } = useConcordNotifLevel(communityId, channel.idHex);
  const silenced = level === "nothing";
  const { isPinned, togglePin } = useConcordPrefs();
  const pinned = isPinned(communityId ?? "", channel.idHex);
  return (
    <NotifLevelMenu
      communityId={communityId}
      channelIdHex={channel.idHex}
      label={channel.name}
      pinned={pinned}
      onTogglePin={
        communityId ? () => togglePin(communityId, channel.idHex) : undefined
      }
    >
      <button
        type="button"
        onClick={() => onSelect(channel.idHex)}
        title={channel.idHex}
        className={cn(
          "flex w-full cursor-crosshair items-center gap-1.5 px-2 py-0.5 text-left text-sm hover:bg-muted/50",
          selected && "bg-muted/70 font-medium",
          hasUnread && "font-semibold text-foreground",
          silenced && "text-muted-foreground",
        )}
      >
        {silenced ? (
          <BellOff className="size-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <Icon className="size-3 flex-shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{channel.name}</span>
        {unread && <UnreadBadge unread={unread} silenced={silenced} />}
      </button>
    </NotifLevelMenu>
  );
}
