import type { Filter } from "nostr-tools";

/**
 * NIP-5D manifest kinds: snapshot, root, named.
 *
 * Inlined rather than imported from `@kehto/nip/5d` so the command registry —
 * which is eager — does not drag the whole verification runtime and its hash
 * libraries into the startup path. `napplet-parser.test.ts` asserts these stay
 * equal to Kehto's `NAPPLET_KINDS`.
 */
export const NAPPLET_KINDS = [5129, 15129, 35129] as const;
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
 * hex event id, and `kind:pubkey:d-tag`. An address pointer's kind is checked
 * here; an event pointer's kind is unknowable until the event is fetched, so
 * that check happens at resolution time.
 */
export function parseAppCommand(args: string[]): ParsedAppCommand {
  const { pointer } = parseOpenCommand(args);

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

/** Build the relay filter that fetches the manifest event for a pointer. */
export function buildManifestFilter(
  pointer: EventPointer | AddressPointer,
): Filter {
  if (isAddressPointer(pointer)) {
    return {
      kinds: [pointer.kind],
      authors: [pointer.pubkey],
      "#d": [pointer.identifier],
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
