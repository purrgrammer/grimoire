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
import { nip19 } from "nostr-tools";

import { grimoireStateAtom } from "@/core/state";
import * as Logic from "@/core/logic";
import { parseAndExecuteCommand } from "@/lib/command-parser";
import { BUILTIN_HANDLER_PREFIX } from "@/lib/napplet-parser";

/**
 * Marks a handler as grimoire rather than a napplet.
 *
 * A napplet cannot hold one of these: `assertManifestEvent` refuses to resolve
 * any manifest whose `d` tag is reserved, which is what makes stripping the
 * prefix safe here. Suppressing the built-in when a napplet claims the same
 * *archetype* is a separate, weaker thing — it prevents an ambiguity, not an
 * impersonation.
 */
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
  /**
   * Whether a value is an identifier this role can accept **from a napplet**.
   *
   * Narrower than what the built-in's own parser takes, and deliberately so. A
   * payload from a napplet is attacker-controlled, and every one of these roles
   * ends in a network request to a host derived from it: the profile viewer
   * resolves NIP-05 with a GET to `https://<domain>/.well-known/nostr.json?name=…`,
   * the relay viewer fetches NIP-11 from the URL. Accepting a NIP-05 address or a
   * pathful relay URL there hands a napplet an outbound channel with attacker
   * control of hostname *and* query — a way around `connect-src 'none'` that
   * needs no grant. Typing `app profile alice@example.com` yourself is a
   * different act, so the command line is not held to this.
   */
  acceptsFromNapplet(target: string): boolean;
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

/** A bech32 pointer of one of the given kinds, or a bare 64-char hex id. */
function isPointerLike(value: string, prefixes: readonly string[]): boolean {
  if (/^[0-9a-f]{64}$/i.test(value)) return true;
  return prefixes.some((prefix) =>
    new RegExp(`^${prefix}1[023456789acdefghjklmnpqrstuvwxyz]{20,}$`).test(
      value,
    ),
  );
}

/** A relay URL with nothing after the host: no path, query or fragment. */
function isBareRelayUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "wss:" && url.protocol !== "ws:") return false;
  if (url.username || url.password || url.search || url.hash) return false;
  return url.pathname === "/" || url.pathname === "";
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
 * The identifier a `napplet:<archetype>/open` payload points at.
 *
 * The conventions nest it: `{ target: { type: "event", id, kind?, pubkey? } }`
 * or `{ target: { type: "address", kind, pubkey, identifier } }`, with the flat
 * keys above being the older, looser form. Reading only the top level meant a
 * napplet following the convention — GM Protocol does — arrived with nothing to
 * open, and `build()` returned null before the user was ever asked. That threw
 * inside the caller's `intent.invoke`, which is a promise a napplet typically
 * catches, so the whole thing looked like nothing happened.
 *
 * Rebuilt from the components rather than read from the payload's own `nip19`
 * string, so the pointer carries `kind` and `author` as this repo requires and
 * nothing else. `relays` is dropped on purpose: it is a napplet-chosen host list
 * grimoire would then connect to, which is the concern `acceptsFromNapplet`
 * already names. A napplet can still hand over a hint-laden `nevent` through the
 * flat keys — this declines to add a second way, it does not close that.
 */
function targetIdentifier(
  payload: unknown,
  keys: readonly string[],
): string | undefined {
  const flat = pick(payload, keys);
  if (flat) return flat;

  if (!payload || typeof payload !== "object") return undefined;
  const target = (payload as { target?: unknown }).target;
  if (!target || typeof target !== "object") return undefined;
  const t = target as Record<string, unknown>;

  const isHex = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);

  if (t.type === "event" && isHex(t.id)) {
    return nip19.neventEncode({
      id: t.id,
      ...(typeof t.kind === "number" ? { kind: t.kind } : {}),
      ...(isHex(t.pubkey) ? { author: t.pubkey } : {}),
    });
  }

  if (
    t.type === "address" &&
    typeof t.kind === "number" &&
    isHex(t.pubkey) &&
    typeof t.identifier === "string"
  ) {
    return nip19.naddrEncode({
      kind: t.kind,
      pubkey: t.pubkey,
      identifier: t.identifier,
    });
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
    acceptsFromNapplet: (target) => isPointerLike(target, ["npub", "nprofile"]),
    // `$me` is grimoire's own alias for the signed-in account, and the right
    // answer for `app profile` with nothing to point at.
    build: (target) => `profile ${target ?? "$me"}`,
  },
  note: {
    archetype: "note",
    // The archetype is `note`; the built-in that fills it is `open`. Naming a
    // "Note" built-in invented a command that does not exist.
    title: "Open (built-in)",
    actions: ["open"],
    keys: ["id", "note", "nevent", "event", "naddr", "address"],
    usage: "app note <note|nevent>",
    acceptsFromNapplet: (target) =>
      isPointerLike(target, ["note", "nevent", "naddr"]),
    build: (target) => (target ? `open ${target}` : null),
  },
  event: {
    archetype: "event",
    title: "Open (built-in)",
    actions: ["open"],
    keys: ["id", "nevent", "note", "event", "naddr", "address"],
    usage: "app event <nevent|naddr>",
    acceptsFromNapplet: (target) =>
      isPointerLike(target, ["note", "nevent", "naddr"]),
    build: (target) => (target ? `open ${target}` : null),
  },
  relay: {
    archetype: "relay",
    title: "Relay (built-in)",
    actions: ["open"],
    keys: ["url", "relay", "uri"],
    usage: "app relay <wss://…>",
    acceptsFromNapplet: isBareRelayUrl,
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

/**
 * Resolve a built-in archetype into a window, through the ordinary command
 * pipeline.
 *
 * `fromNapplet` marks the target as attacker-controlled, which narrows what an
 * identifier may be — see `acceptsFromNapplet`.
 */
export async function buildBuiltinWindow(
  archetype: string,
  action: string,
  payload?: unknown,
  /** A positional identifier from the command line, when there is no payload. */
  positional?: string,
  fromNapplet = false,
): Promise<BuiltinWindow> {
  const builtin = findBuiltinArchetype(archetype);
  if (!builtin) throw new Error(`no built-in handler for "${archetype}"`);
  // `action` arrives from the wire, so membership is the narrowing.
  if (!(builtin.actions as readonly string[]).includes(action)) {
    throw new Error(`the built-in "${archetype}" handler cannot "${action}"`);
  }

  const target = targetIdentifier(payload, builtin.keys) ?? positional?.trim();
  if (fromNapplet && target && !builtin.acceptsFromNapplet(target)) {
    throw new Error(
      `a napplet may not point the built-in "${archetype}" handler at "${target}"`,
    );
  }
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
  return openBuiltinWindow(window);
}

/**
 * Add the window for an already-built built-in target.
 *
 * Split from `buildBuiltinWindow` so a caller can interpose a decision between
 * the two — see `napplet-targets`, where a napplet-originated intent must be
 * confirmed before grimoire opens anything.
 */
export function openBuiltinWindow(window: BuiltinWindow): string {
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
