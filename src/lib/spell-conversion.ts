import { parseReqCommand } from "./req-parser";
import type {
  CreateSpellOptions,
  EncodedSpell,
  ParsedSpell,
  SpellEvent,
} from "@/types/spell";
import type { NostrFilter } from "@/types/nostr";

/**
 * Simple tokenization that doesn't expand shell variables
 * Splits on whitespace while respecting quoted strings
 */
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      // Start quoted string
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      // End quoted string
      inQuotes = false;
      quoteChar = "";
    } else if (char === " " && !inQuotes) {
      // Whitespace outside quotes - end token
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      // Regular character
      current += char;
    }
  }

  // Add final token
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Detect command type from a command string
 * Returns "REQ" or "COUNT" based on the command prefix
 */
export function detectCommandType(command: string): "REQ" | "COUNT" {
  const trimmed = command.trim().toLowerCase();
  if (trimmed.startsWith("count ") || trimmed === "count") {
    return "COUNT";
  }
  return "REQ";
}

/**
 * Encode a REQ or COUNT command as spell event tags
 *
 * Parses the command and extracts filter parameters into Nostr tags.
 * Preserves relative timestamps (7d, now) for dynamic spell behavior.
 *
 * @param options - Spell creation options with command string
 * @returns Encoded spell with tags, content, and parsed filter
 * @throws Error if command is invalid or produces empty filter
 */
export function encodeSpell(options: CreateSpellOptions): EncodedSpell {
  const { command, name, description, topics, forkedFrom } = options;

  // Validate command
  if (!command || command.trim().length === 0) {
    throw new Error("Spell command is required");
  }

  // Detect command type (REQ or COUNT)
  const cmdType = detectCommandType(command);

  // Parse the command to extract filter components
  // Remove "req" or "count" prefix if present and tokenize
  const commandWithoutPrefix = command
    .replace(/^\s*(req|count)\s+/i, "")
    .trim();
  const tokens = tokenizeCommand(commandWithoutPrefix);

  // Validate we have tokens to parse
  if (tokens.length === 0) {
    throw new Error("Spell command must contain filters or parameters");
  }

  const parsed = parseReqCommand(tokens);

  // Validate that parsing produced a useful filter
  // A filter must have at least one constraint
  const hasConstraints =
    (parsed.filter.kinds && parsed.filter.kinds.length > 0) ||
    (parsed.filter.authors && parsed.filter.authors.length > 0) ||
    (parsed.filter.ids && parsed.filter.ids.length > 0) ||
    parsed.filter.limit !== undefined ||
    parsed.filter.since !== undefined ||
    parsed.filter.until !== undefined ||
    parsed.filter.search !== undefined ||
    Object.keys(parsed.filter).some((k) => k.startsWith("#"));

  if (!hasConstraints) {
    throw new Error(
      "Spell command must specify at least one filter (kinds, authors, tags, time bounds, search, or limit)",
    );
  }

  // Start with required tags
  // Note: Client tag is added by publish-spell.ts based on user settings
  const tags: [string, string, ...string[]][] = [["cmd", cmdType]];

  // Add name tag if provided
  if (name && name.trim().length > 0) {
    tags.push(["name", name.trim()]);
  }

  // Add alt tag for NIP-31 compatibility
  const altText = description
    ? `Grimoire ${cmdType} spell: ${description.substring(0, 100)}`
    : `Grimoire ${cmdType} spell`;
  tags.push(["alt", altText]);

  // Add provenance if forked
  if (forkedFrom) {
    tags.push(["e", forkedFrom]);
  }

  // Encode filter.kinds as multiple k tags for queryability
  if (parsed.filter.kinds) {
    for (const kind of parsed.filter.kinds) {
      tags.push(["k", kind.toString()]);
    }
  }

  // Encode filter.authors as single array tag
  if (parsed.filter.authors && parsed.filter.authors.length > 0) {
    tags.push(["authors", ...parsed.filter.authors] as [
      string,
      string,
      ...string[],
    ]);
  }

  // Encode filter.ids as single array tag
  if (parsed.filter.ids && parsed.filter.ids.length > 0) {
    tags.push(["ids", ...parsed.filter.ids] as [string, string, ...string[]]);
  }

  // Encode tag filters (#e, #p, #P, #t, #d, #a, and any generic tags)
  // New format: ["tag", "letter", ...values]
  const tagFilters: Record<string, string[]> = {};

  // Collect all # tags from filter
  for (const [key, value] of Object.entries(parsed.filter)) {
    if (key.startsWith("#") && Array.isArray(value)) {
      tagFilters[key] = value as string[];
    }
  }

  // Add tag filter tags with new format
  for (const [tagName, values] of Object.entries(tagFilters)) {
    if (values.length > 0) {
      // Extract the letter from #letter format
      const letter = tagName.substring(1); // Remove the # prefix
      tags.push(["tag", letter, ...values] as [string, string, ...string[]]);
    }
  }

  // Encode scalars
  if (parsed.filter.limit !== undefined) {
    tags.push(["limit", parsed.filter.limit.toString()]);
  }

  // For timestamps, we need to preserve the original format if it was relative
  // The parser converts everything to unix timestamps, losing this info
  // We'll need to detect relative times in the original command
  // This is a limitation - for MVP, we'll store the resolved timestamps
  // TODO: Enhance parser to preserve original time format
  if (parsed.filter.since !== undefined) {
    // Try to extract original since value from command
    const sinceMatch = command.match(/--since\s+(\S+)/);
    if (sinceMatch && sinceMatch[1]) {
      tags.push(["since", sinceMatch[1]]);
    } else {
      tags.push(["since", parsed.filter.since.toString()]);
    }
  }

  if (parsed.filter.until !== undefined) {
    // Try to extract original until value from command
    const untilMatch = command.match(/--until\s+(\S+)/);
    if (untilMatch && untilMatch[1]) {
      tags.push(["until", untilMatch[1]]);
    } else {
      tags.push(["until", parsed.filter.until.toString()]);
    }
  }

  if (parsed.filter.search) {
    tags.push(["search", parsed.filter.search]);
  }

  // Add relays if specified
  if (parsed.relays && parsed.relays.length > 0) {
    tags.push(["relays", ...parsed.relays] as [string, string, ...string[]]);
  }

  // Add close-on-eose flag if set
  if (parsed.closeOnEose) {
    tags.push(["close-on-eose", ""] as [string, string, ...string[]]);
  }

  // Add topic tags for categorization
  if (topics && topics.length > 0) {
    for (const topic of topics) {
      tags.push(["t", topic]);
    }
  }

  // Content is the description (or empty if not provided)
  const content = description || "";

  return {
    tags,
    content,
    filter: parsed.filter,
    relays: parsed.relays,
    closeOnEose: parsed.closeOnEose || false,
  };
}

