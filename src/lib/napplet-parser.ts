import type { Filter } from "nostr-tools";
import type { NostrEvent } from "@/types/nostr";

/**
 * NIP-5D manifest kinds: snapshot, root, named.
 *
 * Inlined rather than imported from `@kehto/nip/5d` so the command registry —
 * which is eager — does not drag the whole verification runtime and its hash
 * libraries into the startup path. `napplet-parser.test.ts` asserts these stay
 * equal to Kehto's `NAPPLET_KINDS`.
 */
export const NAPPLET_KIND_SNAPSHOT = 5129;
export const NAPPLET_KIND_ROOT = 15129;
export const NAPPLET_KIND_NAMED = 35129;
export const NAPPLET_KINDS = [
  NAPPLET_KIND_SNAPSHOT,
  NAPPLET_KIND_ROOT,
  NAPPLET_KIND_NAMED,
] as const;
import {
  parseOpenCommand,
  type AddressPointer,
  type EventPointer,
} from "./open-parser";

export interface ParsedAppCommand {
  pointer: EventPointer | AddressPointer;
}

/**
 * An nevent pointer carries an optional `kind`, so `"kind" in pointer` is not a
 * discriminant. Only an address pointer lacks an `id`.
 */
function isAddressPointer(
  pointer: EventPointer | AddressPointer,
): pointer is AddressPointer {
  return !("id" in pointer);
}

/**
 * Parse APP command arguments into a napplet manifest pointer.
 *
 * Accepts the same identifier forms as `open` — note1/nevent1/naddr1, a 64-char
 * hex event id, and `kind:pubkey:d-tag` — plus an archetype slug and optional
 * target (`app note nevent1…`), which resolves through the user's installed
 * napplets or grimoire's own built-in. An address pointer's kind is checked here;
 * an event pointer's kind is unknowable until the event is fetched, so that check
 * happens at resolution time.
 *
 * Pointer forms win. The slug branch is only reached when nothing addressable
 * parsed, so an archetype named `notes` cannot shadow a `note1…` identifier.
 *
 * `napplet-archetype` is the one deliberate dynamic import in this chain, and it
 * is load-bearing rather than a size optimization: this module is imported
 * eagerly by the command registry, and `napplet-archetype` reaches back to
 * `command-parser` → `man.ts` → here. A static edge would close that cycle and
 * leave whichever module initialized first holding an undefined binding.
 */
export async function parseAppCommand(
  args: string[],
): Promise<ParsedAppCommand | Record<string, unknown>> {
  let pointer: EventPointer | AddressPointer;
  try {
    pointer = parseOpenCommand(args).pointer;
  } catch (error) {
    const token = args[0] ?? "";
    if (!token) throw error;
    const { looksLikeArchetype, resolveArchetypeCommand } =
      await import("@/services/napplet-archetype");
    if (!looksLikeArchetype(token)) throw error;
    // May resolve to a built-in, which comes back with an appId override
    // rather than a pointer.
    return resolveArchetypeCommand(token, args.slice(1));
  }

  if (
    isAddressPointer(pointer) &&
    !(NAPPLET_KINDS as readonly number[]).includes(pointer.kind)
  ) {
    throw new Error(
      `Not a napplet manifest: expected kind ${NAPPLET_KINDS.join(", ")}, got ${pointer.kind}`,
    );
  }

  return { pointer };
}

/**
 * Build the relay filter that fetches the manifest event for a pointer.
 *
 * A root manifest (15129) carries no `d` tag, so a `#d: [""]` filter matches
 * nothing on any relay. Omit the tag filter entirely when the identifier is
 * empty and let the kind plus author narrow it.
 */
export function buildManifestFilter(
  pointer: EventPointer | AddressPointer,
): Filter {
  if (isAddressPointer(pointer)) {
    return {
      kinds: [pointer.kind],
      authors: [pointer.pubkey],
      ...(pointer.identifier ? { "#d": [pointer.identifier] } : {}),
      limit: 1,
    };
  }
  return { ids: [pointer.id] };
}

/** Relay hints carried by a pointer, if any. */
export function getPointerRelays(
  pointer: EventPointer | AddressPointer,
): string[] {
  return pointer.relays ?? [];
}

/**
 * NAP domains a manifest requires that the shell does not offer.
 * A non-empty result means the napplet must not be rendered.
 */
export function getMissingRequiredNaps(
  requires: readonly string[],
  domains: readonly string[],
): string[] {
  const available = new Set(domains);
  return [...new Set(requires)].filter((nap) => !available.has(nap));
}

/** Grimoire-side failures, distinct from Kehto's verification failures. */
export type NappletLookupErrorCode =
  "manifest-not-found" | "wrong-kind" | "pointer-mismatch";

export class NappletLookupError extends Error {
  constructor(
    readonly code: NappletLookupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NappletLookupError";
  }
}

/**
 * Guard a fetched event before it reaches `resolveNapplet`.
 *
 * This is load-bearing. `requestEvent` takes the first event any relay in the
 * fan-out returns, applesauce does not re-match inbound frames against the
 * filter, and `resolveNapplet` only proves that *some* validly signed manifest
 * arrived — it has no idea which one was asked for. Without these checks a
 * single hostile relay in the selection can answer with its own correctly
 * signed napplet and have grimoire render it as the requested one.
 */
export function assertManifestEvent(
  event: NostrEvent,
  pointer: EventPointer | AddressPointer,
): NostrEvent {
  if (!(NAPPLET_KINDS as readonly number[]).includes(event.kind)) {
    throw new NappletLookupError(
      "wrong-kind",
      `Kind ${event.kind} is not a napplet manifest.`,
    );
  }

  const mismatch = () => {
    throw new NappletLookupError(
      "pointer-mismatch",
      "The relay returned a manifest for a different napplet.",
    );
  };

  if ("id" in pointer) {
    if (event.id !== pointer.id) mismatch();
    if (pointer.author && event.pubkey !== pointer.author) mismatch();
    // nevent may carry a kind hint even though EventPointer does not type one.
    const hintedKind = (pointer as { kind?: number }).kind;
    if (hintedKind !== undefined && event.kind !== hintedKind) mismatch();
    return event;
  }

  // A root manifest carries no d tag, so `35129:<pk>:` would otherwise be
  // satisfied by a 15129 event from the same author — hence the kind check.
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  if (
    event.kind !== pointer.kind ||
    event.pubkey !== pointer.pubkey ||
    dTag !== pointer.identifier
  ) {
    mismatch();
  }
  return event;
}
