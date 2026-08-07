/**
 * NIP-5D napplet host — the single seam between grimoire and Kehto.
 *
 * Every `@kehto/*` and `@napplet/*` import in the app lives here, apart from
 * the three kind constants imported by `src/lib/napplet-parser.ts`. Kehto is
 * pre-1.0 and NIP-5D is a draft, so keeping the surface in one file bounds what
 * an upstream break can touch.
 *
 * Responsibilities:
 *  - build a `ShellAdapter` over grimoire's existing singletons,
 *  - own the lazily-created `ShellBridge` and its global `message` listener,
 *  - resolve a manifest event into verified bytes via `resolveNapplet`.
 *
 * It deliberately does NOT create iframes — that lives in `NappletViewer`,
 * because the registration ordering has to interleave with React's lifecycle.
 */

import {
  createShellBridge,
  originRegistry,
  resolveShellEnvironment,
  injectNappletNamespacePrelude,
  type ShellAdapter,
  type ShellBridge,
  type ShellEnvironment,
  type OriginIdentity,
  type RelayPoolLike,
} from "@kehto/shell";
import {
  createThemeService,
  createConfigService,
  createKeysService,
  createIdentityService,
} from "@kehto/services";
import {
  resolveNapplet,
  fetchBlob,
  openNappletArtifactCache,
  NappletResolutionError,
  type NappletArtifactCache,
} from "@kehto/nip/5d";
import type { Theme as NapTheme } from "@napplet/nap/theme/types";
import type { Theme as GrimoireTheme } from "@/lib/themes";

import {
  resetKehtoAclStore,
  isAclRestrictive,
  replayRememberedGrants,
  persistFirewall,
  restoreFirewall,
} from "./napplet-acl";
import pool from "./relay-pool";
import defaultEventStore from "./event-store";
import accountManager from "./accounts";
import { createNappletSigner } from "./napplet-signer";
import relayStateManager from "./relay-state-manager";
import blossomServerCache from "./blossom-server-cache";
import { getProfileContent } from "applesauce-core/helpers";
import { selectRelaysForFilter } from "./relay-selection";
import { requestEvent } from "@/lib/relay-subscription";
import {
  buildManifestFilter,
  getPointerRelays,
  assertManifestEvent,
  NappletLookupError,
} from "@/lib/napplet-parser";
import type { AddressPointer, EventPointer } from "@/lib/open-parser";
import type { NostrEvent } from "@/types/nostr";

export { originRegistry, injectNappletNamespacePrelude };
export { injectCspMeta } from "@/lib/napplet-csp";
export { NappletResolutionError };
export { NappletLookupError } from "@/lib/napplet-parser";
export type { NappletLookupErrorCode } from "@/lib/napplet-parser";
export type { ShellEnvironment, OriginIdentity, NapTheme };

/**
 * Domains this shell refuses to advertise.
 *
 * Kehto advertises all of `RUNTIME_NATIVE_DOMAINS` unconditionally, so
 * restricting the surface means naming what we do NOT back. Advertising a
 * domain we cannot honour is worse than withholding it — `notify` in
 * particular answers `notify.send` with a fabricated id and
 * `notify.permission.request` with `granted: true` when no service is
 * registered, i.e. it lies that delivery succeeded.
 *
 * `relay` stays off until the signer is wrapped with a destructive-kind
 * prompt: `relay:write` reaches `getSigner().signEvent` and the runtime has no
 * consent gate of its own on that path.
 */
const DISABLED_DOMAINS = ["relay", "notify"] as const;

/**
 * Chords grimoire owns. A napplet holding `keys:forward` can synthesize
 * host-level keystrokes, so the command palette and workspace switches must
 * not be bindable or drivable from inside a frame.
 */
