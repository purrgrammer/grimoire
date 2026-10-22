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
 *    ready" — the target controller waits for the target to subscribe to the
 *    intent topic, then delivers over NAP-INC. See `napplet-readiness` for why
 *    a live session is not readiness.
 *
 * Archetype and convention are orthogonal (N:M): the archetype routes, the
 * convention shapes the payload. Kehto's `createCatalogIntentResolver` handles
 * the matching; everything host-owned lives here.
 */

import {
  createCatalogIntentResolver,
  manifestToIntentCatalogEntry,
  parseNappletManifest,
  type IntentCatalogEntry,
  type IntentTargetController,
} from "./kehto";

import { listNapplets, pointerFromCoordinate } from "./napplet-library";
import { BUILTIN_ARCHETYPES, builtinHandlerDTag } from "./napplet-builtins";
import defaultEventStore from "./event-store";
import { getNappletTitle } from "@/lib/nip5d-helpers";

/* -------------------------------------------------------------------------- */
/*  User state                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Defaults and explicit-targeting authorizations live in
 * `napplet-intent-defaults`, which imports nothing — the command layer reads a
 * default to resolve `app <archetype>` and must not pull Kehto in to do it.
 * Re-exported here so this module stays the one place the intent surface is
 * described.
 */
export {
  getDefaultHandler,
  setDefaultHandler,
  clearDefaultHandler,
  getIntentDefaults,
  isExplicitTargetingAuthorized,
  authorizeExplicitTargeting,
} from "./napplet-intent-defaults";

import {
  getDefaultHandler,
  setDefaultHandler,
  isExplicitTargetingAuthorized,
} from "./napplet-intent-defaults";

/* -------------------------------------------------------------------------- */
/*  Catalog                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What the host knows about one catalog entry, beyond what Kehto's entry holds.
 *
 * Kehto identifies a handler by an opaque, publisher-scoped catalog ID
 * (`nip5d:<kind>:<pubkey>:<d-tag>`), never by the bare d-tag — two publishers can
 * both ship a napplet called `profile`. The host's own preferences and UI are
 * still keyed by d-tag, so each entry carries its d-tag and, for an installed
 * napplet, the library coordinate it was loaded from.
 */
export interface CatalogRecord {
  /** Kehto's catalog ID: the only identity Kehto's API accepts or returns. */
  id: string;
  dTag: string;
  title?: string;
  /** Library coordinate of an installed napplet; absent for a built-in. */
  coordinate?: string;
}

/** The catalog as Kehto wants it, and what the host knows about each entry. */
export interface IntentCatalogSnapshot {
  entries: IntentCatalogEntry[];
  records: Map<string, CatalogRecord>;
}

/**
 * The records from the most recent load.
 *
 * Kehto's resolver reloads the catalog at the start of every `available`,
 * `handlers` and `invoke`, and then calls its *synchronous* hooks
 * (`getDefaultHandler`, `authorizeExplicitHandler`) — which need to translate
 * between a catalog ID and the d-tag the user's preferences are stored under.
 * They read this rather than hitting the library again.
 */
let lastRecords = new Map<string, CatalogRecord>();

/**
 * The one catalog ID for a d-tag, or `undefined` if there is none or several.
 *
 * Preferences predate catalog IDs and are keyed by d-tag. If two installed
 * napplets share one, the preference does not say which was meant, so it
 * resolves to nothing and the user is asked — failing closed is the point of
 * Kehto's publisher-scoped IDs.
 */
function catalogIdForDTag(dTag: string): string | undefined {
  let found: string | undefined;
  for (const record of lastRecords.values()) {
    if (record.dTag !== dTag) continue;
    if (found !== undefined) return undefined;
    found = record.id;
  }
  return found;
}

