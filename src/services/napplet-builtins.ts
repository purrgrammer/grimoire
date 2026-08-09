/**
 * Grimoire itself as an intent handler.
 *
 * An archetype names a role — "show a profile", "open a relay" — and grimoire
 * has filled those roles since long before it hosted napplets. So when nothing
 * installed handles an archetype, the answer is not an error: it is the built-in
 * command that already does the job. A napplet asking to open a profile gets a
 * profile window, whether or not the user has installed a profile napplet.
 *
 * The mapping produces a **command string**, not props, and hands it to the real
 * command pipeline. Rebuilding each viewer's prop shape here would mean two
 * definitions of "how to open a profile" that drift; a command string means the
 * built-in's own parser stays the only one, including its NIP-05 resolution and
 * relay-hint handling.
 *
 * Payload keys are read tolerantly. NAP-INTENT conventions are
 * `napplet:<archetype>/<action>` strings whose payload shape is defined by the
 * convention, not by the spec, so there is no canonical field name to insist on
 * — and refusing a payload that says `npub` instead of `pubkey` would be
 * pedantry, not safety. Every value still goes through the built-in parser,
 * which rejects anything that is not a real identifier.
 */

import { getDefaultStore } from "jotai";

import { grimoireStateAtom } from "@/core/state";
import * as Logic from "@/core/logic";
import { parseAndExecuteCommand } from "@/lib/command-parser";

/**
 * Marks a handler as grimoire rather than a napplet.
 *
 * Present on the wire only as the resolved handler id inside an intent result,
 * and `:` makes an accidental collision with a real `d` tag implausible. The
 * catalog also filters out any built-in whose slug a real napplet claims, so a
 * napplet cannot impersonate one.
 */
export const BUILTIN_HANDLER_PREFIX = "grimoire:builtin:";

export function builtinHandlerDTag(archetype: string): string {
  return `${BUILTIN_HANDLER_PREFIX}${archetype}`;
}

/** The archetype behind a built-in handler id, or null if it is a napplet. */
export function parseBuiltinHandlerDTag(dTag: string): string | null {
  return dTag.startsWith(BUILTIN_HANDLER_PREFIX)
    ? dTag.slice(BUILTIN_HANDLER_PREFIX.length)
    : null;
}

/**
 * The roles grimoire fills natively — a closed set, unlike archetypes themselves.
 *
 * An archetype on the wire cannot be an enum: the slug comes from a third party's
 * manifest `archetype` tag, NAP-INTENT deliberately leaves the namespace open,
 * and a shell that only routed slugs it knew at compile time would refuse
 * perfectly valid napplets. Kehto types it as `string` for the same reason.
 *
 * What *is* closed is this table, because each row needs a built-in behind it.
 * Keying by the union makes a missing row a type error rather than a silent
 * hole, and `isBuiltinArchetype` is the one place a wire string becomes one of
 * these.
 */
export const BUILTIN_ARCHETYPE_SLUGS = [
  "profile",
  "note",
  "event",
  "relay",
] as const;

export type BuiltinArchetypeSlug = (typeof BUILTIN_ARCHETYPE_SLUGS)[number];

export function isBuiltinArchetype(
  archetype: string,
): archetype is BuiltinArchetypeSlug {
  return (BUILTIN_ARCHETYPE_SLUGS as readonly string[]).includes(archetype);
}

/** The only action a built-in serves. Grimoire's viewers open; they do not edit. */
export type BuiltinAction = "open";

interface BuiltinArchetype {
  archetype: BuiltinArchetypeSlug;
  /** Shown in the launcher's role list. */
  title: string;
  actions: readonly BuiltinAction[];
  /** Payload keys that may carry the identifier, most specific first. */
  keys: readonly string[];
  /** How to ask for a target, when one is required. */
  usage: string;
  /**
   * The grimoire command for a resolved identifier.
   *
   * `target` is absent when neither the payload nor the command line supplied
   * one; returning null then is how a role says it needs an argument.
   */
  build(target?: string): string | null;
}

function pick(payload: unknown, keys: readonly string[]): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Every built-in role, keyed so the compiler enforces coverage.
 *
 * Only archetypes with a real built-in behind them belong in the union. Listing
 * one grimoire cannot actually serve would be the same class of lie as
 * advertising a NAP domain that is not wired up.
 */
