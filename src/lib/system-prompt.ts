/**
 * Dynamic system prompt builder for an LLM assistant that helps users:
 * 1. Learn about Nostr protocol
 * 2. Build Grimoire commands from natural language
 * 3. Explain Grimoire commands
 *
 * The prompt is built dynamically from the codebase documentation
 * to ensure it stays in sync with the actual command implementations.
 */

import { manPages, type ManPageEntry } from "@/types/man";
import { NIP_TITLES, DEPRECATED_NIPS, type NipId } from "@/constants/nips";
import { EVENT_KINDS, type EventKind } from "@/constants/kinds";
import {
  REGULAR_END,
  REPLACEABLE_START,
  REPLACEABLE_END,
  EPHEMERAL_START,
  EPHEMERAL_END,
  PARAMETERIZED_REPLACEABLE_START,
  PARAMETERIZED_REPLACEABLE_END,
} from "@/lib/nostr-kinds";

/**
 * Options for customizing the generated system prompt
 */
export interface SystemPromptOptions {
  /** Include detailed command documentation (default: true) */
  includeCommands?: boolean;
  /** Include NIP reference (default: true) */
  includeNips?: boolean;
  /** Include event kinds reference (default: true) */
  includeKinds?: boolean;
  /** Include natural language examples (default: true) */
  includeExamples?: boolean;
  /** Include Nostr fundamentals (default: true) */
  includeNostrBasics?: boolean;
  /** Maximum number of command examples to include per command (default: 3) */
  maxExamplesPerCommand?: number;
  /** Maximum number of kinds to include (default: all) */
  maxKinds?: number;
}

const DEFAULT_OPTIONS: Required<SystemPromptOptions> = {
  includeCommands: true,
  includeNips: true,
  includeKinds: true,
  includeExamples: true,
  includeNostrBasics: true,
  maxExamplesPerCommand: 3,
  maxKinds: Infinity,
};

/**
 * Generate the Nostr fundamentals section
 */
function generateNostrBasics(): string {
  return `## Nostr Protocol Fundamentals

Nostr (Notes and Other Stuff Transmitted by Relays) is a decentralized protocol for social networking and messaging. Here are the core concepts:

### Events
Events are the only data type in Nostr. Every piece of content is an event with this structure:
- **id**: 32-byte hex SHA256 hash of the serialized event
- **pubkey**: 32-byte hex public key of the event creator
- **created_at**: Unix timestamp in seconds
- **kind**: Integer indicating the event type
- **tags**: Array of arrays for metadata (e.g., references, mentions)
- **content**: String content (may be encrypted or JSON)
- **sig**: 64-byte hex Schnorr signature

### Event Kinds
Event kinds determine how events are processed:
- **Regular (0-9999)**: Stored permanently, all versions kept
- **Replaceable (10000-19999)**: Only latest version per pubkey+kind kept
- **Ephemeral (20000-29999)**: Not stored, only forwarded
- **Parameterized Replaceable (30000-39999)**: Latest per pubkey+kind+d-tag kept

### Identifiers (NIP-19)
Nostr uses bech32-encoded identifiers for human-readable sharing:
- **npub**: Public key (npub1...)
- **nsec**: Private key - NEVER share! (nsec1...)
- **note**: Event ID (note1...)
- **nprofile**: Profile with relay hints (nprofile1...)
- **nevent**: Event with relay hints and author (nevent1...)
- **naddr**: Replaceable event coordinate (kind:pubkey:d-tag) (naddr1...)

### NIP-05 Verification
Users can verify their identity via domain: \`user@domain.com\`
The domain serves \`/.well-known/nostr.json\` mapping names to pubkeys.
Example: \`fiatjaf.com\` resolves to \`_@fiatjaf.com\`

### Relays
Relays are servers that store and forward events. Communication uses WebSocket:
- **REQ**: Subscribe to events matching filters
- **EVENT**: Publish or receive events
- **CLOSE**: Unsubscribe
- **EOSE**: End of stored events (historical data sent)

### Filters
Queries use filters with these fields (all optional, combined with AND):
- **ids**: Event IDs to match
- **authors**: Pubkeys to match
- **kinds**: Event kinds to match
- **#<tag>**: Tag values to match (e.g., #p, #e, #t)
- **since/until**: Unix timestamp range
- **limit**: Maximum events to return
- **search**: Full-text search (relay-dependent, NIP-50)

### Special Aliases
Grimoire supports these context-aware aliases:
- **$me**: Your currently logged-in pubkey
- **$contacts**: All pubkeys you follow (from your contact list)

`;
}

/**
 * Format a single command for the system prompt
 */
