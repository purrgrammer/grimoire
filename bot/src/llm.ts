/**
 * LLM integration for the Grimoire REQ Assistant Bot
 *
 * Uses pi-ai to process user questions and generate REQ commands
 */

import {
  getModel,
  complete,
  validateToolCall,
  type Tool,
  type Context,
} from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import {
  getKindInfo,
  searchKinds,
  getKindsForNip,
  getCommonKindsReference,
} from "./data/kinds.js";
import { getNipInfo, searchNips } from "./data/nips.js";

// Get model - default to Claude Haiku for fast, cheap responses
// Can be overridden with environment variable
const PROVIDER = process.env.LLM_PROVIDER || "anthropic";
const MODEL_ID = process.env.LLM_MODEL || "claude-3-5-haiku-20241022";

// API key from environment
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY environment variable is not set.");
  console.error("Please set it before running the bot:");
  console.error("  export ANTHROPIC_API_KEY=sk-ant-...");
  process.exit(1);
}

// Use default model for simplicity (typed correctly)
const model = getModel("anthropic", "claude-3-5-haiku-20241022");

console.log(`Using LLM: ${PROVIDER}/${MODEL_ID}`);

// System prompt for the REQ assistant
const SYSTEM_PROMPT = `You are the Grimoire REQ Assistant, a helpful bot that assists users in crafting Nostr REQ queries for the Grimoire protocol explorer.

## Your Role
Help users construct REQ commands to query Nostr relays. Users will describe what they want to find, and you should respond with the appropriate REQ command syntax.

## REQ Command Syntax
The REQ command follows this format:
\`\`\`
req [options] [relay...]
\`\`\`

### Common Options:
- \`-k, --kind <number>\` - Filter by event kind (supports comma-separated: -k 1,3,7)
- \`-a, --author <pubkey>\` - Filter by author (supports npub, hex, NIP-05, $me, $contacts)
- \`-l, --limit <number>\` - Maximum events to return
- \`-i, --id <id>\` - Fetch specific event by ID (note1, nevent1, hex)
- \`-e <id>\` - Filter by referenced events (#e/#a tags)
- \`-p <pubkey>\` - Filter by mentioned pubkey (#p tag)
- \`-t <hashtag>\` - Filter by hashtag (#t tag)
- \`-d <identifier>\` - Filter by d-tag
- \`--since <time>\` - Events after time (unix timestamp, or relative: 1h, 7d, 2w)
- \`--until <time>\` - Events before time
- \`--search <query>\` - Full-text search (relay must support NIP-50)
- \`--close-on-eose\` - Close subscription after receiving all events
- \`-f, --follow\` - Auto-refresh mode (like tail -f)
- \`--view list|compact\` - Display mode

### Relays:
Add relay URLs directly: \`req -k 1 wss://relay.damus.io\`
Shorthand: \`req -k 1 relay.damus.io\` (wss:// added automatically)

### Special Aliases:
- \`$me\` - Your logged-in pubkey
- \`$contacts\` - Pubkeys you follow

## Common Event Kinds Reference:
${getCommonKindsReference()}

## Guidelines:
1. Always suggest specific, working commands
2. Use appropriate kinds for the use case
3. Suggest reasonable limits to avoid overwhelming results
4. Recommend relays when helpful (popular ones: relay.damus.io, nos.lol, relay.nostr.band)
5. Explain briefly what the command does
6. If the request is unclear, ask clarifying questions
7. If something isn't possible with REQ, explain why and suggest alternatives

## Response Format:
- Keep responses concise and helpful
- Show the REQ command in a code block
- Add a brief explanation of what it does
- If using less common kinds, mention what they are

Use the tools available to look up specific kind numbers or NIP details when needed.`;

// Define tools for the LLM
const tools: Tool[] = [
  {
    name: "lookup_kind",
    description:
      "Look up information about a specific Nostr event kind number. Use this when you need to find the kind number for a specific type of event, or when you need details about what a kind does.",
    parameters: Type.Object({
      kind: Type.Number({
        description: "The event kind number to look up (e.g., 0, 1, 7, 30023)",
      }),
    }),
  },
  {
    name: "search_kinds",
    description:
      "Search for event kinds by name or description. Use this when the user asks about a type of event but doesn't know the kind number (e.g., 'articles', 'zaps', 'reactions').",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search query to find matching kinds (e.g., 'article', 'zap', 'reaction', 'profile')",
      }),
    }),
  },
  {
    name: "lookup_nip",
    description:
      "Look up information about a specific NIP (Nostr Implementation Possibility). Use this when you need details about a NIP specification.",
    parameters: Type.Object({
      nip_id: Type.String({
        description:
          "The NIP identifier (e.g., '01', '29', '57' for numeric NIPs, or 'C7', 'B0' for hex NIPs)",
      }),
    }),
  },
  {
    name: "search_nips",
    description:
      "Search NIPs by title or description. Use this when the user asks about a feature and you need to find the relevant NIP.",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search query to find matching NIPs (e.g., 'zap', 'group', 'encryption')",
      }),
    }),
  },
  {
    name: "get_kinds_for_nip",
    description:
      "Get all event kinds defined in a specific NIP. Use this to find what kinds are part of a particular NIP specification.",
    parameters: Type.Object({
      nip_id: Type.String({
        description: "The NIP identifier to get kinds for",
      }),
    }),
  },
];

