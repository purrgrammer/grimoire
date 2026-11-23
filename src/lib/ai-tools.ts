import { nip19 } from "nostr-tools";

import { READABLE_COMMANDS, proposeCommand } from "./ai-commands";
import { resolveAliases, sanitizeFilter } from "./ai-filter";
import { resolveEntity } from "./resolve-entity";
import { requestEvents } from "./relay-subscription";

import { getKindInfo } from "@/constants/kinds";
import db, { type LocalSpell } from "@/services/db";
import { manPages } from "@/types/man";
import { getNipText } from "@/services/nip-text";

/**
 * What the registry's tools actually do.
 *
 * Schemas and ids live in `ai-registry.ts`; this file is the implementations,
 * so a tool's contract and its behaviour are not the same edit.
 *
 * None of them sign, publish, spend, or follow. Tool arguments are shaped by
 * whatever the agent read — including note text, which is untrusted — so the
 * only side effect available is a window the user then drives themselves.
 */

/** Cap on returned content, so one long article cannot eat the window. */
const MAX_CONTENT_CHARS = 2_000;

/** Most commands one suggestion carries; a reply is not a menu. */
const MAX_PROPOSED = 5;

export async function lookupSpec(args: unknown): Promise<unknown> {
  const { nip, kind, command } = (args ?? {}) as {
    nip?: unknown;
    kind?: unknown;
    command?: unknown;
  };
  const result: Record<string, unknown> = {};

  if (typeof command === "string" && command.trim()) {
    result.command = manPage(command);
  }

  if (typeof kind === "number" && Number.isFinite(kind)) {
    const info = getKindInfo(kind);
    result.kind = info
      ? { kind, name: info.name, nip: info.nip, description: info.description }
      : { kind, known: false };
  }

  const nipId =
    typeof nip === "string"
      ? nip
          .replace(/^nip-?/i, "")
          .toUpperCase()
          .padStart(2, "0")
      : typeof result.kind === "object" &&
          result.kind != null &&
          "nip" in result.kind &&
          typeof result.kind.nip === "string"
        ? result.kind.nip.replace(/^nip-?/i, "").toUpperCase()
        : undefined;

  if (nipId) {
    const text = await getNipText(nipId);
    result.nip = text
      ? { id: nipId, text }
      : { id: nipId, error: "Could not load this NIP's text." };
  }

  if (Object.keys(result).length === 0) {
    return { error: "Pass a nip id, a kind number, or a command name." };
  }
  return result;
}

/**
 * A command's manual page, verbatim from the registry the palette reads.
 *
 * The system prompt lists every command's synopsis and flag names, which is
 * enough to pick one and not enough to write it — flag descriptions and
 * examples live here so the prompt stays a catalogue rather than a manual.
 */
function manPage(name: string): unknown {
  const key = name.trim().split(/\s+/)[0].toLowerCase();
  const page = READABLE_COMMANDS.includes(key) ? manPages[key] : undefined;
  // The schema enumerates the names, so this only fires for a provider that
  // does not enforce enums — still answered as data, never thrown.
  if (!page) {
    return {
      name: key,
      error: `No such command. Known commands: ${READABLE_COMMANDS.join(", ")}.`,
    };
  }
  return {
    name: page.name,
    synopsis: page.synopsis,
    description: page.description,
    ...(page.options?.length ? { options: page.options } : {}),
    ...(page.examples?.length ? { examples: page.examples } : {}),
    ...(page.seeAlso?.length ? { seeAlso: page.seeAlso } : {}),
  };
}

export async function listSpellsTool(args: unknown): Promise<unknown> {
  const alias = (args as { alias?: unknown })?.alias;
  return typeof alias === "string" && alias.trim()
    ? findSpell(alias)
    : listSpells();
}

/** How many spells one answer carries; a saved-query list is not a database. */
const MAX_SPELLS = 40;

/**
 * The user's saved spells, as alias and command.
 *
 * A spell is a `req` someone kept, so its command is the interesting part: an
 * agent can open it as a window or run the same filter itself. Local rows only —
 * these are the user's own, and nothing here publishes or deletes one.
 */
async function listSpells(): Promise<unknown> {
  try {
    const rows = await db.spells.toArray();
    const live = rows.filter((row) => row.deletedAt === undefined);
    return {
      count: live.length,
      spells: live.slice(0, MAX_SPELLS).map(describeSpell),
      ...(live.length > MAX_SPELLS
        ? { note: `Only the first ${MAX_SPELLS} are listed.` }
        : {}),
    };
  } catch {
    return { error: "Could not read the local spell store." };
  }
}

