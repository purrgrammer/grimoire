import { parse as parseShellTokens } from "shell-quote";
import { manPages } from "@/types/man";
import type { AppId } from "@/types/app";
import { extractGlobalFlagsFromTokens, type GlobalFlags } from "./global-flags";

export interface ParsedCommand {
  commandName: string;
  args: string[];
  fullInput: string;
  command?: (typeof manPages)[string];
  props?: any;
  error?: string;
  globalFlags?: GlobalFlags;
}

/**
 * Parses a command string into its components.
 * Returns basic parsing info without executing argParser.
 *
 * Now supports:
 * - Proper quote handling via shell-quote
 * - Global flag extraction (--title, etc.)
 */
export function parseCommandInput(input: string): ParsedCommand {
  const fullInput = input.trim();

  // Pre-process: Escape $ to prevent shell-quote from expanding variables
  // We use $me and $contacts as literal syntax, not shell variables
  const DOLLAR_PLACEHOLDER = "___DOLLAR___";
  const escapedInput = fullInput.replace(/\$/g, DOLLAR_PLACEHOLDER);

  // Tokenize with quote support (on escaped input)
  const rawTokens = parseShellTokens(escapedInput);

  // Convert tokens to strings and restore $ characters
  // shell-quote returns { comment: 'text' } for #text — preserve as #text
  const tokens = rawTokens.map((token) => {
    let str: string;
    if (typeof token === "string") {
      str = token;
    } else if (
      token &&
      typeof token === "object" &&
      "comment" in token &&
      typeof token.comment === "string"
    ) {
      str = `#${token.comment}`;
    } else if (
      token &&
      typeof token === "object" &&
      "op" in token &&
      token.op === "glob" &&
      "pattern" in token &&
      typeof token.pattern === "string"
    ) {
      // shell-quote turns `?` and `*` into { op: "glob", pattern }. Grimoire
      // has no globbing, and String() on it yields "[object Object]" — which
      // silently ate the `?` from any question typed at a command.
      str = token.pattern;
    } else if (
      token &&
      typeof token === "object" &&
      "op" in token &&
      typeof token.op === "string"
    ) {
      // Operators (`&&`, `|`, `>`) are literal text here for the same reason.
      str = token.op;
    } else {
      str = String(token);
    }
    return str.replace(new RegExp(DOLLAR_PLACEHOLDER, "g"), "$");
  });

  // Extract global flags before command parsing
  let globalFlags: GlobalFlags = {};
  let remainingTokens = tokens;

  try {
    const extracted = extractGlobalFlagsFromTokens(tokens);
    globalFlags = extracted.globalFlags;
    remainingTokens = extracted.remainingTokens;
  } catch (error) {
    // Global flag parsing error
    return {
      commandName: "",
      args: [],
      fullInput,
      error:
        error instanceof Error ? error.message : "Failed to parse global flags",
    };
  }

  // Parse command from remaining tokens
  const commandName = remainingTokens[0]?.toLowerCase() || "";
  const args = remainingTokens.slice(1);

  const command = commandName && manPages[commandName];

  if (!commandName) {
    return {
      commandName: "",
      args: [],
      fullInput: "",
      globalFlags,
      error: "No command provided",
    };
  }

  if (!command) {
    return {
      commandName,
      args,
      fullInput,
      globalFlags,
      error: `Unknown command: ${commandName}`,
    };
  }

  return {
    commandName,
    args,
    fullInput,
    command,
    globalFlags,
  };
}

/**
 * Key an argParser may return alongside its props to open a different app.
 *
 * `app <archetype>` needs it: an archetype nothing installed handles falls back
 * to grimoire's own built-in, which is a different appId with different props.
 * The key is lifted out here, so no window or spellbook ever sees it, and the
 * returned `command` is a copy carrying the substituted appId — every consumer
 * already reads `parsed.command.appId`, so none of them needs to know.
 */
export const APP_ID_OVERRIDE = "$appId";

/**
 * Executes the argParser for a command and returns complete parsed command data.
 * This is async to support commands like profile that use NIP-05 resolution.
 */
export async function executeCommandParser(
  parsed: ParsedCommand,
  activeAccountPubkey?: string,
): Promise<ParsedCommand> {
  if (!parsed.command) {
    return parsed; // Already has error, return as-is
  }

  try {
    // Use argParser if available, otherwise use defaultProps
    const parsedProps = parsed.command.argParser
      ? await Promise.resolve(
          parsed.command.argParser(parsed.args, activeAccountPubkey),
        )
      : parsed.command.defaultProps || {};

    const override = parsedProps?.[APP_ID_OVERRIDE];
    if (typeof override !== "string") return { ...parsed, props: parsedProps };

    const { [APP_ID_OVERRIDE]: _dropped, ...props } = parsedProps;
    return {
      ...parsed,
      props,
      // Host-side only: the override is produced by an argParser in this repo,
      // never by anything on the wire.
      command: { ...parsed.command, appId: override as AppId },
    };
  } catch (error) {
    return {
      ...parsed,
      error:
        error instanceof Error
          ? error.message
          : "Failed to parse command arguments",
    };
  }
}

/**
 * Complete command parsing pipeline: parse input → execute argParser.
 * Returns fully parsed command ready for window creation.
 */
export async function parseAndExecuteCommand(
  input: string,
  activeAccountPubkey?: string,
): Promise<ParsedCommand> {
  const parsed = parseCommandInput(input);
  if (parsed.error || !parsed.command) {
    return parsed;
  }
  return executeCommandParser(parsed, activeAccountPubkey);
}
