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
import { createThemeService, createConfigService } from "@kehto/services";
import {
  resolveNapplet,
  fetchBlob,
  openNappletArtifactCache,
  isNappletManifestKind,
  NappletResolutionError,
  type NappletArtifactCache,
} from "@kehto/nip/5d";
import type { Theme as NapTheme } from "@napplet/nap/theme/types";

import pool from "./relay-pool";
import defaultEventStore from "./event-store";
import accountManager from "./accounts";
import relayStateManager from "./relay-state-manager";
import blossomServerCache from "./blossom-server-cache";
import { selectRelaysForFilter } from "./relay-selection";
import { requestEvent } from "@/lib/relay-subscription";
import { buildManifestFilter, getPointerRelays } from "@/lib/napplet-parser";
import type { AddressPointer, EventPointer } from "@/lib/open-parser";
import type { NostrEvent } from "@/types/nostr";

export { originRegistry, injectNappletNamespacePrelude, isNappletManifestKind };
export { injectCspMeta } from "@/lib/napplet-csp";
export { NappletResolutionError };
export type { ShellEnvironment, OriginIdentity, NapTheme };

/**
 * Domains this shell exposes to napplets.
 *
 * Kehto advertises `RUNTIME_NATIVE_DOMAINS` (relay, identity, storage, inc,
 * theme, keys, media, notify) unconditionally, so restricting the surface means
 * naming everything we do NOT want in `capabilities.disabledDomains`. v1 keeps
 * only `theme` and `config` — nothing that discloses the user's identity, keys,
 * or relays.
 */
const DISABLED_DOMAINS = [
  "relay",
  "identity",
  "storage",
  "inc",
  "keys",
  "media",
  "notify",
] as const;

/** Config snapshot handed to napplets. Non-sensitive, shell-owned, read-only. */
function readConfigValues(): Record<string, unknown> {
  return {
    locale: navigator.language,
    host: "grimoire",
  };
}

/**
 * Read grimoire's live theme off the document root and map it to the NAP
 * `Theme` shape. Grimoire stores HSL triples without the wrapper, so each value
 * has to be wrapped before a napplet can use it as a CSS color.
 */
function readCurrentNapTheme(): NapTheme {
  const styles = getComputedStyle(document.documentElement);
  const hsl = (name: string, fallback: string) => {
    const raw = styles.getPropertyValue(name).trim();
    return raw ? `hsl(${raw})` : fallback;
  };
  return {
    colors: {
      background: hsl("--background", "#0a0a0a"),
      text: hsl("--foreground", "#e0e0e0"),
      primary: hsl("--primary", "#7aa2f7"),
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

let themeService: ReturnType<typeof createThemeService> | null = null;

function buildAdapter(): ShellAdapter {
  themeService = createThemeService({
    initialTheme: readCurrentNapTheme(),
    // bridge.publishTheme builds its own `theme.changed` envelope and fans out
    // directly; it never calls back into this service, so there is no loop.
    onBroadcast: (envelope) => bridge?.publishTheme(envelope.theme),
  });

  const configService = createConfigService({
    getValues: () => readConfigValues(),
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
      getSigner: () => accountManager.active ?? null,
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

/**
 * The shell bridge, created on first use. The adapter instance must stay
 * stable — every frame freezes its `ShellEnvironment` from it.
 */
export function getNappletBridge(): ShellBridge {
  if (bridge) return bridge;
  adapter = buildAdapter();
  bridge = createShellBridge(adapter);
  window.addEventListener("message", bridge.handleMessage);
  window.addEventListener("pagehide", destroyNappletBridge, { once: true });
  return bridge;
}

/** Tear the bridge down. Not called when a napplet window closes — frames are
 * unregistered individually and the bridge outlives them. */
export function destroyNappletBridge(): void {
  if (!bridge) return;
  window.removeEventListener("message", bridge.handleMessage);
  bridge.destroy();
  originRegistry.clear();
  bridge = null;
  adapter = null;
  themeService = null;
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

/** Map a grimoire theme's CSS variables to the NAP `Theme` shape. */
export { readCurrentNapTheme };

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

/** Grimoire-side failures, distinct from Kehto's verification failures. */
export type NappletLookupErrorCode =
  "manifest-not-found" | "wrong-kind" | "pointer-mismatch";

export class NappletLookupError extends Error {
  constructor(
    readonly code: NappletLookupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NappletLookupError";
  }
}

/**
 * Guard a fetched event before it reaches `resolveNapplet`. Skipping the author
 * and identifier checks is how a relay substitutes a different napplet for the
 * one that was asked for.
 */
function assertManifestEvent(
  event: NostrEvent,
  pointer: EventPointer | AddressPointer,
): NostrEvent {
  if (!isNappletManifestKind(event.kind)) {
    throw new NappletLookupError(
      "wrong-kind",
      `Kind ${event.kind} is not a napplet manifest.`,
    );
  }
  if (!("id" in pointer)) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    if (event.pubkey !== pointer.pubkey || dTag !== pointer.identifier) {
      throw new NappletLookupError(
        "pointer-mismatch",
        "The relay returned a manifest for a different napplet.",
      );
    }
  }
  return event;
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
