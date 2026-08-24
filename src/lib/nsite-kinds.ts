/**
 * NIP-5A manifest kinds: snapshot, root, named.
 *
 * Inlined rather than imported from `@kehto/nip`, for the same reason
 * `napplet-parser.ts` inlines the 5D kinds: the command registry is eager, and
 * pulling the verification runtime and its hash libraries into startup to learn
 * three integers is a bad trade. `nsite-kinds.test.ts` asserts they stay in
 * sync with the renderer registry.
 */

export const NSITE_KIND_SNAPSHOT = 5128;
export const NSITE_KIND_ROOT = 15128;
export const NSITE_KIND_NAMED = 35128;

export const NSITE_KINDS = [
  NSITE_KIND_SNAPSHOT,
  NSITE_KIND_ROOT,
  NSITE_KIND_NAMED,
] as const;

export function isNsiteManifestKind(kind: number): boolean {
  return (NSITE_KINDS as readonly number[]).includes(kind);
}