function formatCommand(entry: ManPageEntry, maxExamples: number): string {
  const lines: string[] = [];

  lines.push(`### ${entry.name}`);
  lines.push(`**Synopsis**: \`${entry.synopsis}\``);
  lines.push(`**Category**: ${entry.category}`);
  lines.push("");
  lines.push(entry.description);

  if (entry.options && entry.options.length > 0) {
    lines.push("");
    lines.push("**Options**:");
    for (const opt of entry.options) {
      lines.push(`- \`${opt.flag}\`: ${opt.description}`);
    }
  }

  if (entry.examples && entry.examples.length > 0) {
    lines.push("");
    lines.push("**Examples**:");
    const examplesToShow = entry.examples.slice(0, maxExamples);
    for (const ex of examplesToShow) {
      // Split command from description (often separated by multiple spaces)
      const parts = ex.split(/\s{2,}/);
      if (parts.length >= 2) {
        lines.push(`- \`${parts[0].trim()}\` - ${parts.slice(1).join(" ")}`);
      } else {
        lines.push(`- \`${ex.trim()}\``);
      }
    }
  }

  if (entry.seeAlso && entry.seeAlso.length > 0) {
    lines.push("");
    lines.push(`**See also**: ${entry.seeAlso.join(", ")}`);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Generate the commands documentation section
 */
function generateCommandsDoc(maxExamples: number): string {
  const lines: string[] = [];
  lines.push("## Grimoire Commands Reference\n");
  lines.push(
    "Grimoire uses a Unix-style command interface. Commands are entered via Cmd+K palette.\n",
  );

  // Group commands by category
  const categories: Record<string, ManPageEntry[]> = {};
  for (const cmd of Object.values(manPages)) {
    const cat = cmd.category || "Other";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(cmd);
  }

  // Output each category
  for (const [category, commands] of Object.entries(categories)) {
    lines.push(`\n## ${category} Commands\n`);
    for (const cmd of commands) {
      lines.push(formatCommand(cmd, maxExamples));
    }
  }

  return lines.join("\n");
}

/**
 * Generate the NIPs reference section
 */
function generateNipsReference(): string {
  const lines: string[] = [];
  lines.push("## NIPs Reference (Nostr Implementation Possibilities)\n");
  lines.push(
    "NIPs are protocol standards that define Nostr features. Here are the key NIPs:\n",
  );

  // Group by category for readability
  const coreNips = ["01", "02", "10", "19", "65"];
  const socialNips = ["25", "18", "23", "28", "29"];
  const identityNips = ["05", "39", "42"];
  const paymentNips = ["47", "57", "61"];
  const contentNips = ["94", "96", "36", "84"];

  const formatNipList = (nips: string[], title: string): string => {
    const items = nips
      .filter((n) => NIP_TITLES[n])
      .map((n) => {
        const deprecated = DEPRECATED_NIPS.includes(n as any)
          ? " (deprecated)"
          : "";
        return `- **NIP-${n}**: ${NIP_TITLES[n]}${deprecated}`;
      });
    return `### ${title}\n${items.join("\n")}\n`;
  };

  lines.push(formatNipList(coreNips, "Core Protocol"));
  lines.push(formatNipList(socialNips, "Social Features"));
  lines.push(formatNipList(identityNips, "Identity & Authentication"));
  lines.push(formatNipList(paymentNips, "Payments & Lightning"));
  lines.push(formatNipList(contentNips, "Content & Media"));

  // Add other NIPs
  const listedNips = new Set([
    ...coreNips,
    ...socialNips,
    ...identityNips,
    ...paymentNips,
    ...contentNips,
  ]);
  const otherNips = Object.keys(NIP_TITLES).filter((n) => !listedNips.has(n));
  if (otherNips.length > 0) {
    lines.push(formatNipList(otherNips, "Other NIPs"));
  }

  return lines.join("\n");
}

/**
 * Generate the event kinds reference section
 */
function generateKindsReference(maxKinds: number): string {
  const lines: string[] = [];
  lines.push("## Event Kinds Reference\n");
  lines.push("Event kinds define the type and purpose of Nostr events:\n");

  // Explain the ranges
  lines.push("### Kind Ranges");
  lines.push(`- **Regular (0-${REGULAR_END - 1})**: Stored permanently`);
  lines.push(
    `- **Replaceable (${REPLACEABLE_START}-${REPLACEABLE_END - 1})**: Only latest version kept`,
  );
  lines.push(
    `- **Ephemeral (${EPHEMERAL_START}-${EPHEMERAL_END - 1})**: Not stored`,
  );
  lines.push(
    `- **Parameterized Replaceable (${PARAMETERIZED_REPLACEABLE_START}-${PARAMETERIZED_REPLACEABLE_END - 1})**: Latest per d-tag\n`,
  );

  // List common kinds (most useful ones first)
  const commonKinds = [
    0, 1, 3, 5, 6, 7, 9, 1111, 9734, 9735, 10002, 30023, 30311,
  ];
  lines.push("### Common Kinds");

  let count = 0;
  for (const kind of commonKinds) {
    if (count >= maxKinds) break;
    const info = EVENT_KINDS[kind];
    if (info) {
      const nipRef = info.nip ? ` (NIP-${info.nip})` : "";
      lines.push(
        `- **Kind ${kind}** (${info.name}): ${info.description}${nipRef}`,
      );
      count++;
    }
  }

  // Add more kinds if space allows
  if (count < maxKinds) {
    lines.push("\n### All Kinds");
    const sortedKinds = Object.keys(EVENT_KINDS)
      .map(Number)
      .filter((k) => !commonKinds.includes(k))
      .sort((a, b) => a - b);

    for (const kind of sortedKinds) {
      if (count >= maxKinds) break;
      const info = EVENT_KINDS[kind];
      if (info) {
        const nipRef = info.nip ? ` (NIP-${info.nip})` : "";
        lines.push(
          `- **Kind ${kind}** (${info.name}): ${info.description}${nipRef}`,
        );
        count++;
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Generate natural language to command translation examples
 */
function generateNaturalLanguageExamples(): string {
  return `## Natural Language to Command Translation

When users describe what they want in natural language, translate it to the appropriate Grimoire command. Here are examples:

### Viewing Content
| User Says | Command |
|-----------|---------|
| "Show me recent posts" | \`req -k 1 -l 20\` |
| "Get notes from the last hour" | \`req -k 1 --since 1h\` |
| "Show posts from fiatjaf" | \`req -k 1 -a fiatjaf.com\` |
| "What are my contacts posting?" | \`req -k 1 -a $contacts --since 24h\` |
| "Find posts about bitcoin" | \`req -k 1 -t bitcoin\` or \`req -k 1 --search bitcoin\` |
| "Show reactions to this event" | \`req -k 7 -e <event-id>\` |
| "Get zaps I received" | \`req -k 9735 -p $me --since 7d\` |

### Viewing Profiles
| User Says | Command |
|-----------|---------|
| "Show fiatjaf's profile" | \`profile fiatjaf.com\` |
| "View my profile" | \`profile $me\` |
| "Look up jack@cash.app" | \`profile jack@cash.app\` |

### Opening Events
| User Says | Command |
|-----------|---------|
| "Open this event: note1..." | \`open note1...\` |
| "View this article" + naddr | \`open naddr1...\` |

### Relay Operations
| User Says | Command |
|-----------|---------|
| "Show relay info for nos.lol" | \`relay nos.lol\` |
| "Check my relay connections" | \`conn\` |

### Encoding/Decoding
| User Says | Command |
|-----------|---------|
| "Decode this npub/nevent/naddr" | \`decode <identifier>\` |
| "Encode this pubkey as npub" | \`encode npub <hex>\` |

### Chat
| User Says | Command |
|-----------|---------|
| "Join the bitcoin chat on nos.lol" | \`chat nos.lol'bitcoin\` |
| "Join this group" + naddr | \`chat naddr1...\` |

### Documentation
| User Says | Command |
|-----------|---------|
| "What is NIP-01?" | \`nip 01\` |
| "Show all NIPs" | \`nips\` |
| "What is kind 30023?" | \`kind 30023\` |
| "List all event kinds" | \`kinds\` |

### Publishing
| User Says | Command |
|-----------|---------|
| "I want to post something" | \`post\` |
| "Zap fiatjaf" | \`zap fiatjaf.com\` |

### Tips for Translation
1. **Time expressions**: Convert "last hour" to \`--since 1h\`, "past week" to \`--since 7d\`, "yesterday" to \`--since 24h\`
2. **User references**: Use NIP-05 (\`user@domain.com\`), npub, or \`$me\`/\`$contacts\` aliases
3. **Event types**: Map "posts/notes" to kind 1, "reactions/likes" to kind 7, "reposts" to kind 6, "zaps" to kind 9735
4. **Multiple authors**: Use comma-separated values: \`-a alice.com,bob.com\`
5. **Multiple hashtags**: Use comma-separated: \`-t bitcoin,nostr,lightning\`

`;
}

/**
 * Generate the command explanation guide
 */
function generateCommandExplanationGuide(): string {
  return `## Explaining Commands

When explaining what a Grimoire command does, break it down by:

1. **Command name**: What tool/viewer it opens
2. **Filters applied**: What criteria are used to select events
3. **Data sources**: Which relays will be queried
4. **Expected output**: What the user will see

### Example Explanations

**Command**: \`req -k 1 -a fiatjaf.com --since 7d -l 50\`

**Explanation**: This command queries for short text notes (kind 1) authored by the user verified at fiatjaf.com, from the last 7 days, limited to 50 results. It will:
1. Resolve fiatjaf.com via NIP-05 to get the pubkey
2. Query the author's outbox relays (from their NIP-65 relay list)
3. Display up to 50 matching notes in chronological order

**Command**: \`req -k 9735 -p $me --since 30d\`

**Explanation**: This queries for zap receipts (kind 9735) where you are the recipient (#p tag contains your pubkey), from the last 30 days. It will query your inbox relays to find zaps sent to you.

**Command**: \`chat wss://nos.lol'welcome\`

**Explanation**: This opens the NIP-29 relay-based group chat for the "welcome" group hosted on the nos.lol relay. You'll see messages from group members and can participate if you're a member.

`;
}

/**
 * Build the complete system prompt for the Nostr LLM assistant
 */
export function buildSystemPrompt(options: SystemPromptOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sections: string[] = [];

  // Header
  sections.push(`# Grimoire Nostr Assistant

You are an expert assistant for Grimoire, a Nostr protocol explorer and developer tool. You help users:
1. **Learn about Nostr**: Explain the protocol, NIPs, event kinds, and concepts
2. **Build commands**: Translate natural language requests into Grimoire commands
3. **Explain commands**: Break down what any command does and how it works

When building commands:
- Prefer simple solutions that match the user's intent
- Use $me and $contacts aliases when appropriate
- Include relay hints when the user provides specific relays
- Default to reasonable limits (20-50 events) unless specified

When explaining:
- Be precise about what filters are applied
- Explain which relays will be queried (based on NIP-65 outbox/inbox model)
- Describe the expected output format

`);

  // Add sections based on options
  if (opts.includeNostrBasics) {
    sections.push(generateNostrBasics());
  }

  if (opts.includeCommands) {
    sections.push(generateCommandsDoc(opts.maxExamplesPerCommand));
  }

  if (opts.includeExamples) {
    sections.push(generateNaturalLanguageExamples());
    sections.push(generateCommandExplanationGuide());
  }

  if (opts.includeNips) {
    sections.push(generateNipsReference());
  }

  if (opts.includeKinds) {
    sections.push(generateKindsReference(opts.maxKinds));
  }

  return sections.join("\n");
}

/**
 * Get a compact version of the system prompt for smaller context windows
 */
export function buildCompactSystemPrompt(): string {
  return buildSystemPrompt({
    includeCommands: true,
    includeNips: false,
    includeKinds: false,
    includeExamples: true,
    includeNostrBasics: true,
    maxExamplesPerCommand: 2,
  });
}

/**
 * Get just the commands reference (useful for embedding in other prompts)
 */
export function getCommandsReference(): string {
  return generateCommandsDoc(3);
}

/**
 * Get just the NIPs reference
 */
export function getNipsReference(): string {
  return generateNipsReference();
}

/**
 * Get just the kinds reference
 */
export function getKindsReference(maxKinds?: number): string {
  return generateKindsReference(maxKinds ?? Infinity);
}

/**
 * Get just the Nostr basics
 */
export function getNostrBasics(): string {
  return generateNostrBasics();
}

/**
 * Get command names and synopses for quick reference
 */
export function getCommandQuickReference(): Array<{
  name: string;
  synopsis: string;
  description: string;
}> {
  return Object.values(manPages).map((cmd) => ({
    name: cmd.name,
    synopsis: cmd.synopsis,
    description: cmd.description,
  }));
}

/**
 * Look up a specific command's documentation
 */
export function getCommandDoc(commandName: string): string | null {
  const cmd = manPages[commandName.toLowerCase()];
  if (!cmd) return null;
  return formatCommand(cmd, 10);
}

/**
 * Get all NIP titles as a simple map
 */
export function getNipTitles(): Record<string, string> {
  return { ...NIP_TITLES };
}

/**
 * Get all event kind info
 */
export function getEventKindsInfo(): Record<
  number | string,
  { name: string; description: string; nip: string }
> {
  const result: Record<
    number | string,
    { name: string; description: string; nip: string }
  > = {};
  for (const [kind, info] of Object.entries(EVENT_KINDS)) {
    result[kind] = {
      name: info.name,
      description: info.description,
      nip: info.nip,
    };
  }
  return result;
}
