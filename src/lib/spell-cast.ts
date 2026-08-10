import type { AppId } from "@/types/app";
import { parseAndExecuteCommand } from "./command-parser";

/**
 * Parse and execute a spell command string, returning the appId and props
 * needed to open a window.
 *
 * Returns null if the command is not recognized.
 */
export async function parseSpellCommand(
  commandLine: string,
): Promise<{ appId: AppId; props: any; commandString: string } | null> {
  // The whole pipeline, not `argParser` alone: it is what honours global flags
  // and what applies (and strips) an appId override. Hand-rolling the parse also
  // meant losing shell-quote tokenization, so a quoted argument split on spaces.
  const parsed = await parseAndExecuteCommand(commandLine.trim());
  if (parsed.error || !parsed.command || !parsed.props) return null;

  return {
    appId: parsed.command.appId,
    props: parsed.props,
    commandString: commandLine,
  };
}
