/**
 * The sidebar arrangement this device remembers, live.
 *
 * A thin binding over `concord-prefs`: the snapshot comes through `use$` so
 * every mounted sidebar repaints when any of them changes a pin or folds a
 * category, and the predicates close over THAT snapshot rather than reading the
 * manager, so a render only ever sees the value it subscribed to.
 */

import { useCallback, useMemo } from "react";
import { use$ } from "applesauce-react/hooks";

import {
  concordPrefsManager,
  isCategoryCollapsed,
  isChannelPinned,
  lastChannelOf,
  type ChatPrefs,
} from "@/services/concord-prefs";

export interface ConcordPrefs {
  prefs: ChatPrefs;
  isPinned: (communityIdHex: string, channelIdHex: string) => boolean;
  togglePin: (communityIdHex: string, channelIdHex: string) => void;
  isCollapsed: (communityIdHex: string, categoryKey: string) => boolean;
  toggleCollapsed: (communityIdHex: string, categoryKey: string) => void;
  lastChannel: (communityIdHex: string) => string | undefined;
  setLastChannel: (communityIdHex: string, channelIdHex: string) => void;
}

export function useConcordPrefs(): ConcordPrefs {
  // The stream is a BehaviorSubject's, so `use$` has the current value on the
  // first render; the fallback is a type guard rather than a state anyone sees.
  const prefs = use$(concordPrefsManager.stream$) ?? concordPrefsManager.value;

  const isPinned = useCallback(
    (communityIdHex: string, channelIdHex: string) =>
      isChannelPinned(prefs, communityIdHex, channelIdHex),
    [prefs],
  );
  const isCollapsed = useCallback(
    (communityIdHex: string, categoryKey: string) =>
      isCategoryCollapsed(prefs, communityIdHex, categoryKey),
    [prefs],
  );
  const lastChannel = useCallback(
    (communityIdHex: string) => lastChannelOf(prefs, communityIdHex),
    [prefs],
  );

  const togglePin = useCallback(
    (communityIdHex: string, channelIdHex: string) =>
      concordPrefsManager.togglePin(communityIdHex, channelIdHex),
    [],
  );
  const toggleCollapsed = useCallback(
    (communityIdHex: string, categoryKey: string) =>
      concordPrefsManager.toggleCategoryCollapsed(communityIdHex, categoryKey),
    [],
  );
  const setLastChannel = useCallback(
    (communityIdHex: string, channelIdHex: string) =>
      concordPrefsManager.setLastChannel(communityIdHex, channelIdHex),
    [],
  );

  return useMemo(
    () => ({
      prefs,
      isPinned,
      togglePin,
      isCollapsed,
      toggleCollapsed,
      lastChannel,
      setLastChannel,
    }),
    [
      prefs,
      isPinned,
      togglePin,
      isCollapsed,
      toggleCollapsed,
      lastChannel,
      setLastChannel,
    ],
  );
}
