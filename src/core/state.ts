import { useEffect, useLayoutEffect, useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { atom, getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import {
  GrimoireState,
  AppId,
  WindowInstance,
  LayoutConfig,
  RelayInfo,
} from "@/types/app";
import { useLocale } from "@/hooks/useLocale";
import * as Logic from "./logic";
import * as SpellbookManager from "@/lib/spellbook-manager";
import { CURRENT_VERSION, validateState, migrateState } from "@/lib/migrations";
import { toast } from "sonner";
import { ParsedSpellbook } from "@/types/spell";

// Initial State Definition - Empty canvas on first load
const initialState: GrimoireState = {
  __version: CURRENT_VERSION,
  windows: {},
  activeWorkspaceId: "default",
  layoutConfig: {
    insertionMode: "smart",
    splitPercentage: 50,
    insertionPosition: "second",
    autoPreset: undefined,
  },
  workspaces: {
    default: {
      id: "default",
      number: 1,
      windowIds: [],
      layout: null,
    },
  },
};

// Custom storage with error handling and migrations
const storage = createJSONStorage<GrimoireState>(() => ({
  getItem: (key: string) => {
    try {
      const value = localStorage.getItem(key);
      if (!value) return null;
      const parsed = JSON.parse(value);
      const storedVersion = parsed.__version || 5;

      if (storedVersion < CURRENT_VERSION) {
        const migrated = migrateState(parsed);
        localStorage.setItem(key, JSON.stringify(migrated));
        toast.success("State Updated", {
          description: `Migrated from v${storedVersion} to v${CURRENT_VERSION}`,
          duration: 3000,
        });
        return JSON.stringify(migrated);
      }

      if (!validateState(parsed)) {
        console.warn(
          "[Storage] State validation failed, resetting to initial state",
        );
        toast.error("State Corrupted", {
          description: "Your state was corrupted and has been reset.",
          duration: 5000,
        });
        return null;
      }
      return value;
    } catch (error) {
      console.error("[Storage] Failed to read from localStorage:", error);
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error("Failed to write to localStorage:", error);
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn("Failed to remove from localStorage:", error);
    }
  },
}));

// Persistence Atom (The Dashboard)
export const grimoireStateAtom = atomWithStorage<GrimoireState>(
  "grimoire_v6",
  initialState,
  storage,
);

// Internal state for temporary sessions
const internalTemporaryStateAtom = atom<GrimoireState | null>(null);

// Types for dispatch actions
type StateAction =
  | { type: "UPDATE"; updater: (prev: GrimoireState) => GrimoireState }
  | { type: "START_TEMP"; spellbook?: ParsedSpellbook }
  | { type: "APPLY_TEMP" }
  | { type: "DISCARD_TEMP" };

// Derived atom that handles the switching logic and updates
const activeGrimoireStateAtom = atom(
  (get) => get(internalTemporaryStateAtom) || get(grimoireStateAtom),
  (get, set, action: StateAction) => {
    if (action.type === "UPDATE") {
      const temp = get(internalTemporaryStateAtom);
      if (temp) {
        set(internalTemporaryStateAtom, action.updater(temp));
      } else {
        set(grimoireStateAtom, action.updater);
      }
    } else if (action.type === "START_TEMP") {
      const current = get(grimoireStateAtom);
      const next = action.spellbook
        ? SpellbookManager.loadSpellbook(current, action.spellbook)
        : { ...current };
      set(internalTemporaryStateAtom, next);
    } else if (action.type === "APPLY_TEMP") {
      const temp = get(internalTemporaryStateAtom);
      if (temp) {
        set(grimoireStateAtom, temp);
        set(internalTemporaryStateAtom, null);
      }
    } else if (action.type === "DISCARD_TEMP") {
      set(internalTemporaryStateAtom, null);
    }
  },
);

/**
 * Where a single-window route's reveal places its window and the requested one.
 *
 * - `"own-workspace"` (`/run`): a workspace of their own — a new tab, or the
 *   one that already holds the route's window — so the tab the user had
 *   focused keeps its windows and layout (`Logic.addWindowInOwnWorkspace`).
 * - `"active-workspace"` (the NIP-19 previews): beside the windows of the
 *   persisted active workspace (`Logic.addWindowAlongside`).
 */
export type RevealPlacement = "own-workspace" | "active-workspace";

/**
 * A single-window route on screen — `/run` or a NIP-19 preview — and the window
 * it shows outside every workspace.
 *
 * Those routes render one window and no workspace, so a window opened from
 * there — a NIP badge, `grimoire.window`, a clicked mention — used
 * to land in a workspace nobody could see. While a route is registered
 * (`useStandaloneWindow`), the next window opened brings the route's window
 * along into the persisted state, where `placement` says, and flips
 * `revealed`; the route then navigates to the dashboard, which shows both.
 *
 * `window` is null while the route has nothing to bring along — still loading,
 * or showing an error — and the requested window is then revealed on its own.
 * `owner` identifies the registering component, so one that unmounts cannot
 * clear another's registration.
 */
export interface StandaloneWindow {
  owner: object;
  window: WindowInstance | null;
  placement: RevealPlacement;
  revealed: boolean;
}

export const standaloneWindowAtom = atom<StandaloneWindow | null>(null);

/**
 * A request to open a window. `persisted` targets the dashboard behind any
 * spellbook preview rather than the state on screen: the napplet services have
 * always written there, and still do.
 */
interface OpenWindowRequest {
  payload: Logic.AddWindowPayload;
  persisted: boolean;
}

/**
 * The single place a window is opened, so every opener — the `addWindow`
 * hooks and the services outside React — honours a standalone route without
 * knowing about it. Returns the new window's id.
 */
export const openWindowAtom = atom(
  null,
  (get, set, { payload, persisted }: OpenWindowRequest): string => {
    const request = { ...payload, id: payload.id ?? uuidv4() };
    const standalone = get(standaloneWindowAtom);

    if (standalone && !standalone.revealed) {
      // The persisted state even inside a temporary session: that is the
      // workspace the dashboard shows, since DashboardPage discards the session.
      set(grimoireStateAtom, (prev) =>
        standalone.placement === "own-workspace"
          ? Logic.addWindowInOwnWorkspace(prev, standalone.window, request)
          : Logic.addWindowAlongside(prev, standalone.window, request),
      );
      set(standaloneWindowAtom, { ...standalone, revealed: true });
      return request.id;
    }

    // Once revealed, anything else opened before the route unmounts lands in
    // the same workspace the plain way — the route's window is already there.
    const updater = (prev: GrimoireState) => Logic.addWindow(prev, request);
    if (persisted) {
      set(grimoireStateAtom, updater);
    } else {
      set(activeGrimoireStateAtom, { type: "UPDATE", updater });
    }
    return request.id;
  },
);

/**
 * Open a window from outside React, in the persisted dashboard. Returns its id.
 */
export function openPersistedWindow(
  payload: Logic.AddWindowPayload,
  store: ReturnType<typeof getDefaultStore> = getDefaultStore(),
): string {
  return store.set(openWindowAtom, { payload, persisted: true });
}

/**
 * Register the calling route as a single-window view showing `window` outside
 * the workspace, for as long as it stays mounted.
 *
 * Returns true once another window has been opened and `window` has been
 * placed in a workspace beside it, where `placement` says — the caller's cue
 * to navigate to `/`. Pass a referentially stable window (memoize it): a new
 * object re-registers it as not yet revealed.
 */
export function useStandaloneWindow(
  window: WindowInstance | null,
  placement: RevealPlacement,
): boolean {
  const [owner] = useState(() => ({}));
  const standalone = useAtomValue(standaloneWindowAtom);
  const setStandalone = useSetAtom(standaloneWindowAtom);

  // A layout effect: the registration lands in the commit that puts `window`
  // on screen. As a passive effect it ran in a later task, and a click on the
  // window in between — a button clicked the instant it rendered — opened its window
  // under the registration from the loading state (`window: null`), so the
  // requested window went to a tab alone and the re-registration that followed
  // reset `revealed`, leaving the tab on the route. Flaky in CI, 2 in 25 runs
  // locally (`useRevealOnOpen.test.tsx` pins it).
  useLayoutEffect(() => {
    setStandalone({ owner, window, placement, revealed: false });
    // Clear only our own registration: the next route may already have
    // registered by the time this one's cleanup runs.
    return () =>
      setStandalone((current) => (current?.owner === owner ? null : current));
  }, [owner, window, placement, setStandalone]);

  return standalone?.owner === owner && standalone.revealed;
}

/** The `addWindow` callback that `useAddWindow` and `useGrimoire` hand out. */
const useOpenWindow = () => {
  const open = useSetAtom(openWindowAtom);

  return useCallback(
    (
      appId: AppId,
      props: any,
      commandString?: string,
      customTitle?: string,
      spellId?: string,
    ) => {
      open({
        payload: { appId, props, commandString, customTitle, spellId },
        persisted: false,
      });
    },
    [open],
  );
};

/**
 * Lightweight hook that returns only the addWindow callback.
 * Does NOT subscribe to state changes — safe for use in deeply nested components
 * (e.g., MarkdownContent, NostrMention) that only need to open windows.
 */
export const useAddWindow = useOpenWindow;

// The Hook
export const useGrimoire = () => {
  const state = useAtomValue(activeGrimoireStateAtom);
  const dispatch = useSetAtom(activeGrimoireStateAtom);
  const isTemporary = useAtomValue(internalTemporaryStateAtom) !== null;
  const browserLocale = useLocale();

  const setState = useCallback(
    (updater: (prev: GrimoireState) => GrimoireState) => {
      dispatch({ type: "UPDATE", updater });
    },
    [dispatch],
  );

  // Initialize locale from browser if not set
  useEffect(() => {
    if (!state.locale) {
      setState((prev) => ({ ...prev, locale: browserLocale }));
    }
  }, [state.locale, browserLocale, setState]);

  const createWorkspace = useCallback(() => {
    setState((prev) => {
      const nextNumber = Logic.findLowestAvailableWorkspaceNumber(
        prev.workspaces,
      );
      return Logic.createWorkspace(prev, nextNumber);
    });
  }, [setState]);

  const createWorkspaceWithNumber = useCallback(
    (number: number) => {
      setState((prev) => {
        const currentWorkspace = prev.workspaces[prev.activeWorkspaceId];
        const shouldDeleteCurrent =
          currentWorkspace &&
          currentWorkspace.windowIds.length === 0 &&
          Object.keys(prev.workspaces).length > 1;
        const baseState = shouldDeleteCurrent
          ? Logic.deleteWorkspace(prev, prev.activeWorkspaceId)
          : prev;
        return Logic.createWorkspace(baseState, number);
      });
    },
    [setState],
  );

  const addWindow = useOpenWindow();

  const updateWindow = useCallback(
    (
      windowId: string,
      updates: Partial<
        Pick<
          WindowInstance,
          "props" | "title" | "customTitle" | "commandString" | "appId"
        >
      >,
    ) => {
      setState((prev) => Logic.updateWindow(prev, windowId, updates));
    },
    [setState],
  );

  const removeWindow = useCallback(
    (id: string) => {
      setState((prev) => Logic.removeWindow(prev, id));
    },
    [setState],
  );

  const moveWindowToWorkspace = useCallback(
    (windowId: string, targetWorkspaceId: string) => {
      setState((prev) =>
        Logic.moveWindowToWorkspace(prev, windowId, targetWorkspaceId),
      );
    },
    [setState],
  );

  const moveWindowToNewWorkspace = useCallback(
    (windowId: string): number => {
      let newWorkspaceNumber = 0;
      setState((prev) => {
        const result = Logic.moveWindowToNewWorkspace(prev, windowId);
        newWorkspaceNumber =
          result.state.workspaces[result.newWorkspaceId].number;
        return result.state;
      });
      return newWorkspaceNumber;
    },
    [setState],
  );

  const updateLayout = useCallback(
    (layout: any) => {
      setState((prev) => Logic.updateLayout(prev, layout));
    },
    [setState],
  );

  const setActiveWorkspace = useCallback(
    (id: string) => {
      setState((prev) => {
        if (!prev.workspaces[id] || prev.activeWorkspaceId === id) return prev;
        const currentWorkspace = prev.workspaces[prev.activeWorkspaceId];
        const shouldDeleteCurrent =
          currentWorkspace &&
          currentWorkspace.windowIds.length === 0 &&
          Object.keys(prev.workspaces).length > 1;
        const baseState = shouldDeleteCurrent
          ? Logic.deleteWorkspace(prev, prev.activeWorkspaceId)
          : prev;
        return { ...baseState, activeWorkspaceId: id };
      });
    },
    [setState],
  );

  const setActiveAccount = useCallback(
    (pubkey: string | undefined) => {
      setState((prev) => Logic.setActiveAccount(prev, pubkey));
    },
    [setState],
  );

  const setActiveAccountRelays = useCallback(
    (relays: RelayInfo[]) => {
      setState((prev) => Logic.setActiveAccountRelays(prev, relays));
    },
    [setState],
  );

  const setActiveAccountBlossomServers = useCallback(
    (blossomServers: string[]) => {
      setState((prev) =>
        Logic.setActiveAccountBlossomServers(prev, blossomServers),
      );
    },
    [setState],
  );

  const updateLayoutConfig = useCallback(
    (layoutConfig: Partial<LayoutConfig>) => {
      setState((prev) => Logic.updateLayoutConfig(prev, layoutConfig));
    },
    [setState],
  );

  const applyPresetLayout = useCallback(
    (preset: any) => {
      setState((prev) => Logic.applyPresetLayout(prev, preset));
    },
    [setState],
  );

  const updateWorkspaceLabel = useCallback(
    (workspaceId: string, label: string | undefined) => {
      setState((prev) => Logic.updateWorkspaceLabel(prev, workspaceId, label));
    },
    [setState],
  );

  const reorderWorkspaces = useCallback(
    (orderedIds: string[]) => {
      setState((prev) => Logic.reorderWorkspaces(prev, orderedIds));
    },
    [setState],
  );

  const loadSpellbook = useCallback(
    (spellbook: ParsedSpellbook) => {
      setState((prev) => SpellbookManager.loadSpellbook(prev, spellbook));
    },
    [setState],
  );

  const clearActiveSpellbook = useCallback(() => {
    setState((prev) => Logic.clearActiveSpellbook(prev));
  }, [setState]);

  const switchToTemporary = useCallback(
    (spellbook?: ParsedSpellbook) => {
      dispatch({ type: "START_TEMP", spellbook });
    },
    [dispatch],
  );

  const applyTemporaryToPersistent = useCallback(() => {
    dispatch({ type: "APPLY_TEMP" });
  }, [dispatch]);

  const discardTemporary = useCallback(() => {
    dispatch({ type: "DISCARD_TEMP" });
  }, [dispatch]);

  const setNWCConnection = useCallback(
    (connection: any) => {
      setState((prev) => Logic.setNWCConnection(prev, connection));
    },
    [setState],
  );

  const updateNWCBalance = useCallback(
    (balance: number) => {
      setState((prev) => Logic.updateNWCBalance(prev, balance));
    },
    [setState],
  );

  const updateNWCInfo = useCallback(
    (info: any) => {
      setState((prev) => Logic.updateNWCInfo(prev, info));
    },
    [setState],
  );

  const disconnectNWC = useCallback(() => {
    setState((prev) => Logic.disconnectNWC(prev));
  }, [setState]);

  const toggleWalletBalancesBlur = useCallback(() => {
    setState((prev) => Logic.toggleWalletBalancesBlur(prev));
  }, [setState]);

  return {
    state,
    isTemporary,
    locale: state.locale || browserLocale,
    activeWorkspace: state.workspaces[state.activeWorkspaceId],
    createWorkspace,
    createWorkspaceWithNumber,
    addWindow,
    updateWindow,
    removeWindow,
    moveWindowToWorkspace,
    moveWindowToNewWorkspace,
    updateLayout,
    setActiveWorkspace,
    setActiveAccount,
    setActiveAccountRelays,
    setActiveAccountBlossomServers,
    updateLayoutConfig,
    applyPresetLayout,
    updateWorkspaceLabel,
    reorderWorkspaces,
    loadSpellbook,
    clearActiveSpellbook,
    switchToTemporary,
    applyTemporaryToPersistent,
    discardTemporary,
    setNWCConnection,
    updateNWCBalance,
    updateNWCInfo,
    disconnectNWC,
    toggleWalletBalancesBlur,
  };
};
