import { v4 as uuidv4 } from "uuid";
import type { MosaicNode } from "react-mosaic-component";
import {
  GrimoireState,
  WindowInstance,
  RelayInfo,
  LayoutConfig,
  NWCConnection,
} from "@/types/app";
import { insertWindow } from "@/lib/layout-utils";
import { applyPresetToLayout, type LayoutPreset } from "@/lib/layout-presets";

/**
 * Finds the lowest available workspace number.
 * - If workspaces have numbers [1, 2, 4], returns 3
 * - If workspaces have numbers [1, 2, 3], returns 4
 * - If workspaces have numbers [2, 3, 4], returns 1
 */
export const findLowestAvailableWorkspaceNumber = (
  workspaces: Record<string, { number: number }>,
): number => {
  // Get all workspace numbers as a Set for O(1) lookup
  const numbers = new Set(Object.values(workspaces).map((ws) => ws.number));

  // If no workspaces exist, start at 1
  if (numbers.size === 0) return 1;

  // Find first gap starting from 1
  let candidate = 1;
  while (numbers.has(candidate)) {
    candidate++;
  }

  return candidate;
};

/**
 * Creates a new, empty workspace.
 */
export const createWorkspace = (
  state: GrimoireState,
  number: number,
  label?: string,
): GrimoireState => {
  const newId = uuidv4();
  return {
    ...state,
    activeWorkspaceId: newId,
    workspaces: {
      ...state.workspaces,
      [newId]: {
        id: newId,
        number,
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
  payload: {
    appId: string;
    props: any;
    commandString?: string;
    customTitle?: string;
    spellId?: string;
  },
): GrimoireState => {
  const activeId = state.activeWorkspaceId;
  const ws = state.workspaces[activeId];
  const newWindowId = uuidv4();
  const newWindow: WindowInstance = {
    id: newWindowId,
    appId: payload.appId as any,
    customTitle: payload.customTitle,
    props: payload.props,
    commandString: payload.commandString,
    spellId: payload.spellId,
  };

  // Insert window using global layout configuration
  const newLayout = insertWindow(ws.layout, newWindowId, state.layoutConfig);

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

/**
 * Creates a new workspace and moves a window to it.
 * Returns an object with the new state and the new workspace ID.
 */
export const moveWindowToNewWorkspace = (
  state: GrimoireState,
  windowId: string,
): { state: GrimoireState; newWorkspaceId: string } => {
  const currentId = state.activeWorkspaceId;
  const currentWs = state.workspaces[currentId];

  // Find next available workspace number
  const nextNumber = findLowestAvailableWorkspaceNumber(state.workspaces);

  // Create new workspace ID
  const newWorkspaceId = uuidv4();

  // Remove window from current workspace
  const newCurrentLayout = removeFromLayout(currentWs.layout, windowId);
  const newCurrentWindowIds = currentWs.windowIds.filter(
    (id) => id !== windowId,
  );

  // Create new state with new workspace and moved window
  const newState: GrimoireState = {
    ...state,
    activeWorkspaceId: newWorkspaceId,
    workspaces: {
      ...state.workspaces,
      [currentId]: {
        ...currentWs,
        layout: newCurrentLayout,
        windowIds: newCurrentWindowIds,
      },
      [newWorkspaceId]: {
        id: newWorkspaceId,
        number: nextNumber,
        layout: windowId,
        windowIds: [windowId],
      },
    },
  };

  return { state: newState, newWorkspaceId };
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
  relays: RelayInfo[],
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

/**
 * Updates the blossom server list for the active account.
 */
export const setActiveAccountBlossomServers = (
  state: GrimoireState,
  blossomServers: string[],
): GrimoireState => {
  if (!state.activeAccount) {
    return state;
  }

  // If blossom servers reference hasn't changed, return state unchanged
  if (state.activeAccount.blossomServers === blossomServers) {
    return state;
  }

  return {
    ...state,
    activeAccount: {
      ...state.activeAccount,
      blossomServers,
    },
  };
};

/**
 * Deletes a workspace by ID.
 * Cannot delete the last remaining workspace.
 * Does NOT change activeWorkspaceId - caller is responsible for workspace navigation.
 */
export const deleteWorkspace = (
  state: GrimoireState,
  workspaceId: string,
): GrimoireState => {
  const workspaceIds = Object.keys(state.workspaces);

  // Don't delete if it's the only workspace
  if (workspaceIds.length <= 1) {
    return state;
  }

  // Don't delete if workspace doesn't exist
  if (!state.workspaces[workspaceId]) {
    return state;
  }

  // Remove the workspace (don't touch activeWorkspaceId - that's the caller's job)
  const { [workspaceId]: _removed, ...remainingWorkspaces } = state.workspaces;

  return {
    ...state,
    workspaces: remainingWorkspaces,
  };
};

/**
 * Updates an existing window with new properties.
 * Allows updating props, title, customTitle, commandString, and even appId (which changes the viewer type).
 */
export const updateWindow = (
  state: GrimoireState,
  windowId: string,
  updates: Partial<
    Pick<
      WindowInstance,
      "props" | "title" | "customTitle" | "commandString" | "appId"
    >
  >,
): GrimoireState => {
  const window = state.windows[windowId];
  if (!window) {
    return state; // Window doesn't exist, return unchanged
  }

  return {
    ...state,
    windows: {
      ...state.windows,
      [windowId]: { ...window, ...updates },
    },
  };
};

/**
 * Updates the global layout configuration.
 * Controls how new windows are inserted across all workspaces.
 */
export const updateLayoutConfig = (
  state: GrimoireState,
  layoutConfig: Partial<LayoutConfig>,
): GrimoireState => {
  return {
    ...state,
    layoutConfig: {
      ...state.layoutConfig,
      ...layoutConfig,
    },
  };
};

/**
 * Applies a preset layout to the active workspace.
 * Reorganizes existing windows according to the preset template.
 */
export const applyPresetLayout = (
  state: GrimoireState,
  preset: LayoutPreset,
): GrimoireState => {
  const activeId = state.activeWorkspaceId;
  const ws = state.workspaces[activeId];

  try {
    // Apply preset to current layout
    const newLayout = applyPresetToLayout(ws.layout, preset);

    return {
      ...state,
      workspaces: {
        ...state.workspaces,
        [activeId]: {
          ...ws,
          layout: newLayout,
        },
      },
    };
  } catch (error) {
    // If preset application fails (not enough windows, etc.), return unchanged
    console.error("[Layout] Failed to apply preset:", error);
    return state;
  }
};

/**
 * Updates the label of an existing workspace.
 * Labels are user-friendly names that appear alongside workspace numbers.
 */
export const updateWorkspaceLabel = (
  state: GrimoireState,
  workspaceId: string,
  label: string | undefined,
): GrimoireState => {
  const workspace = state.workspaces[workspaceId];
  if (!workspace) {
    return state; // Workspace doesn't exist, return unchanged
  }

  // Normalize label: trim and treat empty strings as undefined
  const normalizedLabel = label?.trim() || undefined;

  // If label hasn't changed, return state unchanged (optimization)
  if (workspace.label === normalizedLabel) {
    return state;
  }

  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [workspaceId]: {
        ...workspace,
        label: normalizedLabel,
      },
    },
  };
};

/**
 * Reorders workspaces based on a list of workspace IDs.
 * Reassigns workspace numbers starting from 1 based on the provided order.
 */
export const reorderWorkspaces = (
  state: GrimoireState,
  orderedIds: string[],
): GrimoireState => {
  const currentWorkspaces = Object.values(state.workspaces);
  const orderedSet = new Set(orderedIds);

  // Find any workspaces not included in the ordered list (should generally be empty if all are passed)
  const remainingWorkspaces = currentWorkspaces
    .filter((ws) => !orderedSet.has(ws.id))
    .sort((a, b) => a.number - b.number);

  const newWorkspaces = { ...state.workspaces };
  let counter = 1;

  // Assign new numbers to ordered IDs
  for (const id of orderedIds) {
    if (newWorkspaces[id]) {
      newWorkspaces[id] = {
        ...newWorkspaces[id],
        number: counter++,
      };
    }
  }

  // Assign new numbers to remaining IDs
  for (const ws of remainingWorkspaces) {
    newWorkspaces[ws.id] = {
      ...newWorkspaces[ws.id],
      number: counter++,
    };
  }

  return {
    ...state,
    workspaces: newWorkspaces,
  };
};

/**
 * Updates the list of event kinds that should be displayed in compact mode.
 */
export const setCompactModeKinds = (
  state: GrimoireState,
  kinds: number[],
): GrimoireState => {
  return {
    ...state,
    compactModeKinds: kinds,
  };
};

/**
 * Clears the currently active spellbook tracking.
 */
export const clearActiveSpellbook = (state: GrimoireState): GrimoireState => {
  return {
    ...state,
    activeSpellbook: undefined,
  };
};

/**
 * Sets or updates the NWC (Nostr Wallet Connect) connection.
 */
export const setNWCConnection = (
  state: GrimoireState,
  connection: NWCConnection,
): GrimoireState => {
  return {
    ...state,
    nwcConnection: {
      ...connection,
      lastConnected: Date.now(),
    },
  };
};

/**
 * Updates the balance of the current NWC connection.
 */
export const updateNWCBalance = (
  state: GrimoireState,
  balance: number,
): GrimoireState => {
  if (!state.nwcConnection) {
    return state;
  }

  return {
    ...state,
    nwcConnection: {
      ...state.nwcConnection,
      balance,
    },
  };
};

/**
 * Updates the info of the current NWC connection.
 */
export const updateNWCInfo = (
  state: GrimoireState,
  info: NWCConnection["info"],
): GrimoireState => {
  if (!state.nwcConnection) {
    return state;
  }

  return {
    ...state,
    nwcConnection: {
      ...state.nwcConnection,
      info,
    },
  };
};

/**
 * Disconnects and clears the current NWC connection.
 */
export const disconnectNWC = (state: GrimoireState): GrimoireState => {
  return {
    ...state,
    nwcConnection: undefined,
  };
};

export const toggleWalletBalancesBlur = (
  state: GrimoireState,
): GrimoireState => {
  return {
    ...state,
    walletBalancesBlurred: !state.walletBalancesBlurred,
  };
};