/**
 * Execute a tool call
 */
function executeTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "lookup_kind": {
      const kind = args.kind as number;
      const info = getKindInfo(kind);
      if (info) {
        return JSON.stringify({
          kind: info.kind,
          name: info.name,
          description: info.description,
          nip: info.nip,
        });
      }
      return JSON.stringify({
        error: `Kind ${kind} not found in database. It may be a valid kind not yet documented.`,
      });
    }

    case "search_kinds": {
      const query = args.query as string;
      const results = searchKinds(query);
      if (results.length > 0) {
        return JSON.stringify(
          results.slice(0, 10).map((k) => ({
            kind: k.kind,
            name: k.name,
            description: k.description.split(".")[0],
            nip: k.nip,
          })),
        );
      }
      return JSON.stringify({ error: `No kinds found matching "${query}"` });
    }

    case "lookup_nip": {
      const nipId = args.nip_id as string;
      const info = getNipInfo(nipId);
      if (info) {
        return JSON.stringify({
          id: info.id,
          title: info.title,
          description: info.description,
          deprecated: info.deprecated || false,
        });
      }
      return JSON.stringify({ error: `NIP-${nipId} not found in database` });
    }

    case "search_nips": {
      const query = args.query as string;
      const results = searchNips(query);
      if (results.length > 0) {
        return JSON.stringify(
          results.slice(0, 10).map((n) => ({
            id: n.id,
            title: n.title,
            deprecated: n.deprecated || false,
          })),
        );
      }
      return JSON.stringify({ error: `No NIPs found matching "${query}"` });
    }

    case "get_kinds_for_nip": {
      const nipId = args.nip_id as string;
      const kinds = getKindsForNip(nipId);
      if (kinds.length > 0) {
        return JSON.stringify(
          kinds.map((k) => ({
            kind: k.kind,
            name: k.name,
          })),
        );
      }
      return JSON.stringify({
        error: `No kinds found for NIP-${nipId} or NIP not in database`,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

/**
 * Process a user message and generate a response
 */
export async function processMessage(userMessage: string): Promise<string> {
  const context: Context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
    tools,
  };

  // Run the conversation loop (handle tool calls)
  let iterations = 0;
  const maxIterations = 5; // Prevent infinite loops

  while (iterations < maxIterations) {
    iterations++;

    const response = await complete(model, context, { apiKey: API_KEY });

    // Debug: log full response if DEBUG is set
    if (process.env.DEBUG) {
      console.error(`DEBUG: Iteration ${iterations}`);
      console.error("DEBUG: response =", JSON.stringify(response, null, 2));
    }

    context.messages.push(response);

    // Check for tool calls
    const toolCalls = response.content.filter((b) => b.type === "toolCall");

    if (toolCalls.length === 0) {
      // No tool calls, extract text response
      const textBlocks = response.content.filter((b) => b.type === "text");
      const textContent = textBlocks.map((b) => (b as any).text).join("\n");

      // Debug: log response structure if empty
      if (!textContent && process.env.DEBUG) {
        console.error("DEBUG: Empty text response");
        console.error(
          "DEBUG: response.content =",
          JSON.stringify(response.content, null, 2),
        );
      }

      return (
        textContent ||
        "I couldn't generate a response. Please try rephrasing your question."
      );
    }

    // Execute tool calls
    for (const call of toolCalls) {
      if (call.type !== "toolCall") continue;

      try {
        const validatedArgs = validateToolCall(tools, call);
        const result = executeTool(call.name, validatedArgs);

        context.messages.push({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: result }],
          isError: false,
          timestamp: Date.now(),
        });
      } catch (error) {
        context.messages.push({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            },
          ],
          isError: true,
          timestamp: Date.now(),
        });
      }
    }
  }

  return "I reached the maximum number of processing steps. Please try a simpler question.";
}
