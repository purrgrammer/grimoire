/**
 * Desktop notifications for Concord, while a Concord window is open.
 *
 * Hangs off the wire BUS, deliberately downstream of ingest: every decrypted
 * rumor lands in Dexie first and the bus then names the channel that changed,
 * so this re-reads the store rather than being handed events. That is what lets
 * it apply the reader's own state — last-read stamp, mute level, the fold's
 * banlist — to a message that may equally have arrived live or in a replay.
 *
 * It only runs where the wire runs. `useConcordWire` is mounted by
 * `ConcordViewer` and refcounted, so with no Concord window open there is no
 * ingest, no ring, and nothing to announce — closing every Concord window
 * silences notifications, which is a real limitation rather than a bug, and one
 * the man page states.
 */

import { useEffect, useRef } from "react";
import { use$ } from "applesauce-react/hooks";

import { mentionsPubkey } from "@/lib/chat/mentions";
import {
  notificationBody,
  shouldNotify,
  type NotifyCandidate,
} from "@/lib/concord/notify";
import { onWireScopes } from "@/lib/concord/wire-bus";
import { useAddWindow, useGrimoire } from "@/core/state";
import { buildConcordWindowUpdate } from "@/lib/concord/window-props";
import {
  invalidateChannelDirectory,
  resolveChannel,
} from "@/services/concord-channel-directory";
import { resolveLevel } from "@/services/concord-notif-prefs";
import {
  CONCORD_READ_MAX_FUTURE_SECS,
  readLastRead,
} from "@/services/concord-reads";
import {
  channelRumorsSince,
  NOTIFY_SCAN_CAP,
} from "@/services/concord-rumor-store";
import accountManager from "@/services/accounts";
import profileSearch from "@/services/profile-search";
import { settingsManager } from "@/services/settings";

/** How much of a message a notification shows before it is a wall of text. */
const BODY_CHARS = 140;

function permissionGranted(): boolean {
  return (
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );
}

function documentVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

/** A name for the author, from whatever profile the app already has. */
function displayNameFor(pubkey: string): string {
  const profile = profileSearch.getByPubkey(pubkey);
  return profile?.displayName || `${pubkey.slice(0, 8)}…`;
}

/**
 * Watch every ingested channel and announce what the reader would want to know.
 *
 * The subscription is keyed on the account alone and reads everything else at
 * ring time: settings, permission and mute levels all change while this is
 * mounted, and a listener that re-registered on each of them would drop rings
 * in the gap.
 */