const RESERVED_CHORDS = [
  "Cmd+K",
  "Ctrl+K",
  ...Array.from({ length: 9 }, (_, i) => `Cmd+${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `Ctrl+${i + 1}`),
] as const;

/** Config snapshot handed to napplets. Non-sensitive, shell-owned, read-only. */
function readConfigValues(): Record<string, unknown> {
  return {
    locale: navigator.language,
    host: "grimoire",
  };
}

/**
 * Map a grimoire theme to the NAP `Theme` shape. Grimoire stores HSL triples
 * without the wrapper, so each value is wrapped before a napplet can use it as
 * a CSS color.
 *
 * Read from the theme object rather than computed CSS variables: ThemeProvider
 * writes those variables in its own passive effect, and React flushes passive
 * effects children-before-parents, so a consumer effect would always observe
 * the previous theme's values.
 */
export function toNapTheme(theme: GrimoireTheme): NapTheme {
  return {
    colors: {
      background: `hsl(${theme.colors.background})`,
      text: `hsl(${theme.colors.foreground})`,
      primary: `hsl(${theme.colors.primary})`,
    },
  };
}

/**
 * Adapt applesauce's `RelayPool` to Kehto's structural `RelayPoolLike`.
 *
 * `subscription()` must carry `{ eventStore }` — the v6 default is a throwaway
 * in-memory store, which silently drops events. Nothing reads an `"EOSE"`
 * sentinel here: v6 pool subscriptions no longer emit one.
 */
function adaptRelayPool(): RelayPoolLike {
  return {
    subscription: (relayUrls, filters) =>
      pool.subscription(relayUrls, filters, {
        eventStore: defaultEventStore,
      }),
    publish: (relayUrls, event) =>
      pool.publish(relayUrls, event).then(() => undefined),
    request: (relayUrls, filters) =>
      pool.request(relayUrls, filters, { eventStore: defaultEventStore }),
  };
}

const nappletSigner = createNappletSigner();

let themeService: ReturnType<typeof createThemeService> | null = null;
let keysService: ReturnType<typeof createKeysService> | null = null;

function buildAdapter(): ShellAdapter {
  themeService = createThemeService({
    // bridge.publishTheme builds its own `theme.changed` envelope and fans out
    // directly; it never calls back into this service, so there is no loop.
    onBroadcast: (envelope) => bridge?.publishTheme(envelope.theme),
  });

  const configService = createConfigService({
    getValues: () => readConfigValues(),
  });

  // No onForward: a napplet must not be able to drive grimoire's own hotkey
  // table. The service still answers registerAction/bindings so napplets can
  // own chords inside their own frame.
  keysService = createKeysService({
    reservedChords: RESERVED_CHORDS,
  });

  const identityService = createIdentityService({
    getSigner: () => (accountManager.active ? nappletSigner : null),
    getProfile: (pubkey) => {
      if (!pubkey) return null;
      const event = defaultEventStore.getReplaceable(0, pubkey);
      return event ? (getProfileContent(event) ?? null) : null;
    },
    getFollows: (pubkey) => {
      if (!pubkey) return [];
      const event = defaultEventStore.getReplaceable(3, pubkey);
      if (!event) return [];
      return event.tags
        .filter((t) => t[0] === "p" && t[1]?.length === 64)
        .map((t) => t[1]);
    },
  });

  return {
    relayPool: {
      getRelayPool: () => adaptRelayPool(),
      // No relay domain is exposed in v1, so nothing can reach these.
      trackSubscription: () => {},
      untrackSubscription: () => {},
      openScopedRelay: () => {},
      closeScopedRelay: () => {},
      publishToScopedRelay: () => false,
      selectRelayTier: () => [],
    },
    relayConfig: {
      // A napplet must not mutate the user's relay list.
      addRelay: () => {},
      removeRelay: () => {},
      getRelayConfig: () => ({
        discovery: Object.keys(relayStateManager.getState().relays),
        super: [],
        outbox: [],
      }),
      getNip66Suggestions: () => [],
    },
    // Napplets cannot spawn grimoire windows yet; null is the "refuse" contract.
    windowManager: { createWindow: () => null },
    auth: {
      getUserPubkey: () => accountManager.active?.pubkey ?? null,
      // Never hand a napplet the raw account signer: the runtime has no
      // consent gate on relay.publish or relay.publishEncrypted.
      getSigner: () => (accountManager.active ? nappletSigner : null),
    },
    config: { getNappUpdateBehavior: () => "banner" },
    hotkeys: { executeHotkeyFromForward: () => {} },
    workerRelay: { getWorkerRelay: () => null },
    crypto: {
      verifyEvent: async (event) => {
        const { verifyEvent } = await import("nostr-tools/pure");
        return verifyEvent(event as Parameters<typeof verifyEvent>[0]);
      },
    },
    capabilities: { disabledDomains: DISABLED_DOMAINS },
    // Services must be present BEFORE createShellBridge: buildShellCapabilities
    // snapshots this map, so anything registered later via
    // runtime.registerService() is routed but never advertised in shell.init.
    services: {
      theme: themeService.handler,
      config: configService.handler,
      keys: keysService,
      identity: identityService,
    },
    onAclCheck: (event) => {
      // Both allows and denials arrive here. Denials are the interesting half:
      // under a restrictive default they are how a missing grant surfaces.
      if (event.decision === "allow" && event.capability === "relay:write") {
        void import("./napplet-consent").then((m) =>
          m.noteRelayWriteAllowed(event.identity.dTag, event.identity.hash),
        );
      }
      if (event.decision === "deny") {
        // `reason` is sent by @kehto/runtime 0.21 but absent from
        // @kehto/shell 0.19's AclCheckEvent type — package version drift.
        const reason =
          (event as { reason?: string }).reason ?? "capability-missing";
        console.debug(
          `[napplet] denied ${event.capability} to "${event.identity.dTag}" (${reason})`,
        );
      }
      aclCheckListeners.forEach((listener) => listener(event));
    },
    onHashMismatch: (dTag, claimed, computed) =>
      console.warn(
        `[napplet] aggregate mismatch for "${dTag}": claimed ${claimed}, computed ${computed}`,
      ),
    onUnroutedMessage: (info) =>
      console.warn("[napplet] dropped unroutable message", info),
  };
}

let bridge: ShellBridge | null = null;
let adapter: ShellAdapter | null = null;

export type AclCheckEvent = Parameters<
  NonNullable<ShellAdapter["onAclCheck"]>
>[0];

const aclCheckListeners = new Set<(event: AclCheckEvent) => void>();

/** Observe every ACL decision. Returns an unsubscribe function. */
export function onNappletAclCheck(
  listener: (event: AclCheckEvent) => void,
): () => void {
  aclCheckListeners.add(listener);
  return () => aclCheckListeners.delete(listener);
}

/**
 * The shell bridge, created on first use. The adapter instance must stay
 * stable — every frame freezes its `ShellEnvironment` from it.
 */
export function getNappletBridge(): ShellBridge {
  if (bridge) return bridge;

  // Must precede createShellBridge: createRuntime calls aclState.load() during
  // init, and that load is the only reachable way to install a restrictive
  // default policy. Resetting unconditionally also discards whatever the
  // previous session's runtime.destroy() persisted — the live state includes
  // one-shot grants that must not survive a reload.
  resetKehtoAclStore();

  adapter = buildAdapter();
  bridge = createShellBridge(adapter);

  if (!isAclRestrictive(bridge.runtime.aclState)) {
    // deserialize() fails open to permissive. Carrying on would mean every
    // napplet holds every capability, so refuse to run any of them.
    bridge.destroy();
    bridge = null;
    adapter = null;
    throw new Error(
      "Napplet ACL failed to initialise as restrictive; refusing to run napplets.",
    );
  }

  // Only decisions the user chose to remember are reinstated.
  replayRememberedGrants(bridge.runtime.aclState);
  restoreFirewall(bridge.runtime.firewallState);

  window.addEventListener("message", bridge.handleMessage);
  window.addEventListener("pagehide", destroyNappletBridge, { once: true });
  return bridge;
}

/** Tear down one napplet window. The bridge outlives it. */
export function destroyNappletWindow(windowId: string): void {
  // Kehto's ShellBridge has no destroyWindow, so the runtime call and the
  // registry call are both ours to make. Skipping the first leaks that
  // window's subscriptions and INC state.
  bridge?.runtime.destroyWindow(windowId);
  originRegistry.unregister(windowId);
}

/** Tear the bridge down. Not called when a napplet window closes — frames are
 * unregistered individually and the bridge outlives them. */
export function destroyNappletBridge(): void {
  if (!bridge) return;
  persistFirewall(bridge.runtime.firewallState);
  window.removeEventListener("message", bridge.handleMessage);
  bridge.destroy();
  // runtime.destroy() persists the whole live ACL state, one-shot grants
  // included. Scrub it; remembered decisions live in our own store.
  resetKehtoAclStore();
  keysService?.destroy();
  originRegistry.clear();
  bridge = null;
  adapter = null;
  themeService = null;
  keysService = null;
}

/** Resolve the frozen per-frame environment for a verified identity. */
export function getNappletEnvironment(
  identity: OriginIdentity,
): ShellEnvironment {
  getNappletBridge();
  return resolveShellEnvironment(adapter!, identity);
}

/** Push a theme change to every eligible loaded napplet. */
export function publishNappletTheme(theme: NapTheme): void {
  themeService?.publishTheme(theme);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => destroyNappletBridge());
}

/* -------------------------------------------------------------------------- */
/*  Resolution                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Fetch the manifest event a pointer names.
 *
 * Uses `requestEvent` (one-shot, first match wins, hard-bounded) rather than
 * `pool.subscription()` — v6 pool subscriptions never emit EOSE, so there is no
 * completion signal to wait on. The event lands in the shared EventStore, which
 * is where the window title and kind renderers read it from.
 */
export async function fetchManifestEvent(
  pointer: EventPointer | AddressPointer,
): Promise<NostrEvent> {
  const filter = buildManifestFilter(pointer);

  const cached = defaultEventStore.getTimeline(filter)?.[0];
  if (cached) return assertManifestEvent(cached, pointer);

  const selection = await selectRelaysForFilter(defaultEventStore, filter);
  const relays = [
    ...new Set([...getPointerRelays(pointer), ...selection.relays]),
  ];

  const event = await requestEvent(relays, filter);
  if (!event) {
    throw new NappletLookupError(
      "manifest-not-found",
      "No relay returned a manifest for this pointer.",
    );
  }
  return assertManifestEvent(event, pointer);
}

export interface ResolvedNappletView {
  identity: OriginIdentity;
  /** Verified `/index.html`, before CSP and namespace injection. */
  indexHtml: string;
  requires: readonly string[];
  fileCount: number;
  title?: string;
  description?: string;
  manifestEvent: NostrEvent;
}

let artifactCache: Promise<NappletArtifactCache | undefined> | null = null;

function getArtifactCache(): Promise<NappletArtifactCache | undefined> {
  // Cache Storage can be unavailable (private browsing, restricted contexts).
  // An absent cache only costs a re-fetch, so never fail the load over it.
  artifactCache ??= openNappletArtifactCache({
    requireStorageEstimate: true,
  }).catch(() => undefined);
  return artifactCache;
}

/**
 * Fetch a blob from Blossom. Untrusted by construction — `resolveNapplet`
 * re-hashes whatever comes back.
 */
async function grimoireFetchBlob(
  sha256Hex: string,
  servers: readonly string[],
  authorServers: readonly string[],
): Promise<Uint8Array> {
  const candidates = [...new Set([...servers, ...authorServers])];
  return fetchBlob(candidates, sha256Hex, async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`blob ${url}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  });
}

/**
 * Verify a manifest event end to end and return the bytes that may be rendered.
 *
 * `resolveNapplet` checks the signature, fetches and re-hashes every blob,
 * recomputes the NIP-5A aggregate and asserts it matches the `x` tag. Identity
 * is computed here from the verified bytes, never accepted from a caller.
 */
export async function resolveNappletFromEvent(
  event: NostrEvent,
): Promise<ResolvedNappletView> {
  const authorServers =
    (await blossomServerCache.getServers(event.pubkey)) ?? [];

  const resolved = await resolveNapplet({
    event,
    cache: await getArtifactCache(),
    fetchBlob: (sha256Hex, servers) =>
      grimoireFetchBlob(sha256Hex, servers, authorServers),
  });

  return {
    identity: Object.freeze({
      dTag: resolved.dTag,
      aggregateHash: resolved.aggregateHash,
    }),
    indexHtml: resolved.indexHtml,
    requires: resolved.manifest.requires,
    fileCount: resolved.files.size,
    title: resolved.manifest.title,
    description: resolved.manifest.description,
    manifestEvent: event,
  };
}
