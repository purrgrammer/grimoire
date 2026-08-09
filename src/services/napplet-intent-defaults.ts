/**
 * The user's NAP-INTENT preferences: default handler per archetype, and which
 * napplets may address each other by name.
 *
 * Split out of `napplet-intent` because the command layer needs to read a
 * default to resolve `app <archetype>`, and `napplet-intent` imports
 * `@kehto/services` — which would drag the verification runtime and its hash
 * libraries into the eager command registry. Nothing here imports anything.
 *
 * "MUST NOT let a napplet silently set or change a default": every writer here
 * is reachable only from host UI or a command the user typed.
 */

const DEFAULTS_KEY = "napplet:intent-defaults";
const AUTHORIZED_KEY = "napplet:intent-authorized";

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