/**
 * Build the intent catalog from installed manifests.
 *
 * The library records the coordinate; the routing declarations are read from the
 * manifest event. Only a napplet the user has actually run is listed, which is
 * the spec's "installed-napplet catalog" — and it was verified (signature,
 * aggregate, every blob hash) before the library recorded it.
 *
 * **Per-row, and defensively.** `parseNappletManifest` and
 * `manifestToIntentCatalogEntry` *throw* on a convention that is not exactly
 * `napplet:<slug>/<action>` or a slug outside `[a-z0-9][a-z0-9-]*`, and those
 * tags are third-party input. Building the batch in one expression meant one
 * malformed tag — `["archetype","profile"]` with no convention is an easy
 * authoring slip — rejected the whole catalog, and the resolver reloads it for
 * every `available`, `handlers` and `dispatch`. So a single bad tag in any
 * installed napplet disabled NAP-INTENT for all of them.
 */
export async function loadIntentCatalogSnapshot(): Promise<IntentCatalogSnapshot> {
  const rows = await listNapplets();
  const entries: IntentCatalogEntry[] = [];
  const records = new Map<string, CatalogRecord>();

  for (const row of rows) {
    const pointer = pointerFromCoordinate(row.coordinate);
    if (!pointer || "id" in pointer) continue;

    // The manifest recorded with the row is the verified one. The EventStore is
    // only a fallback: it holds every event from every feed and `req`, so a
    // coordinate can resolve there to a version the user never ran.
    const event =
      row.manifest ??
      defaultEventStore.getReplaceable(
        pointer.kind,
        pointer.pubkey,
        pointer.identifier || undefined,
      );
    if (!event) continue;

    try {
      // Normalizes both manifest formats and derives the catalog ID from the
      // event's kind, author and d-tag, so it cannot be spoofed by a title.
      const manifest = parseNappletManifest(event);
      if (manifest.archetypes.length === 0) continue;
      if (records.has(manifest.catalogId)) continue;

      entries.push(
        manifestToIntentCatalogEntry({
          catalogId: manifest.catalogId,
          title: getNappletTitle(event) ?? row.title,
          archetypes: manifest.archetypes,
        }),
      );
      records.set(manifest.catalogId, {
        id: manifest.catalogId,
        dTag: pointer.identifier,
        title: getNappletTitle(event) ?? row.title,
        coordinate: row.coordinate,
      });
    } catch (error) {
      console.warn(
        `[napplet] skipping "${pointer.identifier}" in the intent catalog: malformed archetype tags`,
        error,
      );
    }
  }

  // Grimoire itself, for the roles it fills natively. Added last so a napplet is
  // always the earlier candidate, and skipped for any archetype a napplet
  // already claims — a built-in must never turn one installed handler into an
  // ambiguity the user has to resolve. This is also what makes
  // `intent.available("profile")` honest on a fresh install with no napplets.
  const claimed = new Set(
    entries.flatMap((entry) => Object.keys(entry.archetypes)),
  );
  for (const builtin of BUILTIN_ARCHETYPES) {
    if (claimed.has(builtin.archetype)) continue;
    const id = builtinHandlerDTag(builtin.archetype);
    entries.push(
      manifestToIntentCatalogEntry({
        catalogId: id,
        title: builtin.title,
        archetypes: builtin.actions.map((action) => ({
          slug: builtin.archetype,
          convention: `napplet:${builtin.archetype}/${action}`,
          // The built-in reads its target from the payload tolerantly (see
          // `napplet-builtins`), so there is no fixed parameter list to advertise.
          params: [],
        })),
      }),
    );
    records.set(id, { id, dTag: id, title: builtin.title });
  }

  lastRecords = records;
  return { entries, records };
}

export async function loadIntentCatalog(): Promise<IntentCatalogEntry[]> {
  return (await loadIntentCatalogSnapshot()).entries;
}

/** The host's record for a catalog ID, from a fresh load of the catalog. */
export async function findCatalogRecord(
  id: string,
): Promise<CatalogRecord | undefined> {
  return (await loadIntentCatalogSnapshot()).records.get(id);
}

/* -------------------------------------------------------------------------- */
/*  Resolver                                                                   */
/* -------------------------------------------------------------------------- */

export interface IntentChooserCandidate {
  /** Kehto's catalog ID: what the choice resolves to. Unique, unlike a d-tag. */
  id: string;
  dTag: string;
  title?: string;
}

