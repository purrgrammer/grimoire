/**
 * Parser for the llm command
 * Supports: llm, llm list, llm open <id>, llm <id>
 */

import type { LLMCommandResult } from "@/types/llm";

export function parseLLMCommand(args: string[]): LLMCommandResult {
  if (args.length === 0) {
    // New conversation with default settings
    return {};
  }

  // Handle subcommands
  const subcommand = args[0].toLowerCase();

  if (subcommand === "list") {
    // Open conversation list viewer
    return { showList: true };
  }

  if (subcommand === "open") {
    // llm open <conversation-id>
    if (args.length < 2) {
      throw new Error("Usage: llm open <conversation-id>");
    }
    const conversationId = args[1];
    if (!conversationId.match(/^[a-f0-9-]{36}$/i)) {
      throw new Error(`Invalid conversation ID: ${conversationId}`);
    }
    return { conversationId };
  }

  // If first arg looks like a UUID, treat as conversation ID (shorthand for "open")
  if (args[0].match(/^[a-f0-9-]{36}$/i)) {
    return { conversationId: args[0] };
  }

  throw new Error(
    `Invalid LLM command. Usage:
    llm                    # Start new conversation
    llm list               # Browse all conversations
    llm open <id>          # Open specific conversation
    llm <id>               # Open specific conversation (shorthand)`,
  );
}