/**
 * Decode a spell event back to a REQ command string
 *
 * Reconstructs a canonical REQ command from the spell's tags.
 * The reconstructed command may differ in formatting from the original
 * but produces an equivalent Nostr filter.
 *
 * @param event - Spell event (kind 777)
 * @returns Parsed spell with reconstructed command
 */
export function decodeSpell(event: SpellEvent): ParsedSpell {
  // Extract tags into a map for easier access
  const tagMap = new Map<string, string[]>();

  for (const tag of event.tags) {
    const [name, ...values] = tag;
    if (!tagMap.has(name)) {
      tagMap.set(name, []);
    }
    tagMap.get(name)!.push(...values);
  }

  // Validate cmd tag
  const cmd = tagMap.get("cmd")?.[0];
  if (cmd !== "REQ" && cmd !== "COUNT") {
    throw new Error(`Invalid spell command type: ${cmd}`);
  }

  // Extract metadata
  const name = tagMap.get("name")?.[0];
  const description = event.content || undefined;

  const topics = tagMap.get("t") || [];
  const forkedFrom = tagMap.get("e")?.[0];

  // Reconstruct filter from tags
  const filter: NostrFilter = {};

  // Kinds
  const kinds = tagMap.get("k");
  if (kinds && kinds.length > 0) {
    filter.kinds = kinds.map((k) => parseInt(k, 10)).filter((k) => !isNaN(k));
  }

  // Authors
  const authors = tagMap.get("authors");
  if (authors && authors.length > 0) {
    filter.authors = authors;
  }

  // IDs
  const ids = tagMap.get("ids");
  if (ids && ids.length > 0) {
    filter.ids = ids;
  }

  // Tag filters - new format: ["tag", "letter", ...values]
  // Parse all "tag" tags and convert to filter[#letter] format
  const tagFilterTags = event.tags.filter((t) => t[0] === "tag");
  for (const tag of tagFilterTags) {
    const [, letter, ...values] = tag;
    if (letter && values.length > 0) {
      (filter as any)[`#${letter}`] = values;
    }
  }

  // Scalars
  const limit = tagMap.get("limit")?.[0];
  if (limit) {
    filter.limit = parseInt(limit, 10);
  }

  const since = tagMap.get("since")?.[0];
  if (since) {
    // Check if it's a relative time or unix timestamp
    if (/^\d{10}$/.test(since)) {
      filter.since = parseInt(since, 10);
    } else {
      // It's a relative time format - preserve it as a comment
      // For actual filtering, we'd need to resolve it at runtime
      // For now, skip adding to filter (will be resolved at execution)
    }
  }

  const until = tagMap.get("until")?.[0];
  if (until) {
    // Check if it's a relative time or unix timestamp
    if (/^\d{10}$/.test(until)) {
      filter.until = parseInt(until, 10);
    } else {
      // It's a relative time format - preserve it as a comment
      // For now, skip adding to filter (will be resolved at execution)
    }
  }

  const search = tagMap.get("search")?.[0];
  if (search) {
    filter.search = search;
  }

  // Options
  const relays = tagMap.get("relays");
  const closeOnEose = tagMap.has("close-on-eose");

  // Reconstruct command string with appropriate command type
  const command = reconstructCommand(
    filter,
    relays,
    since,
    until,
    closeOnEose,
    cmd as "REQ" | "COUNT",
  );

  return {
    name,
    description,
    command,
    filter,
    relays,
    closeOnEose,
    topics,
    forkedFrom,
    event,
  };
}

