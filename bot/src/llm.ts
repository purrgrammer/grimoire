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
\`\`\`
req [options] [relay...]
\`\`\`

## Filter Flags

### Event Selection
- \`-k, --kind <n>\` - Filter by kind (comma-separated: -k 1,7,30023)
- \`-a, --author <pubkey>\` - Filter by author (npub, hex, NIP-05, $me, $contacts)
- \`-i, --id <id>\` - Fetch specific event (note1, nevent1, naddr1, hex)
- \`-l, --limit <n>\` - Maximum events (default: 50)

### Tag Filters
- \`-e <id>\` - Events referencing this event ID (#e tag)
- \`-p <pubkey>\` - Events mentioning this pubkey (#p tag)
- \`-t <hashtag>\` - Filter by hashtag (#t tag, without #)
- \`-d <identifier>\` - Filter by d-tag (for replaceable events)
- \`--tag <name> <value>\` - Generic tag filter (e.g., --tag r https://example.com)

### Time Filters
- \`--since <time>\` - Events after (unix timestamp or relative: 30m, 6h, 7d, 2w)
- \`--until <time>\` - Events before (same format)

### Search & Display
- \`--search <query>\` - Full-text search (NIP-50, relay must support)
- \`--view list|compact\` - Display mode
- \`--close-on-eose\` - Close after initial results
- \`-f, --follow\` - Live streaming mode (like tail -f)

## Special Aliases
- \`$me\` - Your logged-in pubkey
- \`$contacts\` - All pubkeys you follow (from kind 3)
- \`@nip05\` - Resolve NIP-05 to pubkey (e.g., -a @alice@example.com)

## Relays
- Direct: \`req -k 1 wss://relay.damus.io\`
- Shorthand: \`req -k 1 relay.damus.io\` (wss:// auto-added)
- Multiple: \`req -k 1 relay.damus.io nos.lol\`

## Common Kinds Quick Reference
${getCommonKindsReference()}

## Filter Limitations (What REQ Cannot Do)
- **No content filtering**: Can't filter by text content (except NIP-50 search)
- **No numeric comparisons**: Can't do "amount > 1000" on zaps
- **No NOT/exclusion**: Can't exclude kinds or authors
- **No OR across fields**: Can only OR within same field (multiple -a authors)
- **No joins**: Can't "find events by authors who follow X"
- **No aggregation**: Can't count, sum, or average in the query

For complex queries, fetch events and filter client-side, or use multiple REQ commands.

## Common Query Patterns

**Your activity:**
\`req -k 1 -a $me --since 7d\` - Your notes from last week
\`req -k 7 -p $me --since 24h\` - Reactions to you today

**Social graph:**
\`req -k 1 -a $contacts -l 50\` - Latest from people you follow
\`req -k 3 -a <npub>\` - Someone's follow list

**Zaps:**
\`req -k 9735 -p $me --since 7d\` - Zaps you received
\`req -k 9735 -a $me --since 7d\` - Zaps you sent (your wallet's zap receipts)

**Content discovery:**
\`req -k 30023 -t bitcoin -l 20\` - Articles tagged bitcoin
\`req --search "nostr tutorial" -k 1\` - Search notes (NIP-50)

**Specific events:**
\`req -i <note1...>\` - Fetch by ID
\`req -k 1 -e <note1...>\` - Replies to an event

## Response Guidelines
1. Always provide working commands in code blocks
2. Explain briefly what the command does
3. Suggest reasonable limits (10-50 for exploration, 200+ for analysis)
4. Recommend good relays: relay.damus.io, nos.lol, relay.nostr.band, purplepag.es
5. If a request is impossible, explain why and suggest alternatives
6. Use the tools to look up specific kind numbers or NIP details when unsure

## Tools Available
You have tools to look up kind numbers and NIP specifications. Use them when:
- User asks about a kind you're unsure of
- User mentions a feature and you need to find the right kind
- User asks about specific NIPs or protocol details`;

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
