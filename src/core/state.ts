import { useEffect } from "react";
import { useAtom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { GrimoireState, AppId, WindowInstance } from "@/types/app";
import { useLocale } from "@/hooks/useLocale";
import * as Logic from "./logic";

// Initial State Definition - Empty canvas on first load
const initialState: GrimoireState = {
  windows: {},
  activeWorkspaceId: "default",
  workspaces: {
    default: {
      id: "default",
      label: "1",
      windowIds: [],
      layout: null,
    },
  },
};

// Custom storage with error handling
const storage = createJSONStorage<GrimoireState>(() => ({
  getItem: (key: string) => {
    try {
      const value = localStorage.getItem(key);
      return value;
    } catch (error) {
      console.warn("Failed to read from localStorage:", error);
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

  return {
    state,
    locale: state.locale || browserLocale,
    activeWorkspace: state.workspaces[state.activeWorkspaceId],
    createWorkspace: () => {
      const count = Object.keys(state.workspaces).length + 1;
      setState((prev) => Logic.createWorkspace(prev, count.toString()));
    },
    addWindow: (appId: AppId, props: any, title?: string, commandString?: string) =>
      setState((prev) =>
        Logic.addWindow(prev, {
          appId,
          props,
          title: title || appId.toUpperCase(),
          commandString,
        }),
      ),
    updateWindow: (windowId: string, updates: Partial<Pick<WindowInstance, "props" | "title" | "commandString" | "appId">>) =>
      setState((prev) => Logic.updateWindow(prev, windowId, updates)),
    removeWindow: (id: string) =>
      setState((prev) => Logic.removeWindow(prev, id)),
    moveWindowToWorkspace: (windowId: string, targetWorkspaceId: string) =>
      setState((prev) =>
        Logic.moveWindowToWorkspace(prev, windowId, targetWorkspaceId),
      ),
    updateLayout: (layout: any) =>
      setState((prev) => Logic.updateLayout(prev, layout)),
    setActiveWorkspace: (id: string) =>
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
    setActiveAccount: (pubkey: string | undefined) =>
      setState((prev) => Logic.setActiveAccount(prev, pubkey)),
    setActiveAccountRelays: (relays: any) =>
      setState((prev) => Logic.setActiveAccountRelays(prev, relays)),
  };
};