export interface NappletIntentChoice {
  key: string;
  archetype: string;
  sender: string;
  candidates: IntentChooserCandidate[];
  resolve: (choice: { id: string; remember: boolean } | null) => void;
}

/** Long enough to be a real decision, short enough not to be a leak. */
const CHOOSER_TIMEOUT_MS = 120_000;

const choices = new Map<string, NappletIntentChoice>();
const choiceListeners = new Set<(c: NappletIntentChoice[]) => void>();
let choiceCounter = 0;

function emitChoices(): void {
  const snapshot = [...choices.values()];
  choiceListeners.forEach((listener) => listener(snapshot));
}

export function subscribeNappletIntentChoice(
  listener: (choices: NappletIntentChoice[]) => void,
): () => void {
  choiceListeners.add(listener);
  listener([...choices.values()]);
  return () => choiceListeners.delete(listener);
}

/**
 * "The shell SHOULD offer an 'open with…' chooser when handler: 'choose', or
 * when no default exists and more than one candidate is available."
 *
 * Remembering here is a user action setting a default, which is the only way a
 * default may ever change — a napplet must not be able to.
 */
function askUserToChoose(
  archetype: string,
  candidates: IntentChooserCandidate[],
  sender: string,
): Promise<string | undefined> {
  return new Promise((resolveChoice) => {
    const key = `choice-${++choiceCounter}`;
    // A chooser nobody answers must not hold the calling napplet's
    // `intent.invoke` open forever: the chooser is mounted globally, so an
    // unmount without an answer would leave the promise unresolved with nothing
    // left on screen to resolve it. Unanswered means "no handler chosen".
    const timer = setTimeout(() => {
      choices.delete(key);
      emitChoices();
      resolveChoice(undefined);
    }, CHOOSER_TIMEOUT_MS);

    choices.set(key, {
      key,
      archetype,
      sender,
      candidates,
      resolve: (choice) => {
        clearTimeout(timer);
        choices.delete(key);
        emitChoices();
        if (!choice) return resolveChoice(undefined);
        // Preferences are keyed by d-tag (see `catalogIdForDTag`), so this
        // stores the chosen entry's, not its catalog ID.
        const chosen = candidates.find((c) => c.id === choice.id);
        if (!chosen) return resolveChoice(undefined);
        if (choice.remember) setDefaultHandler(archetype, chosen.dTag);
        resolveChoice(chosen.id);
      },
    });
    emitChoices();
  });
}

export function createNappletIntentResolver(options: {
  targets: IntentTargetController;
}) {
  return createCatalogIntentResolver({
    loadCatalog: loadIntentCatalog,
    targets: options.targets,

    // The stored default is a d-tag; Kehto wants a catalog ID. See
    // `catalogIdForDTag` for why an ambiguous one resolves to nothing.
    getDefaultHandler: (archetype) => {
      const dTag = getDefaultHandler(archetype);
      return dTag === undefined ? undefined : catalogIdForDTag(dTag);
    },

    chooseHandler: (archetype, candidates, sender) =>
      askUserToChoose(
        archetype,
        candidates.map((c) => ({
          id: c.id,
          dTag: lastRecords.get(c.id)?.dTag ?? c.id,
          title: c.title,
        })),
        lastRecords.get(sender)?.dTag ?? sender,
      ),

    // "The handler: '<dTag>' form SHOULD require that the user has authorized
    // cross-napplet targeting for the caller." Without that, a napplet could
    // address another directly and skip archetype resolution entirely.
    //
    // Authorizations are stored by d-tag, so both ends are translated; a catalog
    // ID with no record (the catalog changed under the call) is refused.
    authorizeExplicitHandler: (sender, handler) => {
      const from = lastRecords.get(sender);
      const to = lastRecords.get(handler);
      if (!from || !to) return false;
      // A d-tag two installed napplets share cannot say which one was
      // authorized, so neither end may be ambiguous.
      if (catalogIdForDTag(from.dTag) !== from.id) return false;
      if (catalogIdForDTag(to.dTag) !== to.id) return false;
      return isExplicitTargetingAuthorized(from.dTag, to.dTag);
    },
  });
}
