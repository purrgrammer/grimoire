/**
 * One scope's notification level, live.
 *
 * The service behind this answers synchronously from a memo, so this hook is
 * only the two things a component cannot do for itself: wait for the first load
 * and repaint when some other row's menu changes a level. The global default
 * comes through `use$` for the same reason — a change in Settings has to move
 * every menu's checkmark, not just the next one opened.
 */

import { useCallback, useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";

import {
  channelLevelOverride,
  communityLevelOverride,
  defaultLevel,
  ensureNotifPrefsLoaded,
  inheritedLevelSync,
  onNotifPrefsChange,
  resolveLevelSync,
  setChannelLevel,
  setCommunityLevel,
  type NotifLevel,
} from "@/services/concord-notif-prefs";
import { settingsManager } from "@/services/settings";

export interface ConcordNotifLevel {
  /** What the cascade actually decides for this scope. */
  level: NotifLevel;
  /** What is set AT this scope, or undefined when it inherits. */
  override: NotifLevel | undefined;
  /**
   * What clearing the override would leave — NOT the same as {@link level}
   * while one is set, which is the whole reason this is separate.
   */
  inherited: NotifLevel;
  /** Set this scope's level, or clear it back to inherited with `undefined`. */
  set: (level: NotifLevel | undefined) => void;
}

/**
 * Pass a channel for a channel's level; omit it for the community's own.
 *
 * A community scope has no cascade of its own to show — `level` is its explicit
 * setting or the global default, which is exactly what its channels inherit.
 */
export function useConcordNotifLevel(
  communityId: string | undefined,
  channelIdHex?: string,
): ConcordNotifLevel {
  // Not the value itself: the service owns that, and a component holding a copy
  // would be a second source of truth to keep in step. This is the repaint.
  const [, bump] = useState(0);
  use$(settingsManager.stream$);

  useEffect(() => {
    let live = true;
    const repaint = () => {
      if (live) bump((n) => n + 1);
    };
    const unsubscribe = onNotifPrefsChange(repaint);
    void ensureNotifPrefsLoaded().then(repaint);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  const set = useCallback(
    (next: NotifLevel | undefined) => {
      if (!communityId) return;
      void (channelIdHex
        ? setChannelLevel(communityId, channelIdHex, next)
        : setCommunityLevel(communityId, next));
    },
    [communityId, channelIdHex],
  );

  if (!communityId)
    return {
      level: defaultLevel(),
      override: undefined,
      inherited: defaultLevel(),
      set,
    };
  const override = channelIdHex
    ? channelLevelOverride(communityId, channelIdHex)
    : communityLevelOverride(communityId);
  const level = channelIdHex
    ? resolveLevelSync(communityId, channelIdHex)
    : (override ?? defaultLevel());
  return {
    level,
    override,
    inherited: inheritedLevelSync(communityId, channelIdHex),
    set,
  };
}
