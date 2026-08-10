/**
 * The single seam onto Kehto.
 *
 * Every `@kehto/*` and `@napplet/*` **value** the app uses is named here, and
 * `no-restricted-imports` in `eslint.config.js` blocks those packages everywhere
 * else. Type-only imports are exempt: they are erased at build time and a
 * breaking type change fails `tsc` loudly rather than at runtime.
 *
 * The point is blast radius. Every package is pre-1.0 (`@kehto/shell` 0.19,
 * `@kehto/runtime` 0.21, `@napplet/core` 0.31) and NIP-5D is a draft, so minor
 * bumps will break. Before this file the claim "all Kehto imports live in one
 * place" was a comment in `napplet-host.ts`, and it was false for five files —
 * including one written in the same change as the comment. A re-export module
 * plus a lint rule is the version of that claim the compiler can hold up.
 *
 * This is a re-export only: no logic, no state, nothing that imports back into
 * `src/services/`. That keeps it free of the import cycles that a seam living
 * inside `napplet-host.ts` would create, since the service modules Kehto needs
 * are themselves imported by the host.
 */

export {
  createShellBridge,
  originRegistry,
  resolveShellEnvironment,
  injectNappletNamespacePrelude,
} from "@kehto/shell";

export type {
  ShellAdapter,
  ShellBridge,
  ShellEnvironment,
  OriginIdentity,
  RelayPoolLike,
} from "@kehto/shell";

export {
  createThemeService,
  createConfigService,
  createIdentityService,
  createNotifyService,
  createKeysService,
  createOutboxService,
  createRelayPoolOutboxRouter,
  createUploadService,
  createIntentService,
  createResourceService,
  createCommonService,
  createListsService,
  createLinkService,
  createCatalogIntentResolver,
  manifestToIntentCatalogEntry,
} from "@kehto/services";

export type {
  IntentCatalogEntry,
  IntentTargetController,
} from "@kehto/services";

export {
  resolveNapplet,
  fetchBlob,
  openNappletArtifactCache,
  NappletResolutionError,
  NAPPLET_KINDS,
} from "@kehto/nip/5d";

export type { NappletArtifactCache } from "@kehto/nip/5d";

export type { Theme as NapTheme } from "@napplet/nap/theme/types";