async function findSpell(query: string): Promise<unknown> {
  const wanted = query
    .trim()
    .toLowerCase()
    .replace(/^spell:/, "");
  try {
    const rows = await db.spells.toArray();
    const found = rows
      .filter((row) => row.deletedAt === undefined)
      .find(
        (row) =>
          row.alias?.toLowerCase() === wanted ||
          row.name?.toLowerCase() === wanted,
      );
    return (
      (found && describeSpell(found)) ?? {
        query: wanted,
        error:
          "No spell with that alias or name. Call it with no alias to see them all.",
      }
    );
  } catch {
    return { error: "Could not read the local spell store." };
  }
}

function describeSpell(row: LocalSpell): unknown {
  return {
    ...(row.alias ? { alias: row.alias } : {}),
    ...(row.name ? { name: row.name } : {}),
    ...(row.description ? { description: row.description } : {}),
    command: row.command,
    published: row.isPublished,
  };
}

export async function queryNostr(args: unknown): Promise<unknown> {
  const sanitized = sanitizeFilter(args);
  if ("error" in sanitized) return sanitized;

  const resolved = await resolveAliases(sanitized.filter);
  if ("error" in resolved) return resolved;

  const events = await requestEvents(sanitized.relays, [resolved.filter]);
  const limit = resolved.filter.limit ?? events.length;

  return {
    // The filter as sent, aliases expanded: the model can see why a query came
    // back empty, and the window shows the same REQ the relays saw.
    filter: resolved.filter,
    relays: sanitized.relays,
    count: events.length,
    events: events.slice(0, limit).map((event) => ({
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
      // The bech32 to quote. A model handed only hex writes an npub with a bad
      // checksum, and grimoire renders an undecodable reference as dead text —
      // so the encoding it must copy is supplied rather than left to it.
      npub: nip19.npubEncode(event.pubkey),
      nevent: nip19.neventEncode({
        id: event.id,
        kind: event.kind,
        author: event.pubkey,
      }),
      created_at: event.created_at,
      tags: event.tags,
      content:
        event.content.length > MAX_CONTENT_CHARS
          ? `${event.content.slice(0, MAX_CONTENT_CHARS)}…[truncated]`
          : event.content,
    })),
  };
}

export async function resolveTool(args: unknown): Promise<unknown> {
  const entity = (args as { entity?: unknown })?.entity;
  if (typeof entity !== "string" || !entity.trim()) {
    return { error: "Pass a bech32 entity as `entity`." };
  }

  const resolved = await resolveEntity(entity);
  if ("error" in resolved || resolved.type === "profile") return resolved;

  // Same cap as a query: one long article should not fill the window here
  // either, and the model asked what this is, not for every word of it.
  return {
    ...resolved,
    event: {
      ...resolved.event,
      content:
        resolved.event.content.length > MAX_CONTENT_CHARS
          ? `${resolved.event.content.slice(0, MAX_CONTENT_CHARS)}…[truncated]`
          : resolved.event.content,
    },
  };
}

/** Shared refusal so the tool and the chips agree on what may not run. */
export function refuseIfNeeded(command: string): string | undefined {
  const proposed = proposeCommand(command);
  if (!proposed) return `Not a grimoire command: ${command}`;
  return proposed.refusal;
}

/**
 * Commands offered to the user, validated the way a fenced proposal is.
 *
 * The fence still works and is the whole story on a provider with no tools, but
 * a model that has tools should not have to remember a fence language to hand
 * something over. Same validator either way: an invented command is dropped
 * here rather than rendered as a dead button, and one that acts on the user's
 * behalf is reported back so the model can say so instead of stopping.
 */
export async function proposeCommandTool(args: unknown): Promise<unknown> {
  const { commands, reason } = (args ?? {}) as {
    commands?: unknown;
    reason?: unknown;
  };
  const lines = Array.isArray(commands)
    ? commands.filter((line): line is string => typeof line === "string")
    : typeof commands === "string"
      ? [commands]
      : [];
  if (lines.length === 0) {
    return { error: "Pass one or more command lines as `commands`." };
  }

  const offered: string[] = [];
  const rejected: { command: string; error: string }[] = [];
  for (const line of lines.slice(0, MAX_PROPOSED)) {
    const refusal = refuseIfNeeded(line);
    if (refusal) rejected.push({ command: line, error: refusal });
    else offered.push(line);
  }

  return {
    // The offer is the render, not the return value: the rows in the transcript
    // are what the user presses, and nothing has run.
    offered,
    ...(typeof reason === "string" && reason.trim() ? { reason } : {}),
    ...(rejected.length ? { rejected } : {}),
    ...(offered.length === 0
      ? { error: "None of those are commands the user can be offered." }
      : {}),
  };
}