/**
 * Reconstruct a canonical command string from filter components
 */
export function reconstructCommand(
  filter: NostrFilter,
  relays?: string[],
  since?: string,
  until?: string,
  closeOnEose?: boolean,
  cmdType: "REQ" | "COUNT" = "REQ",
): string {
  const parts: string[] = [cmdType.toLowerCase()];

  // Kinds
  if (filter.kinds && filter.kinds.length > 0) {
    parts.push(`-k ${filter.kinds.join(",")}`);
  }

  // Authors
  if (filter.authors && filter.authors.length > 0) {
    parts.push(`-a ${filter.authors.join(",")}`);
  }

  // Limit
  if (filter.limit !== undefined) {
    parts.push(`-l ${filter.limit}`);
  }

  // IDs (use -e flag, though semantics differ slightly)
  if (filter.ids && filter.ids.length > 0) {
    parts.push(`-e ${filter.ids.join(",")}`);
  }

  // Tag filters
  if (filter["#e"] && filter["#e"].length > 0) {
    parts.push(`-e ${filter["#e"].join(",")}`);
  }

  if (filter["#p"] && filter["#p"].length > 0) {
    parts.push(`-p ${filter["#p"].join(",")}`);
  }

  if (filter["#P"] && filter["#P"].length > 0) {
    parts.push(`-P ${filter["#P"].join(",")}`);
  }

  if (filter["#t"] && filter["#t"].length > 0) {
    parts.push(`-t ${filter["#t"].join(",")}`);
  }

  if (filter["#d"] && filter["#d"].length > 0) {
    parts.push(`-d ${filter["#d"].join(",")}`);
  }

  if (filter["#a"] && filter["#a"].length > 0) {
    // Note: #a filters came from naddr, but we reconstruct as comma-separated
    parts.push(`-e ${filter["#a"].join(",")}`);
  }

  // Generic single-letter tags
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith("#") && key.length === 2 && Array.isArray(value)) {
      const letter = key[1];
      // Skip already handled tags
      if (!["e", "p", "P", "t", "d", "a"].includes(letter)) {
        parts.push(`-T ${letter} ${(value as string[]).join(",")}`);
      }
    }
  }

  // Time bounds (preserve relative format if available)
  if (since) {
    parts.push(`--since ${since}`);
  }

  if (until) {
    parts.push(`--until ${until}`);
  }

  // Search
  if (filter.search) {
    parts.push(`--search "${filter.search}"`);
  }

  // Relays
  if (relays && relays.length > 0) {
    parts.push(...relays);
  }

  // Close on EOSE
  if (closeOnEose) {
    parts.push("--close-on-eose");
  }

  return parts.join(" ");
}
