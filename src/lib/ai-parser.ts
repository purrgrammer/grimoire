/**
 * AI Command Parser
 *
 * Parses arguments for the `ai` command
 */

export interface AICommandResult {
  view: "list" | "chat" | "settings";
  conversationId?: string | null;
}

/**
 * Parse AI command arguments
 *
 * @example
 * ai              -> { view: "list" }
 * ai new          -> { view: "chat", conversationId: null }
 * ai settings     -> { view: "settings" }
 * ai <uuid>       -> { view: "chat", conversationId: "<uuid>" }
 */
export function parseAICommand(args: string[]): AICommandResult {
  if (args.length === 0) {
    return { view: "list" };
  }

  const arg = args[0].toLowerCase();

  if (arg === "new") {
    return { view: "chat", conversationId: null };
  }

  if (arg === "settings") {
    return { view: "settings" };
  }

  // Assume it's a conversation ID
  // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(args[0])) {
    return { view: "chat", conversationId: args[0] };
  }

  // Unknown argument, default to list
  return { view: "list" };
}