const BUILTIN_TABLE: Record<BuiltinArchetypeSlug, BuiltinArchetype> = {
  profile: {
    archetype: "profile",
    title: "Profile (built-in)",
    actions: ["open"],
    keys: ["pubkey", "npub", "nprofile", "profile", "address", "nip05"],
    usage: "app profile <npub|nip-05>",
    // `$me` is grimoire's own alias for the signed-in account, and the right
    // answer for `app profile` with nothing to point at.
    build: (target) => `profile ${target ?? "$me"}`,
  },
  note: {
    archetype: "note",
    title: "Note (built-in)",
    actions: ["open"],
    keys: ["id", "note", "nevent", "event", "naddr", "address"],
    usage: "app note <note|nevent>",
    build: (target) => (target ? `open ${target}` : null),
  },
  event: {
    archetype: "event",
    title: "Event (built-in)",
    actions: ["open"],
    keys: ["id", "nevent", "note", "event", "naddr", "address"],
    usage: "app event <nevent|naddr>",
    build: (target) => (target ? `open ${target}` : null),
  },
  relay: {
    archetype: "relay",
    title: "Relay (built-in)",
    actions: ["open"],
    keys: ["url", "relay", "uri"],
    usage: "app relay <wss://…>",
    build: (target) => (target ? `relay ${target}` : null),
  },
};

/** Whether a built-in role can open without being given a target. */
export function builtinNeedsTarget(archetype: string): boolean {
  const builtin = findBuiltinArchetype(archetype);
  return builtin ? builtin.build() === null : false;
}

/** How to ask a built-in role for a target. */
export function builtinUsage(archetype: string): string | undefined {
  return findBuiltinArchetype(archetype)?.usage;
}

/** The built-in roles, in declaration order. */
export const BUILTIN_ARCHETYPES: readonly BuiltinArchetype[] =
  BUILTIN_ARCHETYPE_SLUGS.map((slug) => BUILTIN_TABLE[slug]);

export function findBuiltinArchetype(
  archetype: string,
): BuiltinArchetype | undefined {
  return isBuiltinArchetype(archetype) ? BUILTIN_TABLE[archetype] : undefined;
}

export interface BuiltinWindow {
  appId: string;
  props: unknown;
  commandString: string;
}

/** Resolve a built-in archetype into a window, through the ordinary command pipeline. */
export async function buildBuiltinWindow(
  archetype: string,
  action: string,
  payload?: unknown,
  /** A positional identifier from the command line, when there is no payload. */
  positional?: string,
): Promise<BuiltinWindow> {
  const builtin = findBuiltinArchetype(archetype);
  if (!builtin) throw new Error(`no built-in handler for "${archetype}"`);
  // `action` arrives from the wire, so membership is the narrowing.
  if (!(builtin.actions as readonly string[]).includes(action)) {
    throw new Error(`the built-in "${archetype}" handler cannot "${action}"`);
  }

  const target = pick(payload, builtin.keys) ?? positional?.trim();
  const commandString = builtin.build(target);
  if (!commandString) {
    throw new Error(
      `\`app ${archetype}\` needs something to open — try \`${builtin.usage}\``,
    );
  }

  // The active pubkey is what lets a bare `profile` mean "mine" — without it the
  // built-in parser correctly refuses for want of an identifier.
  const parsed = await parseAndExecuteCommand(
    commandString,
    getDefaultStore().get(grimoireStateAtom).activeAccount?.pubkey,
  );
  if (parsed.error || !parsed.command || !parsed.props) {
    throw new Error(parsed.error ?? `could not run \`${commandString}\``);
  }

  return { appId: parsed.command.appId, props: parsed.props, commandString };
}

/** Open a built-in handler's window and return its id. */
export async function openBuiltinArchetype(
  archetype: string,
  action: string,
  payload?: unknown,
  positional?: string,
): Promise<string> {
  const window = await buildBuiltinWindow(
    archetype,
    action,
    payload,
    positional,
  );

  const store = getDefaultStore();
  const before = new Set(Object.keys(store.get(grimoireStateAtom).windows));
  store.set(grimoireStateAtom, (prev) =>
    Logic.addWindow(prev, {
      appId: window.appId,
      props: window.props,
      commandString: window.commandString,
    }),
  );
  const windowId = Object.keys(store.get(grimoireStateAtom).windows).find(
    (id) => !before.has(id),
  );
  if (!windowId) throw new Error("could not open a window");
  return windowId;
}
