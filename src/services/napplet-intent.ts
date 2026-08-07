/**
 * NAP-INTENT: archetype dispatch between napplets.
 *
 * The spec's hard rules, and where each is satisfied:
 *
 *  - "MUST source available()/handlers() from the installed-napplet catalog
 *    (signed NIP-5A manifests), not from currently-running instances" — the
 *    catalog is built from `napplet-library`, which only records a napplet
 *    after `resolveNapplet` verified its signature, aggregate and blob hashes.
 *  - "MUST keep a user-overridable default per archetype" — `defaults` below.
 *  - "MUST NOT let a napplet silently set or change a default" — nothing here
 *    is reachable from a napplet message; defaults change only from host UI.
 *  - "MUST NOT let a napplet learn the identity of, or address, another napplet
 *    except through this resolution" — explicit `handler: "<dTag>"` goes
 *    through `authorizeExplicitHandler`, which requires a stored authorization.
 *  - "MUST deliver payload to the resolved handler only after that handler is
 *    ready" — the target controller waits for the frame's session before
 *    dispatching.
 *
 * Archetype and convention are orthogonal (N:M): the archetype routes, the
 * convention shapes the payload. Kehto's `createCatalogIntentResolver` handles
 * the matching; everything host-owned lives here.
 */

import {
  createCatalogIntentResolver,
  manifestToIntentCatalogEntry,
  type IntentCatalogEntry,
  type IntentTargetController,
} from "@kehto/services";

import { listNapplets, pointerFromCoordinate } from "./napplet-library";
import defaultEventStore from "./event-store";
import { getNappletArchetypes, getNappletTitle } from "@/lib/nip5d-helpers";

const DEFAULTS_KEY = "napplet:intent-defaults";
const AUTHORIZED_KEY = "napplet:intent-authorized";

/* -------------------------------------------------------------------------- */
/*  User state                                                                 */
/* -------------------------------------------------------------------------- */

function readMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, value: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A lost preference just means the chooser appears again.
  }
}

/** The user's default handler for an archetype, if they picked one. */
export function getDefaultHandler(archetype: string): string | undefined {
  return readMap(DEFAULTS_KEY)[archetype];
}

/** Set from host UI only — a napplet must never reach this. */
export function setDefaultHandler(archetype: string, dTag: string): void {
  writeMap(DEFAULTS_KEY, { ...readMap(DEFAULTS_KEY), [archetype]: dTag });
}

export function clearDefaultHandler(archetype: string): void {
  const defaults = readMap(DEFAULTS_KEY);
  delete defaults[archetype];
  writeMap(DEFAULTS_KEY, defaults);
}

export function getIntentDefaults(): Record<string, string> {
  return readMap(DEFAULTS_KEY);
}

/**
 * Whether the user has allowed one napplet to name another directly.
 *
 * Naming a handler bypasses archetype resolution, so the spec asks that it be
 * user-authorized. Absent an authorization, an explicit handler falls back to
 * ordinary resolution rather than being honoured.
 */
export function isExplicitTargetingAuthorized(
  sender: string,
  handler: string,
): boolean {
  return readMap(AUTHORIZED_KEY)[`${sender}->${handler}`] === "1";
}

export function authorizeExplicitTargeting(
  sender: string,
  handler: string,
): void {
  writeMap(AUTHORIZED_KEY, {
    ...readMap(AUTHORIZED_KEY),
    [`${sender}->${handler}`]: "1",
  });
}

/* -------------------------------------------------------------------------- */
/*  Catalog                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build the intent catalog from verified manifests.
 *
 * The library records the coordinate; the manifest event carrying the
 * `archetype` tags is read back from the shared EventStore, which only holds
 * events that arrived through a verified path.
 */
export async function loadIntentCatalog(): Promise<IntentCatalogEntry[]> {
  const rows = await listNapplets();
  const entries: IntentCatalogEntry[] = [];

  for (const row of rows) {
    const pointer = pointerFromCoordinate(row.coordinate);
    if (!pointer || "id" in pointer) continue;

    const event = defaultEventStore.getReplaceable(
      pointer.kind,
      pointer.pubkey,
      pointer.identifier || undefined,
    );
    if (!event) continue;

    const archetypes = getNappletArchetypes(event);
    if (archetypes.length === 0) continue;

    entries.push(
      manifestToIntentCatalogEntry({
        dTag: pointer.identifier,
        title: getNappletTitle(event) ?? row.title,
        archetypes,
      }),
    );
  }

  return entries;
}

/* -------------------------------------------------------------------------- */
/*  Resolver                                                                   */
/* -------------------------------------------------------------------------- */

export interface IntentChooser {
  /** Ask the user which candidate should handle an archetype. */
  choose(
    archetype: string,
    candidates: { dTag: string; title?: string }[],
    sender: string,
  ): Promise<string | undefined>;
}

export function createNappletIntentResolver(options: {
  targets: IntentTargetController;
  chooser: IntentChooser;
}) {
  return createCatalogIntentResolver({
    loadCatalog: loadIntentCatalog,
    targets: options.targets,
    getDefaultHandler,

    chooseHandler: (archetype, candidates, sender) =>
      options.chooser.choose(
        archetype,
        candidates.map((c) => ({ dTag: c.dTag, title: c.title })),
        sender,
      ),

    // "The handler: '<dTag>' form SHOULD require that the user has authorized
    // cross-napplet targeting for the caller." Without that, a napplet could
    // address another directly and skip archetype resolution entirely.
    authorizeExplicitHandler: (sender, handler) =>
      isExplicitTargetingAuthorized(sender, handler),
  });
}
