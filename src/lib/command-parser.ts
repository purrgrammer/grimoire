import { manPages } from "@/types/man";

export interface ParsedCommand {
  commandName: string;
  args: string[];
  fullInput: string;
  command?: (typeof manPages)[string];
  props?: any;
  title?: string;
  error?: string;
}

/**
 * Parses a command string into its components.
 * Returns basic parsing info without executing argParser.
 */
export function parseCommandInput(input: string): ParsedCommand {
  const parts = input.trim().split(/\s+/);
  const commandName = parts[0]?.toLowerCase() || "";
  const args = parts.slice(1);
  const fullInput = input.trim();

  const command = commandName && manPages[commandName];

  if (!commandName) {
    return {
      commandName: "",
      args: [],
      fullInput: "",
      error: "No command provided",
    };
  }

  if (!command) {
    return {
      commandName,
      args,
      fullInput,
      error: `Unknown command: ${commandName}`,
    };
  }

  return {
    commandName,
    args,
    fullInput,
    command,
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

    // Generate title
    const title =
      parsed.args.length > 0
        ? `${parsed.commandName.toUpperCase()} ${parsed.args.join(" ")}`
        : parsed.commandName.toUpperCase();

    return {
      ...parsed,
      props,
      title,
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
