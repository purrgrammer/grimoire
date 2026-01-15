/**
 * Parser for the llm command
 * Syntax: llm [conversation-id]
 */

import type { LLMCommandResult } from "@/types/llm";

export function parseLLMCommand(args: string[]): LLMCommandResult {
  if (args.length === 0) {
    // New conversation with default settings
    return {};
  }

  // If first arg looks like a UUID, treat as conversation ID
  if (args[0].match(/^[a-f0-9-]{36}$/i)) {
    return { conversationId: args[0] };
  }

  throw new Error(
    `Invalid LLM command. Usage:
    llm                    # Start new conversation
    llm <conversation-id>  # Resume existing conversation`,
  );
}
