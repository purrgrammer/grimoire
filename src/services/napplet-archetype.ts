/**
 * Archetype as an address: `app profile` instead of `app naddr1…`.
 *
 * NAP-INTENT already establishes that an archetype names a *role* ("show me a
 * profile") independent of which napplet fills it, and that the user owns the
 * mapping. Grimoire dispatches on kind the same way — `open` picks a renderer
 * from the event, not from the user naming one — so letting the launcher accept
 * a role is the same idea one layer up, and it is how a napplet stops being a
 * bookmark you have to remember.
 *
 * Resolution is deliberately narrow: the user's default, or a sole candidate.
 * Anything ambiguous errors with the candidate list rather than guessing, because
 * a silent wrong pick is indistinguishable from the right one until the wrong
 * napplet has your data.
 *
 * Candidates come from the launcher's own cached manifests — already verified
 * when they were first run — so this reads no relays and cannot be steered by
 * one. A napplet the user has never run is invisible here, which is the intended
 * shape: `app <archetype>` is for things you use, not a discovery surface.
 *
 * Where grimoire already fills the role natively (`napplet-builtins`), it is the
 * fallback: an archetype nothing installed handles resolves to the built-in
 * rather than failing. Napplets take precedence, so installing one is what
 * overrides the built-in — the built-in never competes with it for a choice.
 */

import type { AddressPointer } from "@/lib/open-parser";
import { APP_ID_OVERRIDE } from "@/lib/command-parser";
import { getNappletArchetypes } from "@/lib/nip5d-helpers";
import { getDefaultHandler } from "./napplet-intent-defaults";
import { listNapplets, pointerFromCoordinate } from "./napplet-library";
import {
  BUILTIN_ARCHETYPES,
  builtinHandlerDTag,
  buildBuiltinWindow,
} from "./napplet-builtins";

/** An archetype slug: lowercase, hyphen or underscore separated. */
const ARCHETYPE_RE = /^[a-z][a-z0-9_-]{0,63}$/;

/**
 * A bech32 identifier that failed to decode.
 *
 * `note1notactuallybech32` is all lowercase alphanumerics and would otherwise
 * read as an archetype slug, turning "that npub is malformed" into "no napplet
 * handles that role". The `1` separator is what distinguishes it from the
 * perfectly legal archetype `note`.
 */
const BROKEN_POINTER_RE = /^(note|nevent|naddr|npub|nprofile|nsec)1/;

export function looksLikeArchetype(token: string): boolean {
  return ARCHETYPE_RE.test(token) && !BROKEN_POINTER_RE.test(token);
}

export type ArchetypeCandidate =
  | { kind: "napplet"; dTag: string; title: string; pointer: AddressPointer }
  | { kind: "builtin"; dTag: string; title: string };

export interface ArchetypeRole {
  archetype: string;
  /** Napplets first, then the built-in if grimoire fills this role. */
  candidates: ArchetypeCandidate[];
  /** The user's pick, if it is still available. */
  defaultDTag?: string;
  /** What `app <archetype>` would open, or undefined if it would refuse. */
  resolved?: ArchetypeCandidate;
}

/**
 * Every archetype the installed napplets declare or grimoire fills, in launcher
 * order.
 *
 * One pass serves both resolution and the launcher's role list, so what the UI
 * shows and what the command does cannot disagree.
 */
export async function listArchetypeRoles(): Promise<ArchetypeRole[]> {
  const rows = await listNapplets();
  const byArchetype = new Map<string, ArchetypeCandidate[]>();

  for (const row of rows) {
    // No cached manifest means no archetype tags to read. The napplet is still
    // launchable by address; it just cannot be found by role.
    if (!row.manifest) continue;
    const pointer = pointerFromCoordinate(row.coordinate);
    if (!pointer || "id" in pointer) continue;
    const candidate: ArchetypeCandidate = {
      kind: "napplet",
      dTag: pointer.identifier,
      title: row.title || pointer.identifier,
      pointer,
    };
    for (const { slug } of getNappletArchetypes(row.manifest)) {
      const list = byArchetype.get(slug) ?? [];
      list.push(candidate);
      byArchetype.set(slug, list);
    }
  }

  // Built-ins are listed last so a napplet is always the first candidate.
  for (const builtin of BUILTIN_ARCHETYPES) {
    const list = byArchetype.get(builtin.archetype) ?? [];
    list.push({
      kind: "builtin",
      dTag: builtinHandlerDTag(builtin.archetype),
      title: builtin.title,
    });
    byArchetype.set(builtin.archetype, list);
  }

  return [...byArchetype.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([archetype, candidates]) => {
      const preferred = getDefaultHandler(archetype);
      const chosen = candidates.find((c) => c.dTag === preferred);
      const napplets = candidates.filter((c) => c.kind === "napplet");
      return {
        archetype,
        candidates,
        defaultDTag: chosen?.dTag,
        // A default wins. Otherwise a napplet does: one napplet needs no
        // choosing, and with none installed the built-in takes the role. Two
        // napplets and no default is the only case the user has to settle —
        // the built-in must not turn that into a three-way tie.
        resolved:
          chosen ??
          (napplets.length === 1
            ? napplets[0]
            : napplets.length === 0
              ? candidates.find((c) => c.kind === "builtin")
              : undefined),
      };
    });
}

/** Every installed napplet declaring `archetype`, most recently run first. */
export async function findArchetypeHandlers(
  archetype: string,
): Promise<ArchetypeCandidate[]> {
  const roles = await listArchetypeRoles();
  return roles.find((role) => role.archetype === archetype)?.candidates ?? [];
}

/**
 * Resolve an archetype to whatever should handle it.
 *
 * Throws a message the user can act on: which napplets compete for the role, or
 * that nothing — installed or built in — fills it.
 */
export async function resolveArchetype(
  archetype: string,
): Promise<ArchetypeCandidate> {
  const role = (await listArchetypeRoles()).find(
    (entry) => entry.archetype === archetype,
  );

  if (!role) {
    throw new Error(
      `Nothing handles the "${archetype}" archetype. Run a napplet that declares it, or check \`apps\`.`,
    );
  }

  if (!role.resolved) {
    const names = role.candidates
      .filter((candidate) => candidate.kind === "napplet")
      .map((candidate) => candidate.dTag)
      .join(", ");
    throw new Error(
      `Several installed napplets handle "${archetype}": ${names}. Run one by address, or set a default in \`apps\`.`,
    );
  }

  return role.resolved;
}

/**
 * What the `app` command should open for an archetype.
 *
 * A napplet resolves to a pointer the `app` window renders. A built-in resolves
 * to a different app entirely, so it comes back with the appId to use instead —
 * see `APP_ID_OVERRIDE` in `command-parser`.
 *
 * `rest` is whatever followed the slug: `app note nevent1…`. Only built-ins use
 * it, because a napplet receives its target over NAP-INTENT, not on the command
 * line — the shell has no idea what payload shape it expects.
 */
export async function resolveArchetypeCommand(
  archetype: string,
  rest: string[] = [],
): Promise<Record<string, unknown>> {
  const target = await resolveArchetype(archetype);
  if (target.kind === "napplet") return { pointer: target.pointer };

  const builtin = await buildBuiltinWindow(
    archetype,
    "open",
    undefined,
    rest[0],
  );
  return {
    ...(builtin.props as Record<string, unknown>),
    [APP_ID_OVERRIDE]: builtin.appId,
  };
}
