import { atom } from "jotai";

/**
 * Edit mode state for CommandLauncher.
 * When set, CommandLauncher opens in edit mode for the specified window.
 */
export interface EditModeState {
  windowId: string;
  initialCommand: string;
}

/**
 * Atom to control edit mode in CommandLauncher.
 * Set this to trigger edit mode, null for normal create mode.
 */
export const commandLauncherEditModeAtom = atom<EditModeState | null>(null);
