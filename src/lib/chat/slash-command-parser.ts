/**
 * Parsed slash command result
 */
export interface ParsedSlashCommand {
  /** Command name (without the leading slash) */
  command: string;
}

/**
 * Parse a slash command from message text
 * Returns null if text is not a slash command
 *
 * Examples:
 *   "/join" -> { command: "join" }
 *   "/leave" -> { command: "leave" }
 *   "hello" -> null
 *   "not a /command" -> null
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  // Trim whitespace
  const trimmed = text.trim();

  // Must start with slash
  if (!trimmed.startsWith("/")) {
    return null;
  }

  // Extract command (everything after the slash)
  const command = trimmed.slice(1).trim();

  // Must have a command name
  if (!command) {
    return null;
  }

  return {
    command,
  };
}
