/**
 * The Guestbook, as something a member can read.
 *
 * Moderation used to be legible only by absence: a kicked member simply stopped
 * being in the list, a ban showed up as messages that were no longer there.
 * This says what happened and who did it, for the events the plane actually
 * attributes.
 *
 * What it deliberately does NOT do is interleave these rows into a channel
 * timeline. A guestbook rumor carries no channel binding by construction, so a
 * position in any timeline would be invented — and repeated in every channel.
 */

import { Ban, LogIn, LogOut, UserMinus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Virtuoso } from "react-virtuoso";

import Timestamp from "@/components/Timestamp";
import { UserName } from "@/components/nostr/UserName";
import { formatTimestamp, useLocale } from "@/hooks/useLocale";
import type { GuestbookFeedEntry } from "@/lib/concord/guestbook";

const ICONS: Record<GuestbookFeedEntry["kind"], LucideIcon> = {
  join: LogIn,
  leave: LogOut,
  kick: UserMinus,
  ban: Ban,
};

export function ConcordGuestbookPanel({
  feed,
  loading,
}: {
  feed: GuestbookFeedEntry[];
  loading: boolean;
}) {
  const { locale } = useLocale();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">
        Who came and went. Published by the members themselves and by whoever
        moderated them — this device only reads it.
      </div>
      {feed.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          <p className="max-w-sm">
            {loading
              ? "Reading the guestbook…"
              : "Nothing here yet. Membership is off to one side of the protocol: a member who simply started talking never wrote a line in it."}
          </p>
        </div>
      ) : (
        // Virtualized, because this feed has no cap: `readGuestbookFeed`
        // returns every honoured entry the plane carries plus a row per
        // currently-banned member, and a community with real churn has more of
        // those than a browser should lay out at once. Top-anchored, with no
        // `initialTopMostItemIndex` — the deadlock that bit the chat list is a
        // property of anchoring to the END, and nothing here anchors at all.
        <div className="flex-1 overflow-hidden py-1">
          <Virtuoso
            style={{ height: "100%" }}
            data={feed}
            computeItemKey={(_, entry) =>
              `${entry.kind}:${entry.rumorId ?? entry.pubkey}`
            }
            itemContent={(_, entry) => {
              const Icon = ICONS[entry.kind];
              return (
                <div className="flex items-center gap-1.5 px-3 py-0.5 text-xs text-muted-foreground">
                  <Icon className="size-3 shrink-0" />
                  <UserName pubkey={entry.pubkey} className="text-xs" />
                  {entry.kind === "join" && <span>joined</span>}
                  {entry.kind === "leave" && <span>left</span>}
                  {entry.kind === "kick" && (
                    <>
                      <span>was removed by</span>
                      {entry.actor ? (
                        <UserName pubkey={entry.actor} className="text-xs" />
                      ) : (
                        <span>a moderator</span>
                      )}
                    </>
                  )}
                  {entry.kind === "ban" && (
                    // The row says only "is banned" — the timestamp sits in its
                    // own right-aligned column, so any "as of" here reads as a
                    // sentence cut off. The caveat that the fold records the
                    // newest Banlist edition, not necessarily the one that
                    // banned them, lives in the tooltip where it fits.
                    <span
                      title={`The Banlist naming them was last edited ${formatTimestamp(
                        Math.floor(entry.ms / 1000),
                        "long",
                        locale,
                      )}; the ban itself may be older.`}
                    >
                      is banned
                    </span>
                  )}
                  <span className="ml-auto shrink-0">
                    <Timestamp timestamp={Math.floor(entry.ms / 1000)} />
                  </span>
                </div>
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
