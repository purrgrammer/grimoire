import { v4 as uuidv4 } from "uuid";
import type { MosaicNode } from "react-mosaic-component";
import { GrimoireState, WindowInstance, UserRelays } from "@/types/app";

/**
 * Creates a new, empty workspace.
 */
export const createWorkspace = (
  state: GrimoireState,
  label: string,
): GrimoireState => {
  const newId = uuidv4();
  return {
    ...state,
    activeWorkspaceId: newId,
    workspaces: {
      ...state.workspaces,
      [newId]: {
        id: newId,
        label,
        layout: null,
        windowIds: [],
      },
    },
  };
};

/**
 * Adds a window to the global store and to the active workspace.
 */
export const addWindow = (
  state: GrimoireState,
  payload: { appId: string; title: string; props: any },
): GrimoireState => {
  const activeId = state.activeWorkspaceId;
  const ws = state.workspaces[activeId];
  const newWindowId = uuidv4();
  const newWindow: WindowInstance = {
    id: newWindowId,
    appId: payload.appId as any,
    title: payload.title,
    props: payload.props,
  };

  // Simple Binary Split Logic
  let newLayout: MosaicNode<string>;
  if (ws.layout === null) {
    newLayout = newWindowId;
  } else {
    newLayout = {
      direction: "row",
      first: ws.layout,
      second: newWindowId,
      splitPercentage: 50,
    };
  }

  return {
    ...state,
    windows: {
      ...state.windows,
      [newWindowId]: newWindow,
    },
    workspaces: {
      ...state.workspaces,
      [activeId]: {
        ...ws,
        layout: newLayout,
        windowIds: [...ws.windowIds, newWindowId],
      },
    },
  };
};

/**
 * Recursively removes a window from the layout tree.
 */
const removeFromLayout = (
  layout: MosaicNode<string> | null,
  windowId: string,
): MosaicNode<string> | null => {
  if (layout === null) {
    return null;
  }

  if (typeof layout === "string") {
    return layout === windowId ? null : layout;
  }

  const firstResult = removeFromLayout(layout.first, windowId);
  const secondResult = removeFromLayout(layout.second, windowId);

  if (firstResult === null && secondResult !== null) {
    return secondResult;
  }

  if (secondResult === null && firstResult !== null) {
    return firstResult;
  }

  if (firstResult === null && secondResult === null) {
    return null;
  }

  if (firstResult === layout.first && secondResult === layout.second) {
    return layout;
  }

  return {
    ...layout,
    first: firstResult!,
    second: secondResult!,
  };
};

/**
 * Removes a window from the active workspace's layout and windowIds.
 * Also removes the window from the global windows object.
 */
export const removeWindow = (
  state: GrimoireState,
  windowId: string,
): GrimoireState => {
  const activeId = state.activeWorkspaceId;
  const ws = state.workspaces[activeId];

  const newLayout = removeFromLayout(ws.layout, windowId);
  const newWindowIds = ws.windowIds.filter((id) => id !== windowId);

  // Remove from global windows object
  const { [windowId]: _removedWindow, ...remainingWindows } = state.windows;

  return {
    ...state,
    windows: remainingWindows,
    workspaces: {
      ...state.workspaces,
      [activeId]: {
        ...ws,
        layout: newLayout,
        windowIds: newWindowIds,
      },
    },
  };
};

/**
 * Moves a window from current workspace to target workspace.
 */
export const moveWindowToWorkspace = (
  state: GrimoireState,
  windowId: string,
  targetWorkspaceId: string,
): GrimoireState => {
  const currentId = state.activeWorkspaceId;
  const currentWs = state.workspaces[currentId];
  const targetWs = state.workspaces[targetWorkspaceId];

  if (!targetWs) {
    return state;
  }

  const newCurrentLayout = removeFromLayout(currentWs.layout, windowId);
  const newCurrentWindowIds = currentWs.windowIds.filter(
    (id) => id !== windowId,
  );

  let newTargetLayout: MosaicNode<string>;
  if (targetWs.layout === null) {
    newTargetLayout = windowId;
  } else {
    newTargetLayout = {
      direction: "row",
      first: targetWs.layout,
      second: windowId,
      splitPercentage: 50,
    };
  }

  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [currentId]: {
        ...currentWs,
        layout: newCurrentLayout,
        windowIds: newCurrentWindowIds,
      },
      [targetWorkspaceId]: {
        ...targetWs,
        layout: newTargetLayout,
        windowIds: [...targetWs.windowIds, windowId],
      },
    },
  };
};

export const updateLayout = (
  state: GrimoireState,
  layout: MosaicNode<string> | null,
): GrimoireState => {
  const activeId = state.activeWorkspaceId;
  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [activeId]: {
        ...state.workspaces[activeId],
        layout,
      },
    },
  };
};

/**
 * Sets the active account (pubkey).
 */
export const setActiveAccount = (
  state: GrimoireState,
  pubkey: string | undefined,
): GrimoireState => {
  // If pubkey is already set to the same value, return state unchanged
  if (state.activeAccount?.pubkey === pubkey) {
    return state;
  }

  if (!pubkey) {
    return {
      ...state,
      activeAccount: undefined,
    };
  }
  return {
    ...state,
    activeAccount: {
      pubkey,
      relays: state.activeAccount?.relays,
    },
  };
};

/**
 * Updates the relay list for the active account.
 */
export const setActiveAccountRelays = (
  state: GrimoireState,
  relays: UserRelays,
): GrimoireState => {
  if (!state.activeAccount) {
    return state;
  }

  // If relays reference hasn't changed, return state unchanged
  if (state.activeAccount.relays === relays) {
    return state;
  }

  return {
    ...state,
    activeAccount: {
      ...state.activeAccount,
      relays,
    },
  };
};
