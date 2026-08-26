/**
 * NIP-5D napplet host — the single seam between grimoire and Kehto.
 *
 * Kehto reaches the app only through `./kehto`, which re-exports every value we
 * use and is enforced by `no-restricted-imports`. This file is where those
 * values are *wired*: it owns the adapter, the bridge and manifest resolution.
 * Kehto is pre-1.0 and NIP-5D is a draft, so bounding both the imports and the
 * wiring is what keeps an upstream break from spreading.
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
} from "./kehto";
import {
  createThemeService,
  createConfigService,
  createIdentityService,
  createNotifyService,
  createKeysService,
  createOutboxService,
  createRelayPoolOutboxRouter,
  createUploadService,
  createIntentService,
} from "./kehto";
import {
  resolveNapplet,
  fetchBlob,
  openNappletArtifactCache,
  NappletResolutionError,
  type NappletArtifactCache,
} from "./kehto";
import type { NapTheme } from "./kehto";
import type { Theme as GrimoireTheme } from "@/lib/themes";

import {
  resetKehtoAclStore,
  isAclRestrictive,
  replayRememberedGrants,
  persistFirewall,
  restoreFirewall,
  relaxInitBurst,
} from "./napplet-acl";
import pool from "./relay-pool";
import { createNappletRelayPool } from "./napplet-relay";
import defaultEventStore from "./event-store";
import accountManager from "./accounts";
import { createNappletSigner } from "./napplet-signer";
import {
  isSigningEnvelope,
  setCurrentWriter,
  getNappletWindowTitle,
} from "./napplet-attribution";
import { createBlossomUploader } from "./napplet-upload";
import {
  createNappletCommonService,
  createNappletListsService,
  createNappletLinkService,
} from "./napplet-social";
import { createNappletResourceService } from "./napplet-devices";
import { narrowEnvironment } from "./napplet-capabilities";
import {
  recordNappletMessage,
  isNappletMessageRecording,
  setNappletTapWanted,
  isNappletTapWanted,
  TAP_MESSAGE,
  TAP_CONTROL,
} from "./napplet-messages";
import {
  observeNappletReadiness,
  clearNappletReadiness,
} from "./napplet-readiness";
import { createNappletIntentResolver } from "./napplet-intent";
import { createNappletTargetController } from "./napplet-targets";
import { toast } from "sonner";
import { skip } from "rxjs/operators";
import type { Subscription } from "rxjs";
import relayStateManager from "./relay-state-manager";
import blossomServerCache from "./blossom-server-cache";
import { fetchUserServers } from "./blossom";
import { getCachedManifest } from "./napplet-library";
import relayListCache from "./relay-list-cache";
import { AGGREGATOR_RELAYS } from "./loaders";
import { getProfileContent } from "applesauce-core/helpers";
import { selectRelaysForFilter, fetchRelayList } from "./relay-selection";
import { requestEvent, streamWithEose } from "@/lib/relay-subscription";
import { normalizeRelayURL } from "@/lib/relay-url";
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
 * `relay:write` reaches `getSigner().signEvent`, which is why every
 * napplet-originated signature goes through `napplet-signer.ts` rather than the
 * raw account.
 *
 * `keys` is offered with its listener detached from the host document — see
 * the service construction below.
 */
const DISABLED_DOMAINS: readonly string[] = [];

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
 * Chords grimoire owns. Reserved so a napplet cannot bind the command palette
 * or a workspace switch even though its listener is already isolated.
 */
