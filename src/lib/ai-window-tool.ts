import { resolveCommand } from "./ai-commands";
import { refuseIfNeeded } from "./ai-tools";

import type { ToolExecutor } from "./ai-registry";
import type { AppId } from "@/types/app";

/**
 * The executor behind `grimoire.window`, which needs application state.
 *
 * Every other tool is pure and lives beside its schema in the registry; this
 * one adds a window, so the caller supplies `addWindow` — Hex's viewer from its
 * own render, the WebMCP host from the shell. Shared because both surfaces
 * must refuse the same commands: the refusal list is the safety property, and
 * two copies of it drift.
 */
export function createWindowExecutor(
  addWindow: (
    appId: AppId,
    // Props are per-app and parsed from the command line; the parser owns
    // their shape, which is why the state hook takes them untyped too.
    props: unknown,
    commandString?: string,
    customTitle?: string,
  ) => void,
  pubkey?: string,
): ToolExecutor {
  return async (args: unknown) => {
    const command = (args as { command?: unknown })?.command;
    if (typeof command !== "string") {
      return { error: "command must be a string." };
    }
    const refusal = refuseIfNeeded(command);
    if (refusal) return { error: refusal };

    // Reported rather than thrown: a command that will not parse is an answer
    // the caller can act on, and on the WebMCP surface a rejection reaches the
    // agent with no reason attached at all.
    try {
      const resolved = await resolveCommand(command, pubkey);
      addWindow(
        resolved.appId,
        resolved.props,
        resolved.commandString,
        resolved.customTitle,
      );
      return { opened: command, appId: resolved.appId };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
