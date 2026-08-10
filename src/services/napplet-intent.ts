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
  type IntentCatalogEntry,
  type IntentTargetController,
} from "./kehto";

import { listNapplets, pointerFromCoordinate } from "./napplet-library";
import { BUILTIN_ARCHETYPES, builtinHandlerDTag } from "./napplet-builtins";
import defaultEventStore from "./event-store";
import { getNappletArchetypes, getNappletTitle } from "@/lib/nip5d-helpers";

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
 * Build the intent catalog from installed manifests.
 *
 * The library records the coordinate; the `archetype` tags are read from the
 * manifest event. Only a napplet the user has actually run is listed, which is
 * the spec's "installed-napplet catalog" — and it was verified (signature,
 * aggregate, every blob hash) before the library recorded it.
 *
 * **Per-row, and defensively.** `manifestToIntentCatalogEntry` *throws* on a
 * convention that is not exactly `napplet:<slug>/<action>` or a slug outside
 * `[a-z0-9][a-z0-9-]*`, and those tags are third-party input. Building the batch
 * in one expression meant one malformed tag — `["archetype","profile"]` with no
 * convention is an easy authoring slip — rejected the whole catalog, and the
 * resolver reloads it for every `available`, `handlers` and `dispatch`. So a
 * single bad tag in any installed napplet disabled NAP-INTENT for all of them.
 */
export async function loadIntentCatalog(): Promise<IntentCatalogEntry[]> {
  const rows = await listNapplets();
  const entries: IntentCatalogEntry[] = [];

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

    const archetypes = getNappletArchetypes(event);
    if (archetypes.length === 0) continue;

    try {
      entries.push(
        manifestToIntentCatalogEntry({
          dTag: pointer.identifier,
          title: getNappletTitle(event) ?? row.title,
          archetypes,
        }),
      );
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
    entries.push(
      manifestToIntentCatalogEntry({
        dTag: builtinHandlerDTag(builtin.archetype),
        title: builtin.title,
        archetypes: builtin.actions.map((action) => ({
          slug: builtin.archetype,
          convention: `napplet:${builtin.archetype}/${action}`,
        })),
      }),
    );
  }

  return entries;
}

/* -------------------------------------------------------------------------- */
/*  Resolver                                                                   */
/* -------------------------------------------------------------------------- */

export interface IntentChooserCandidate {
  dTag: string;
  title?: string;
}

export interface NappletIntentChoice {
  key: string;
  archetype: string;
  sender: string;
  candidates: IntentChooserCandidate[];
  resolve: (choice: { dTag: string; remember: boolean } | null) => void;
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
        if (choice.remember) setDefaultHandler(archetype, choice.dTag);
        resolveChoice(choice.dTag);
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
    getDefaultHandler,

    chooseHandler: (archetype, candidates, sender) =>
      askUserToChoose(
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
