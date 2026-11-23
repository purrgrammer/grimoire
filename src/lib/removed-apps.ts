/**
 * Apps grimoire no longer has, by the appId a window was saved under.
 *
 * A window outlives the app that opened it: `grimoire_v6` persists every open
 * window, and a published spellbook (kind 30777) carries windows inside its
 * layout for anyone who loads it. So an appId that is gone still arrives —
 * from this device's storage and from other people's events — and has to land
 * somewhere that neither runs the removed code nor crashes the workspace.
 *
 * Deliberately not rewritten into a different app: a window that silently
 * became something else would show the reader content they never asked for.
 * The notice names what was removed and, where one exists, the command that
 * replaced it, and leaves running that command to the reader.
 */
export interface RemovedApp {
  /** The command the window was opened with. */
  command: string;
  /** The supported command that covers what this one did, if any. */
  replacement?: string;
}

const REMOVED_APPS: Readonly<Record<string, RemovedApp>> = {
  ai: { command: "ai" },
  agent: { command: "agent" },
  concord: { command: "concord", replacement: "chat" },
};

/** The removed app a saved window names, or undefined for a supported one. */
export function getRemovedApp(appId: string): RemovedApp | undefined {
  return Object.prototype.hasOwnProperty.call(REMOVED_APPS, appId)
    ? REMOVED_APPS[appId]
    : undefined;
}
