import { parse as parseShellTokens } from "shell-quote";
import { manPages } from "@/types/man";
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
  const tokens = rawTokens.map((token) => {
    const str = typeof token === "string" ? token : String(token);
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
      error: error instanceof Error ? error.message : "Failed to parse global flags",
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
 * Executes the argParser for a command and returns complete parsed command data.
 * This is async to support commands like profile that use NIP-05 resolution.
 */
export async function executeCommandParser(
  parsed: ParsedCommand,
): Promise<ParsedCommand> {
  if (!parsed.command) {
    return parsed; // Already has error, return as-is
  }

  try {
    // Use argParser if available, otherwise use defaultProps
    const props = parsed.command.argParser
      ? await Promise.resolve(parsed.command.argParser(parsed.args))
      : parsed.command.defaultProps || {};

    return {
      ...parsed,
      props,
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
): Promise<ParsedCommand> {
  const parsed = parseCommandInput(input);
  if (parsed.error || !parsed.command) {
    return parsed;
  }
  return executeCommandParser(parsed);
}
