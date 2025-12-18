import { useEffect, useCallback } from "react";
import { useAtom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import {
  GrimoireState,
  AppId,
  WindowInstance,
  LayoutConfig,
} from "@/types/app";
import { useLocale } from "@/hooks/useLocale";
import * as Logic from "./logic";
import { CURRENT_VERSION, validateState, migrateState } from "@/lib/migrations";
import { toast } from "sonner";

// Initial State Definition - Empty canvas on first load
const initialState: GrimoireState = {
  __version: CURRENT_VERSION,
  windows: {},
  activeWorkspaceId: "default",
  workspaces: {
    default: {
      id: "default",
      number: 1,
      windowIds: [],
      layout: null,
      layoutConfig: {
        insertionMode: "smart", // Smart auto-balancing by default
        splitPercentage: 50, // Equal split
        insertionPosition: "second", // New windows on right/bottom
        autoPreset: undefined, // No preset maintenance
      },
    },
  },
};

// Custom storage with error handling and migrations
const storage = createJSONStorage<GrimoireState>(() => ({
  getItem: (key: string) => {
    try {
      const value = localStorage.getItem(key);
      if (!value) return null;

      // Parse and validate/migrate state
      const parsed = JSON.parse(value);
      const storedVersion = parsed.__version || 5;

      // Check if migration is needed
      if (storedVersion < CURRENT_VERSION) {
        console.log(
          `[Storage] State version outdated (v${storedVersion}), migrating...`,
        );
        const migrated = migrateState(parsed);

        // Save migrated state back to localStorage
        localStorage.setItem(key, JSON.stringify(migrated));

        toast.success("State Updated", {
          description: `Migrated from v${storedVersion} to v${CURRENT_VERSION}`,
          duration: 3000,
        });

        return JSON.stringify(migrated);
      }

      // Validate current version state
      if (!validateState(parsed)) {
        console.warn(
          "[Storage] State validation failed, resetting to initial state",
        );
        toast.error("State Corrupted", {
          description: "Your state was corrupted and has been reset.",
          duration: 5000,
        });
        return null; // Return null to use initialState
      }

      return value;
    } catch (error) {
      console.error("[Storage] Failed to read from localStorage:", error);
      toast.error("Failed to Load State", {
        description: "Using default state.",
        duration: 5000,
      });
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error("Failed to write to localStorage:", error);
      // Handle quota exceeded or other errors
      if (
        error instanceof DOMException &&
        error.name === "QuotaExceededError"
      ) {
        console.error(
          "localStorage quota exceeded. State will not be persisted.",
        );
        toast.error("Storage Full", {
          description: "Could not save state. Storage quota exceeded.",
          duration: 5000,
        });
      }
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

// Persistence Atom with custom storage
export const grimoireStateAtom = atomWithStorage<GrimoireState>(
  "grimoire_v6",
  initialState,
  storage,
);

// The Hook
export const useGrimoire = () => {
  const [state, setState] = useAtom(grimoireStateAtom);
  const browserLocale = useLocale();

  // Initialize locale from browser if not set (moved to useEffect to avoid race condition)
  useEffect(() => {
    if (!state.locale) {
      setState((prev) => ({ ...prev, locale: browserLocale }));
    }
  }, [state.locale, browserLocale, setState]);

  // Wrap all callbacks in useCallback for stable references
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
        // Check if we're leaving an empty workspace and should auto-remove it
        const currentWorkspace = prev.workspaces[prev.activeWorkspaceId];
        const shouldDeleteCurrent =
          currentWorkspace &&
          currentWorkspace.windowIds.length === 0 &&
          Object.keys(prev.workspaces).length > 1;

        if (shouldDeleteCurrent) {
          // Delete the empty workspace, then create new one
          const afterDelete = Logic.deleteWorkspace(
            prev,
            prev.activeWorkspaceId,
          );
          return Logic.createWorkspace(afterDelete, number);
        }

        // Normal workspace creation
        return Logic.createWorkspace(prev, number);
      });
    },
    [setState],
  );

  const addWindow = useCallback(
    (appId: AppId, props: any, commandString?: string, customTitle?: string) =>
      setState((prev) =>
        Logic.addWindow(prev, {
          appId,
          props,
          commandString,
          customTitle,
        }),
      ),
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
    ) => setState((prev) => Logic.updateWindow(prev, windowId, updates)),
    [setState],
  );

  const removeWindow = useCallback(
    (id: string) => setState((prev) => Logic.removeWindow(prev, id)),
    [setState],
  );

  const moveWindowToWorkspace = useCallback(
    (windowId: string, targetWorkspaceId: string) =>
      setState((prev) =>
        Logic.moveWindowToWorkspace(prev, windowId, targetWorkspaceId),
      ),
    [setState],
  );

  const updateLayout = useCallback(
    (layout: any) => setState((prev) => Logic.updateLayout(prev, layout)),
    [setState],
  );

  const setActiveWorkspace = useCallback(
    (id: string) =>
      setState((prev) => {
        // Validate target workspace exists
        if (!prev.workspaces[id]) {
          console.warn(`Cannot switch to non-existent workspace: ${id}`);
          return prev;
        }

        // If not actually switching, return unchanged
        if (prev.activeWorkspaceId === id) {
          return prev;
        }

        // Check if we're leaving an empty workspace and should auto-remove it
        const currentWorkspace = prev.workspaces[prev.activeWorkspaceId];
        const shouldDeleteCurrent =
          currentWorkspace &&
          currentWorkspace.windowIds.length === 0 &&
          Object.keys(prev.workspaces).length > 1;

        if (shouldDeleteCurrent) {
          // Delete the empty workspace, then switch to target
          const afterDelete = Logic.deleteWorkspace(
            prev,
            prev.activeWorkspaceId,
          );
          return { ...afterDelete, activeWorkspaceId: id };
        }

        // Normal workspace switch
        return { ...prev, activeWorkspaceId: id };
      }),
    [setState],
  );

  const setActiveAccount = useCallback(
    (pubkey: string | undefined) =>
      setState((prev) => Logic.setActiveAccount(prev, pubkey)),
    [setState],
  );

  const setActiveAccountRelays = useCallback(
    (relays: any) =>
      setState((prev) => Logic.setActiveAccountRelays(prev, relays)),
    [setState],
  );

  const updateLayoutConfig = useCallback(
    (layoutConfig: Partial<LayoutConfig>) =>
      setState((prev) => Logic.updateLayoutConfig(prev, layoutConfig)),
    [setState],
  );

  const applyPresetLayout = useCallback(
    (preset: any) => setState((prev) => Logic.applyPresetLayout(prev, preset)),
    [setState],
  );

  return {
    state,
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
    updateLayoutConfig,
    applyPresetLayout,
  };
};