export function useConcordNotifier(): void {
  const addWindow = useAddWindow();
  const { state: grimoire, updateWindow } = useGrimoire();
  const selfPubkey = use$(accountManager.active$)?.pubkey;
  /**
   * The live window map, behind a ref.
   *
   * A click has to know which Concord windows are open, but the ring
   * subscription must NOT re-register when they change — it is keyed on the
   * account alone precisely so a mute edit or a layout change cannot drop a
   * ring in the gap. So the effect reads this at click time instead of taking
   * `grimoire.windows` as a dependency.
   */
  const navigate = useRef({ windows: grimoire.windows, updateWindow });
  useEffect(() => {
    navigate.current = { windows: grimoire.windows, updateWindow };
  }, [grimoire.windows, updateWindow]);
  // Everything ingested before this instant is history, however it arrives.
  // Without it, the first sync after a week away fires a week of alerts. Read
  // in the effect rather than in the initializer: a clock read during render is
  // not a pure one, and the first ring cannot precede the subscription anyway.
  const sessionFloor = useRef(0);
  // Which account that floor belongs to. Signing into a second account in a
  // live tab starts a new session: keeping the first one's floor would scan —
  // and could announce — everything ingested since the tab was opened.
  const floorFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    const pubkey = selfPubkey;
    if (!pubkey) {
      // Signing out ends the session, so signing back in starts another — even
      // as the same account. Logout erases the rumors, the read stamps and the
      // dedupe ring; without this the re-ingest that follows would be measured
      // against a floor from before all three and announced all over again.
      floorFor.current = undefined;
      return;
    }
    if (floorFor.current !== pubkey) {
      floorFor.current = pubkey;
      sessionFloor.current = Math.floor(Date.now() / 1000);
    }
    let live = true;

    const announce = async (channelIdHex: string): Promise<void> => {
      const entry = await resolveChannel(pubkey, channelIdHex);
      if (!entry || !live) return;
      const level = await resolveLevel(entry.communityId, channelIdHex);
      // The cheapest gate there is, taken before any row is read: a silenced
      // channel is most of the traffic in a community someone has muted.
      if (level === "nothing" || !live) return;

      const lastRead = await readLastRead(
        pubkey,
        entry.communityId,
        channelIdHex,
      );
      if (!live) return;
      const nowSecs = Math.floor(Date.now() / 1000);
      const rows = await channelRumorsSince(entry.communityId, channelIdHex, {
        // The floor and the stamp both bound the scan, so a channel read an
        // hour ago does not re-read an hour of rows on every ring.
        after: Math.max(sessionFloor.current, lastRead),
        nowSecs,
        maxFutureSecs: CONCORD_READ_MAX_FUTURE_SECS,
        selfPubkey: pubkey,
        bannedAuthors: entry.banned,
        cap: NOTIFY_SCAN_CAP,
      });
      if (!live || rows.length === 0) return;

      const enabled = settingsManager.value.notifications?.enabled ?? false;
      const granted = permissionGranted();
      const visible = documentVisible();
      // Oldest first, so the notification left on screen after the OS collapses
      // them by tag is the newest message rather than the oldest.
      for (const row of rows.reverse()) {
        const candidate: NotifyCandidate = {
          rumorId: row.id,
          author: row.pubkey,
          createdAt: row.created_at,
          isMention: mentionsPubkey(row.tags, pubkey),
          channelIdHex,
        };
        const admitted = shouldNotify(candidate, {
          enabled,
          permissionGranted: granted,
          sessionFloor: sessionFloor.current,
          selfPubkey: pubkey,
          level,
          lastRead,
          visible,
        });
        if (!admitted) continue;

        const name = displayNameFor(row.pubkey);
        const title = candidate.isMention
          ? `${name} mentioned you in #${entry.channelName}`
          : `${name} in #${entry.channelName}`;
        const body = notificationBody(row.content, BODY_CHARS);
        try {
          const notification = new Notification(title, {
            body,
            // `/favicon.png` does not exist in `public/` — the notification
            // simply rendered without an icon. This one does.
            icon: "/favicon-192x192.png",
            // Tagged by channel, so a burst collapses into one entry rather
            // than stacking twenty.
            tag: channelIdHex,
          });
          notification.onclick = () => {
            window.focus();
            // Steer a Concord window that is already open on this community
            // rather than stacking a new one: three notifications for the same
            // channel used to leave three identical windows behind. Adding one
            // is the fallback, for when none is open.
            const { windows, updateWindow: update } = navigate.current;
            const existing = Object.entries(windows).find(
              ([, w]) =>
                w.appId === "concord" &&
                (w.props as { communityId?: string } | undefined)
                  ?.communityId === entry.communityId,
            );
            if (existing) {
              const [id, w] = existing;
              update(
                id,
                buildConcordWindowUpdate(
                  w.props as Record<string, unknown> | undefined,
                  entry.communityId,
                  channelIdHex,
                ),
              );
            } else {
              addWindow("concord", {
                communityId: entry.communityId,
                channelId: channelIdHex,
              });
            }
            notification.close();
          };
        } catch {
          // Chrome on Android and Safari on iOS only show notifications
          // through a service worker, and grimoire's is cache-only. Nothing
          // more can be done here — the badges still work.
        }
      }
    };

    const unsubscribe = onWireScopes((scopes) => {
      const channels: string[] = [];
      let control = false;
      for (const scope of scopes) {
        if (scope.startsWith("c2ctl:")) control = true;
        else if (scope.startsWith("c2:")) channels.push(scope.slice(3));
      }
      // A control edition changed the fold: channel names, the channel list,
      // and — the reason this matters — the banlist the scan filters on.
      if (control) invalidateChannelDirectory();
      for (const channelIdHex of channels) {
        void announce(channelIdHex).catch(() => {
          // One unreadable channel must not stop the batch: the next ring
          // re-reads the same rows anyway.
        });
      }
    });

    return () => {
      live = false;
      unsubscribe();
    };
    // `addWindow` is stable (a `useSetAtom` dispatch), so this subscribes once
    // per account rather than per render.
  }, [selfPubkey, addWindow]);
}
