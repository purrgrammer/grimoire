/**
 * The external Concord-ecosystem URLs grimoire links out to.
 *
 * NEW PRECEDENT: grimoire's first hardcoded external product URLs in `src`. The
 * no-hardcoded-relays law does not cover them — these are a client and a spec
 * site, not relays — but they are endpoints grimoire does not control, so they
 * live as exported constants here and every mention goes through one of them.
 */

/**
 * The hosted Armada client — where the capabilities grimoire lacks live.
 *
 * Grimoire reads Concord; it does not create, join, invite, moderate or rotate.
 * Every handoff points here.
 */
export const ARMADA_URL = "https://armada.buzz";

/** The Concord protocol itself — what the CORD documents specify. */
export const CONCORD_URL = "https://concordprotocol.org/";
