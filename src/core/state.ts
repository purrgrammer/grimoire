import { useEffect, useCallback } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
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
  compactModeKinds: [6, 7, 16, 9735],
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
        console.log(
          `[Storage] State version outdated (v${storedVersion}), migrating...`,
        );
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

  const addWindow = useCallback(
    (
      appId: AppId,
      props: any,
      commandString?: string,
      customTitle?: string,
      spellId?: string,
    ) => {
      setState((prev) =>
        Logic.addWindow(prev, {
          appId,
          props,
          commandString,
          customTitle,
          spellId,
        }),
      );
    },
    [setState],
  );

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

  const setCompactModeKinds = useCallback(
    (kinds: number[]) => {
      setState((prev) => Logic.setCompactModeKinds(prev, kinds));
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
    updateLayout,
    setActiveWorkspace,
    setActiveAccount,
    setActiveAccountRelays,
    setActiveAccountBlossomServers,
    updateLayoutConfig,
    applyPresetLayout,
    updateWorkspaceLabel,
    reorderWorkspaces,
    setCompactModeKinds,
    loadSpellbook,
    clearActiveSpellbook,
    switchToTemporary,
    applyTemporaryToPersistent,
    discardTemporary,
  };
};