const RESERVED_CHORDS = [
  "Cmd+K",
  "Ctrl+K",
  ...Array.from({ length: 9 }, (_, i) => `Cmd+${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `Ctrl+${i + 1}`),
] as const;

let keysService: ReturnType<typeof createKeysService> | null = null;

const nappletSigner = createNappletSigner();

/** Relay URLs compare equal only once normalized, and a bad one must not throw. */
function safeNormalizeRelay(url: string): string {
  try {
    return normalizeRelayURL(url);
  } catch {
    return url;
  }
}

/** Relay subscription cleanups the runtime asked us to hold. */
const trackedSubscriptions = new Map<string, () => void>();

let themeService: ReturnType<typeof createThemeService> | null = null;

/**
 * Which pane is running a given verified identity.
 *
 * `AclCheckEvent` carries the identity but not the window, and the message log is
 * per-pane. Two panes running the same version are indistinguishable here, so the
 * first match wins — good enough for a debug log, and the reason this lookup is
 * not used for anything that must be exact.
 */
function windowIdForIdentity(
  dTag: string,
  aggregateHash: string,
): string | undefined {
  for (const windowId of originRegistry.getAllWindowIds()) {
    const frame = originRegistry.getIframeWindow(windowId);
    const identity = frame ? originRegistry.getIdentity(frame) : undefined;
    if (
      identity?.dTag === dTag &&
      identity.aggregateHash === aggregateHash &&
      isNappletMessageRecording(windowId)
    ) {
      return windowId;
    }
  }
  return undefined;
}

function buildAdapter(): ShellAdapter {
  themeService = createThemeService({
    // bridge.publishTheme builds its own `theme.changed` envelope and fans out
    // directly; it never calls back into this service, so there is no loop.
    onBroadcast: (envelope) => bridge?.publishTheme(envelope.theme),
  });

  const configService = createConfigService({
    getValues: () => readConfigValues(),
  });

  // Without a service the runtime answers notify.send with a fabricated id and
  // notify.permission.request with granted: true — it lies that delivery
  // succeeded. A real toast is the minimum bar for advertising the domain.
  //
  // `@kehto/services` 0.20 replaced `onSend`/`defaultGrant` with `present` and
  // `requestPermission`, and now fails closed when a backend is missing rather
  // than fabricating success — which is the same position this comment was
  // arguing for, so the shape changed and the intent did not.
  const notifyService = createNotifyService({
    present: ({ windowId, message }) => {
      const source = getNappletWindowTitle(windowId) ?? "A napplet";
      toast(`${source}${message.title ? `: ${message.title}` : ""}`, {
        description: message.body,
        duration: 6000,
      });
    },
    requestPermission: () => true,
  });

  // NAP-OUTBOX: relay-list-aware routing. Publishing goes through the same
  // wrapped signer as relay.publish, so destructive kinds are still confirmed.
  const outboxService = createOutboxService({
    router: createRelayPoolOutboxRouter({
      relayPool: {
        // The router waits for an explicit "EOSE" marker before it considers
        // relay-list discovery finished. applesauce v6's pool.subscription()
        // never emits one, so forwarding it alone leaves every publish hanging
        // until the router's timeout — "outbox.publish timed out".
        subscribe: (filters, relayUrls, callback) => {
          /*
           * A silent relay must not hold the whole query.
           *
           * The router fans out one subscription per relay and waits for every
           * one to say EOSE before it answers. A relay that returns
           * `auth-required` without sending an AUTH frame sends nothing at all
           * — no EVENT, no EOSE, no CLOSED — so one of them takes the entire
           * budget down with it: measured, six of seven relays EOSE'd inside
           * 300ms and the seventh never did, and every `outbox.query` failed
           * with "timed out" while holding six relays' worth of events.
           *
           * So a relay that has not finished by the deadline is treated as
           * finished. The events it already sent are kept; what it might still
           * have sent is lost, which is the correct trade against answering
           * nothing. Well under the router's own 15s budget, so the router
           * completes rather than expiring.
           */
          const EOSE_DEADLINE_MS = 6_000;
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            callback("EOSE");
          };
          const timer = setTimeout(finish, EOSE_DEADLINE_MS);

          const sub = streamWithEose(
            relayUrls,
            filters as Parameters<typeof streamWithEose>[1],
            { onEose: finish },
          ).subscribe((event) => callback(event));

          return {
            unsubscribe: () => {
              clearTimeout(timer);
              sub.unsubscribe();
            },
          };
        },
        publish: async (event, relayUrls) => {
          const responses = await pool.publish(relayUrls, event);
          // Keyed by the exact strings Kehto passed, not by `r.from`.
          // `normalizePublishResult` looks up `result[url]` for each url *it*
          // supplied and defaults a miss to `false`, while applesauce reports the
          // normalized URL — so an unslashed input made a fully successful
          // publish come back as every relay having refused it.
          const byNormalized = new Map(
            responses.map((r) => [safeNormalizeRelay(r.from), r.ok] as const),
          );
          return Object.fromEntries(
            relayUrls.map(
              (url) =>
                [
                  url,
                  byNormalized.get(safeNormalizeRelay(url)) ?? false,
                ] as const,
            ),
          );
        },
        isAvailable: () => true,
      },
      loadRelayLists: async (pubkeys) => {
        const entries = await Promise.all(
          pubkeys.map(async (pubkey) => {
            const read = async () =>
              [
                await relayListCache.getOutboxRelays(pubkey),
                await relayListCache.getInboxRelays(pubkey),
              ] as const;

            let [write, inbox] = await read();
            if (write === null && inbox === null) {
              /*
               * Cache-only, like `blossomServerCache.getServers` was. A pubkey
               * the reader has never looked at therefore routed to nothing and
               * the router fell back to the aggregators for everyone —
               * "outbox.query timed out" on a napplet whose whole job is
               * reading one person's events. Fetching on a miss is what makes
               * this the outbox model rather than a fixed relay list.
               */
              await fetchRelayList(pubkey, 5_000);
              [write, inbox] = await read();
            }

            return [pubkey, { read: inbox ?? [], write: write ?? [] }] as const;
          }),
        );
        return new Map(entries);
      },
      fallbackRelays: AGGREGATOR_RELAYS,
      // Kehto defaults this to 4s, which is under the floor the rest of grimoire
      // uses: a relay can legitimately take several seconds to EOSE, and a
      // bounded query that gives up first reports "no events" rather than "not
      // finished". Same 15s deadline as `streamWithEose`, so the two halves of a
      // publish do not disagree about when a relay has stopped answering.
      defaultTimeoutMs: 15_000,
      signEvent: (template) => nappletSigner.signEvent(template),
      verifyEvent: async (event) => {
        const { verifyEvent } = await import("nostr-tools/pure");
        return verifyEvent(event as Parameters<typeof verifyEvent>[0]);
      },
    }),
  });

  // The listener target is the whole security story for this domain. Kehto
  // defaults to the host `document`, and `parseChord` accepts modifier-less
  // chords that `isReservedKeyChord` does not block — so a napplet granted
  // keys:bind could register every letter and digit and receive a keys.action
  // for each one, reading anything typed into grimoire's palette or composer.
  // reservedChords only stops chords being *bound*. An isolated EventTarget
  // never receives a real keydown, so registerAction still answers and nothing
  // typed into the host can reach a frame.
  keysService = createKeysService({
    listenerTarget: new EventTarget(),
    reservedChords: RESERVED_CHORDS,
  });

  const uploadService = createUploadService({
    uploader: createBlossomUploader(),
    uploadInfo: { rails: [{ rail: "blossom", enabled: true }] },
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
      getRelayPool: () => createNappletRelayPool(),
      trackSubscription: (subKey, cleanup) => {
        trackedSubscriptions.get(subKey)?.();
        trackedSubscriptions.set(subKey, cleanup);
      },
      untrackSubscription: (subKey) => {
        trackedSubscriptions.get(subKey)?.();
        trackedSubscriptions.delete(subKey);
      },
      // NIP-29 scoped relays are not wired. Kehto expects the host to own the
      // socket and post frames back itself; refusing is honest, and no
      // currently published napplet uses it.
      openScopedRelay: () => {},
      closeScopedRelay: () => {},
      publishToScopedRelay: () => false,
      // Must be synchronous, so this is the live relay set rather than
      // grimoire's async outbox selection.
      selectRelayTier: () => Object.keys(relayStateManager.getState().relays),
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
    // Liveness gate for the upload domain: Kehto only advertises it when a
    // rail is actually configured.
    upload: { getUploader: () => ({ rails: ["blossom"] }) },
    // Liveness gates. Kehto only advertises these when the host says so.
    common: { isAvailable: () => true },
    intent: { isAvailable: () => true },
    lists: { isAvailable: () => true },
    link: { isAvailable: () => true },
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
    capabilities: {
      disabledDomains: DISABLED_DOMAINS,
      // A napplet's declared `requires` becomes its whole surface. Kehto
      // otherwise advertises every live domain to everyone, which would make
      // granting capabilities up front unsafe — see napplet-capabilities.
      resolveEnvironment: (identity, available) =>
        narrowEnvironment(identity.dTag, identity.aggregateHash, available),
    },
    // Services must be present BEFORE createShellBridge: buildShellCapabilities
    // snapshots this map, so anything registered later via
    // runtime.registerService() is routed but never advertised in shell.init.
    services: {
      theme: themeService.handler,
      config: configService.handler,
      identity: identityService,
      notify: notifyService,
      keys: keysService,
      resource: createNappletResourceService((windowId) => {
        const entry = bridge?.runtime.sessionRegistry
          .getAllEntries()
          .find((e) => e.windowId === windowId);
        return entry
          ? { dTag: entry.dTag, aggregateHash: entry.aggregateHash }
          : null;
      }),
      intent: createIntentService({
        resolver: createNappletIntentResolver({
          targets: createNappletTargetController(),
        }),
      }),
      common: createNappletCommonService(),
      lists: createNappletListsService(),
      link: createNappletLinkService(),
      outbox: outboxService,
      upload: uploadService,
    },
    onAclCheck: (event) => {
      // Both allows and denials arrive here. Denials are the interesting half:
      // under a restrictive default they are how a missing grant surfaces.
      // Synchronous and narrowed to publish envelopes — see napplet-attribution.
      if (
        event.decision === "allow" &&
        event.capability === "relay:write" &&
        isSigningEnvelope(event.message)
      ) {
        setCurrentWriter({
          windowId: "",
          dTag: event.identity.dTag,
          aggregateHash: event.identity.hash,
        });
      }
      // An ACL decision is the single most useful thing in the message log: it
      // is the difference between "the napplet never asked" and "the napplet
      // asked and we refused", which look identical from inside the frame.
      const subject = windowIdForIdentity(
        event.identity.dTag,
        event.identity.hash,
      );
      if (subject) {
        recordNappletMessage({
          windowId: subject,
          direction: "acl",
          label: event.capability,
          allowed: event.decision === "allow",
          data: event.message ?? null,
        });
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
let identitySubscription: Subscription | null = null;

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
 * The single `message` listener, wrapping `bridge.handleMessage`.
 *
 * Wrapping rather than registering Kehto's handler directly is what makes the
 * inbound half of the message log truthful: it sees every envelope the runtime
 * sees, including the ones the runtime goes on to drop. It also consumes the
 * in-frame tap's echoes, which are host bookkeeping and must never reach the
 * runtime — it would report them as unroutable.
 */
function handleNappletWindowMessage(event: MessageEvent): void {
  const source = event.source as Window | null;
  const windowId = source ? originRegistry.getWindowId(source) : undefined;

  if (Array.isArray(event.data) && event.data[0] === TAP_MESSAGE) {
    if (windowId) {
      recordNappletMessage({
        windowId,
        direction: "out",
        data: event.data[1],
      });
    }
    return;
  }

  if (windowId) {
    recordNappletMessage({ windowId, direction: "in", data: event.data });
    // Before the runtime, deliberately: readiness must be seen even for
    // envelopes the runtime drops, and an `inc.emit` with no subscribers is
    // dropped. See napplet-readiness.
    observeNappletReadiness(windowId, event.data);
  }
  bridge?.handleMessage(event);
}

/**
 * Turn the in-frame outbound tap on or off for one window.
 *
 * The control message is visible to the napplet, which is unavoidable — the tap
 * lives in the napplet's own document — and harmless: it carries no data and the
 * napplet already knows every message it sends.
 */
export function setNappletTapEnabled(windowId: string, on: boolean): void {
  setNappletTapWanted(windowId, on);
  originRegistry.getIframeWindow(windowId)?.postMessage([TAP_CONTROL, on], "*");
}

/** Re-arm the tap after a frame reload, which resets it to dormant. */
export function resyncNappletTap(windowId: string): void {
  if (!isNappletTapWanted(windowId)) return;
  originRegistry
    .getIframeWindow(windowId)
    ?.postMessage([TAP_CONTROL, true], "*");
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
    keysService?.destroy();
    keysService = null;
    bridge = null;
    adapter = null;
    throw new Error(
      "Napplet ACL failed to initialise as restrictive; refusing to run napplets.",
    );
  }

  // Only decisions the user chose to remember are reinstated.
  replayRememberedGrants(bridge.runtime.aclState);
  restoreFirewall(bridge.runtime.firewallState);
  relaxInitBurst(bridge.runtime.firewallState);

  window.addEventListener("message", handleNappletWindowMessage);
  // Not `pagehide` unconditionally: a bfcache'd page fires it with
  // `persisted: true` and then comes back alive, and tearing the bridge down
  // there left every mounted napplet silently dead after a back-navigation —
  // no viewer re-calls `getNappletBridge()` on restore. `{ once: true }` made it
  // permanent. Firewall state is persisted either way so nothing is lost.
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) {
      if (bridge) persistFirewall(bridge.runtime.firewallState);
      return;
    }
    destroyNappletBridge();
  });

  // NAP-IDENTITY: "The shell MUST emit identity.changed to loaded napplets
  // whenever the shell-user identity changes", and with an empty pubkey when it
  // is cleared. Without this a napplet holding identity:read keeps showing a
  // stale user after a sign-out or account switch. skip(1) because the
  // BehaviorSubject replays the current value, which the napplet already gets
  // from its own identity.getPublicKey at startup.
  identitySubscription = accountManager.active$
    .pipe(skip(1))
    .subscribe((account) =>
      bridge?.publishIdentityChanged(account?.pubkey ?? ""),
    );

  return bridge;
}

/** Tear down one napplet window. The bridge outlives it. */
export function destroyNappletWindow(windowId: string): void {
  // Kehto's ShellBridge has no destroyWindow, so the runtime call and the
  // registry call are both ours to make. Skipping the first leaks that
  // window's subscriptions and INC state.
  bridge?.runtime.destroyWindow(windowId);
  originRegistry.unregister(windowId);
  clearNappletReadiness(windowId);
}

/** Tear the bridge down. Not called when a napplet window closes — frames are
 * unregistered individually and the bridge outlives them. */
export function destroyNappletBridge(): void {
  if (!bridge) return;
  persistFirewall(bridge.runtime.firewallState);
  identitySubscription?.unsubscribe();
  identitySubscription = null;
  window.removeEventListener("message", handleNappletWindowMessage);
  // runtime.destroy() clears its own subscription map without calling the
  // cleanups it handed us, so an HMR dispose left every napplet-opened REQ
  // subscribed. Per-window teardown is fine — destroyWindow untracks by prefix.
  for (const cleanup of trackedSubscriptions.values()) cleanup();
  trackedSubscriptions.clear();
  bridge.destroy();
  keysService?.destroy();
  keysService = null;
  // runtime.destroy() persists the whole live ACL state, one-shot grants
  // included. Scrub it; remembered decisions live in our own store.
  resetKehtoAclStore();
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

  const inStore = defaultEventStore.getTimeline(filter)?.[0];
  if (inStore) return assertManifestEvent(inStore, pointer);

  const selection = await selectRelaysForFilter(defaultEventStore, filter);
  const relays = [
    ...new Set([...getPointerRelays(pointer), ...selection.relays]),
  ];

  const event = await requestEvent(relays, filter);
  if (event) return assertManifestEvent(event, pointer);

  // Relays can simply not answer — slow, offline, or the event has aged out of
  // their retention. A previously verified copy is a better answer than a dead
  // window, and it is re-verified downstream like any other.
  const cached = await getCachedManifest(pointer);
  if (cached) return assertManifestEvent(cached, pointer);

  throw new NappletLookupError(
    "manifest-not-found",
    "No relay returned a manifest for this pointer, and nothing was cached.",
  );
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
export interface NappletResolveProgress {
  /** Blobs verified so far. */
  done: number;
  /** Blobs the manifest declares. */
  total: number;
}

export async function resolveNappletFromEvent(
  event: NostrEvent,
  onProgress?: (progress: NappletResolveProgress) => void,
): Promise<ResolvedNappletView> {
  /*
   * The author's own Blossom servers, fetched when they are not already known.
   *
   * `getServers` is cache-only — memory, then Dexie, then null — so a napplet
   * whose author you have never looked at fell back to nothing, and the only
   * server tried was whatever the manifest happened to name. Gigi's
   * `profile-check` names one, `cdn.satellite.earth`, which no longer serves
   * the blob; the two servers in their published kind 10063 were never asked.
   *
   * A manifest naming one server is normal — it records where the publisher
   * put the files, not everywhere they exist — so the author's list is the
   * fallback that makes a single dead host survivable.
   */
  const authorServers =
    (await blossomServerCache.getServers(event.pubkey)) ??
    (await fetchUserServers(event.pubkey).catch(() => []));

  // Remember what was actually tried, so an unavailable blob can say where we
  // looked instead of just that we failed.
  const tried = new Set<string>();
  const total = event.tags.filter((t) => t[0] === "path" && t[1]).length;
  let verified = 0;

  let resolved;
  try {
    resolved = await resolveNapplet({
      event,
      cache: await getArtifactCache(),
      fetchBlob: async (sha256Hex, servers) => {
        for (const server of [...servers, ...authorServers]) tried.add(server);
        const bytes = await grimoireFetchBlob(
          sha256Hex,
          servers,
          authorServers,
        );
        onProgress?.({ done: ++verified, total });
        return bytes;
      },
    });
  } catch (error) {
    if (
      error instanceof NappletResolutionError &&
      error.code === "blob-unavailable" &&
      tried.size > 0
    ) {
      throw new NappletResolutionError(
        error.code,
        `${error.message}. Tried ${[...tried].join(", ")}.`,
      );
    }
    throw error;
  }

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
