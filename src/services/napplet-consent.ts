/**
 * Per-use capability consent for napplets.
 *
 * The shape is forced by Kehto: `aclState.check()` is synchronous and
 * `onAclCheck` is observe-only, so a prompt cannot suspend the operation the
 * way a relay AUTH challenge can. The flow is therefore:
 *
 *   napplet calls a capability → runtime denies → we observe the denial →
 *   prompt → on allow, grant and reload the frame so the call succeeds.
 *
 * Reloading is coarse but honest: it re-runs the verified bytes with the
 * capability actually in place, rather than leaving the napplet believing a
 * call succeeded when it was refused.
 *
 * A napplet that polls a denied capability would otherwise spam prompts, so
 * every (dTag, aggregateHash, capability) triple is asked at most once per
 * session unless the answer is remembered.
 */

import {
  getNappletBridge,
  onNappletAclCheck,
  type AclCheckEvent,
} from "./napplet-host";
import { persistFirewall } from "./napplet-acl";

export interface NappletConsentRequest {
  key: string;
  windowId: string;
  dTag: string;
  aggregateHash: string;
  capability: string;
  /** Human title from the verified manifest, when the frame registered one. */
  title: string;
}

/** What a capability actually lets a napplet do, in the user's terms. */
const CAPABILITY_DESCRIPTIONS: Record<string, string> = {
  "identity:read": "see who you are signed in as",
  "state:read": "read the data it saved",
  "state:write": "save data on this device",
  "theme:read": "follow your colour theme",
  "config:read": "read your locale settings",
  "relay:read": "read events from your relays",
  "relay:write": "publish events signed as you",
  "keys:forward": "send keystrokes to grimoire",
  "keys:bind": "register keyboard shortcuts",
  "media:control": "control media playback",
  "notify:send": "send you notifications",
  "notify:channel": "request notification permission",
  "upload:write": "upload files as you",
  "resource:fetch": "fetch content from the network",
  "intent:read": "see which napplets you have",
  "intent:write": "open other napplets",
  "dm:read": "read your private messages",
  "dm:write": "send private messages as you",
};

export function describeCapability(capability: string): string {
  return CAPABILITY_DESCRIPTIONS[capability] ?? `use ${capability}`;
}

interface RegisteredIdentity {
  dTag: string;
  aggregateHash: string;
  title: string;
}

const identities = new Map<string, RegisteredIdentity>();
const pending = new Map<string, NappletConsentRequest>();
/** Triples already answered or asked this session — never re-prompt. */
const settled = new Set<string>();

type Listener = (requests: NappletConsentRequest[]) => void;
const listeners = new Set<Listener>();
const reloadListeners = new Set<(windowId: string) => void>();

function emit(): void {
  const snapshot = [...pending.values()];
  listeners.forEach((listener) => listener(snapshot));
}

/** Subscribe to the pending consent queue. Returns an unsubscribe function. */
export function subscribeNappletConsent(listener: Listener): () => void {
  listeners.add(listener);
  listener([...pending.values()]);
  return () => listeners.delete(listener);
}

/** Subscribe to "this window needs to re-run" signals. */
export function subscribeNappletReload(
  listener: (windowId: string) => void,
): () => void {
  reloadListeners.add(listener);
  return () => reloadListeners.delete(listener);
}

/**
 * Associate a live window with the verified identity running in it, so a
 * consent prompt can name the napplet rather than a bare dTag.
 */
export function registerNappletIdentity(
  windowId: string,
  identity: RegisteredIdentity,
): void {
  identities.set(windowId, identity);
}

export function unregisterNappletIdentity(windowId: string): void {
  identities.delete(windowId);
  for (const [key, request] of pending) {
    if (request.windowId === windowId) pending.delete(key);
  }
  emit();
}

function triple(event: AclCheckEvent): string {
  return `${event.identity.dTag}:${event.identity.hash}:${event.capability}`;
}

function handleDenial(event: AclCheckEvent): void {
  if (event.decision !== "deny") return;

  const key = triple(event);
  if (settled.has(key) || pending.has(key)) return;

  // Find the live window running this identity. Without one there is nothing
  // to reload after granting, so asking would be pointless.
  let windowId: string | undefined;
  let title = event.identity.dTag;
  for (const [id, identity] of identities) {
    if (
      identity.dTag === event.identity.dTag &&
      identity.aggregateHash === event.identity.hash
    ) {
      windowId = id;
      title = identity.title;
      break;
    }
  }
  if (!windowId) return;

  pending.set(key, {
    key,
    windowId,
    dTag: event.identity.dTag,
    aggregateHash: event.identity.hash,
    capability: event.capability,
    title,
  });
  emit();
}

let wired = false;

/** Start observing ACL denials. Idempotent. */
export function startNappletConsent(): void {
  if (wired) return;
  wired = true;
  onNappletAclCheck(handleDenial);
}

function resolve(request: NappletConsentRequest): void {
  pending.delete(request.key);
  settled.add(request.key);
  emit();
}

/**
 * Grant the capability and re-run the napplet.
 *
 * `remember` is the difference between a durable ACL grant and a one-shot: the
 * grant is keyed on the aggregate hash either way, so a napplet update
 * re-prompts regardless.
 */
export function allowNappletCapability(
  request: NappletConsentRequest,
  remember: boolean,
): void {
  const bridge = getNappletBridge();
  bridge.runtime.aclState.grant(
    "",
    request.dTag,
    request.aggregateHash,
    request.capability as Parameters<typeof bridge.runtime.aclState.grant>[3],
  );
  if (remember) bridge.runtime.aclState.persist();
  resolve(request);
  reloadListeners.forEach((listener) => listener(request.windowId));
}

/**
 * Refuse the capability.
 *
 * Remembering writes a firewall `deny` policy for the napplet's dTag, which is
 * version-agnostic — the deny survives an update, unlike a grant.
 */
export function denyNappletCapability(
  request: NappletConsentRequest,
  remember: boolean,
): void {
  if (remember) {
    const bridge = getNappletBridge();
    bridge.runtime.firewallState.setPolicy(request.dTag, "deny");
    persistFirewall(bridge.runtime.firewallState);
  }
  resolve(request);
}
