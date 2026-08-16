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
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useConcordPrefs } from "@/hooks/useConcordPrefs";
import { useLocale } from "@/hooks/useLocale";
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
 * Right-click a row for what can be done to it. Today that is Pin, and the menu
 * does not render at all where nothing can.
 *
 * The name is now wider than the thing: notification levels used to live here
 * and are hidden with the rest of that subsystem. Kept so restoring them is an
 * addition rather than a re-wiring.
 */
export function NotifLevelMenu({
  pinned,
  onTogglePin,
  children,
}: {
  /** Channel rows only — a container is not something you pin above itself. */
  pinned?: boolean;
  onTogglePin?: () => void;
  children: ReactNode;
}) {
  // Notification levels are hidden for now: the whole subsystem is off, so a
  // menu offering to tune it would promise something nothing acts on. The
  // hook, the prefs and the notifier all stay wired — restoring this is the
  // radio group below, not a rebuild.
  //
  // What survives is Pin, styled like every other menu in the app:
  // `size-4 mr-2` on the icon, one verb as the label. "Pin to the top"
  // described the effect where the other items name the action.
  if (!onTogglePin) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem onSelect={onTogglePin}>
          {pinned ? (
            <PinOff className="size-4 mr-2" />
          ) : (
            <Pin className="size-4 mr-2" />
          )}
          {pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

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
    // Content-sized on purpose: this list is nested INSIDE the community
    // picker, and a scroll container inside a scroll container gave the
    // channels a box that did not grow with them — the next community's row
    // painted straight over the last channels. The single scroller is the
    // picker (or, with one community, the wrapper it hands the children to).
    <div className="py-1">
      {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}
      {loading && channels.length === 0 && (
        <p className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> loading…
        </p>
      )}
      {/* Pinned channels rise to the top but get NO heading of their own. A
          heading made the list taller the moment you pinned anything, so the
          rows under the cursor moved — and it spent a whole line saying what a
          mark on the row itself says without costing any. */}
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
  const { isPinned, togglePin } = useConcordPrefs();
  const pinned = isPinned(communityId ?? "", channel.idHex);
  return (
    <NotifLevelMenu
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
        )}
      >
        <Icon className="size-3 flex-shrink-0 text-muted-foreground" />
        <span className="truncate">{channel.name}</span>
        {/* `ml-auto` on the pin and nothing else: it rides at the right of the
            row, inside the row's own line box, so pinning cannot change the
            row's height — which is the whole reason the heading went. */}
        {pinned && (
          <Pin className="ml-auto size-3 shrink-0 text-muted-foreground" />
        )}
        {unread && <UnreadBadge unread={unread} />}
      </button>
    </NotifLevelMenu>
  );
}
