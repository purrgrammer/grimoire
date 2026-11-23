import { executeCommandParser, parseCommandInput } from "./command-parser";

import type { AppId } from "@/types/app";
import { manPages } from "@/types/man";

/**
 * Grimoire commands proposed by an agent (WebMCP's `grimoire.command` and
 * `grimoire.window`).
 *
 * The model writes commands; the page decides whether they may run. Two rules
 * make that safe. Only names in `manPages` are recognised at all, so an
 * invented command is inert. And commands that act on the user's behalf are
 * refused outright — see `PROPOSAL_DENIED`.
 */

/**
 * Apps that publish, spend, or sign. A model reading a note is reading
 * untrusted text; a note that says "zap this" must not be able to cause a zap.
 * These windows are still reachable — the user opens them and presses send.
 */
export const PROPOSAL_DENIED: ReadonlySet<AppId> = new Set([
  "post",
  "zap",
  "wallet",
]);

/**
 * Commands a model may read up on, open, or offer — everything but the ones
 * that act on the user's behalf. Sorted, because it is also a schema enum and a
 * stable order keeps prompt caches warm.
 */
export const READABLE_COMMANDS: string[] = Object.keys(manPages)
  .filter((name) => !PROPOSAL_DENIED.has(manPages[name].appId))
  .sort();

export interface ProposedCommand {
  /** The line as written, shown on the chip. */
  command: string;
  appId: AppId;
  /** Command name, for rendering it the way the palette does. */
  name: string;
  /** Arguments as written, i.e. the line minus the name. */
  args: string;
  /** First sentence of the man page, as the palette shows. */
  description?: string;
  /** Set when the command may not be run automatically. */
  refusal?: string;
}

/**
 * Validate one proposed command line. Returns undefined when the command is
 * not one grimoire has, so nothing unknown is ever offered.
 */
export function proposeCommand(line: string): ProposedCommand | undefined {
  const command = line.trim();
  if (!command || command.startsWith("#")) return undefined;

  const parsed = parseCommandInput(command);
  const entry = parsed.commandName ? manPages[parsed.commandName] : undefined;
  if (!entry) return undefined;

  return {
    command,
    appId: entry.appId,
    name: entry.name,
    args: command.slice(parsed.commandName.length).trim(),
    ...(entry.description
      ? { description: `${entry.description.split(".")[0]}.` }
      : {}),
    ...(PROPOSAL_DENIED.has(entry.appId)
      ? {
          refusal: `${parsed.commandName} acts on your behalf, so it only opens when you run it yourself.`,
        }
      : {}),
  };
}

export interface ResolvedCommand {
  appId: AppId;
  props: unknown;
  commandString: string;
  customTitle?: string;
}

/**
 * Run the parser chain for a command line — the same path the palette uses,
 * so NIP-05 resolution and global flags behave identically. Throws on a
 * command that cannot be parsed or must not run.
 */
export async function resolveCommand(
  command: string,
  activeAccountPubkey?: string,
): Promise<ResolvedCommand> {
  const proposed = proposeCommand(command);
  if (!proposed) {
    throw new Error(`Not a grimoire command: ${command}`);
  }
  if (proposed.refusal) {
    throw new Error(proposed.refusal);
  }

  const parsed = parseCommandInput(command);
  const result = await executeCommandParser(parsed, activeAccountPubkey);
  if (result.error || !result.props) {
    throw new Error(result.error || `Could not parse: ${command}`);
  }

  return {
    appId: proposed.appId,
    props: result.props,
    commandString: command,
    ...(result.globalFlags?.windowProps?.title
      ? { customTitle: result.globalFlags.windowProps.title }
      : {}),
  };
}
