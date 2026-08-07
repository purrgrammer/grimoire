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
import {
  rememberNappletDecision,
  getNappletDecision,
  getNappletDecisions,
  forgetNappletDecision,
  forgetNappletDecisions,
} from "./napplet-acl";

export interface NappletConsentRequest {
  key: string;
  windowId: string;
  dTag: string;
  aggregateHash: string;
  capability: string;
  /**
   * Title from the manifest. Signed by the author, but author-chosen — treat it
   * as a label, never as proof of who is asking. `pubkey` is the identity that
   * actually verified.
   */
  title: string;
  pubkey: string;
}

/** A signing confirmation, resolved by the user answering the prompt. */
export interface NappletSigningRequest {
  key: string;
  summary: string;
  detail: string;
  /** Best-effort attribution — see `noteRelayWriteAllowed`. */
  title?: string;
  pubkey?: string;
  resolve: (allowed: boolean) => void;
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
  pubkey: string;
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
  let pubkey = "";
  for (const [id, identity] of identities) {
    if (
      identity.dTag === event.identity.dTag &&
      identity.aggregateHash === event.identity.hash
    ) {
      windowId = id;
      title = identity.title;
      pubkey = identity.pubkey;
      break;
    }
  }
  if (!windowId) return;

  // A remembered deny means never ask again for this exact version.
  const remembered = getNappletDecision(
    event.identity.dTag,
    event.identity.hash,
    event.capability,
  );
  if (remembered && !remembered.allowed) {
    settled.add(key);
    return;
  }

  pending.set(key, {
    key,
    windowId,
    dTag: event.identity.dTag,
    aggregateHash: event.identity.hash,
    capability: event.capability,
    title,
    pubkey,
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
  // Never call aclState.persist(): it serializes the whole live state, which
  // would make an un-remembered grant durable. Remembering is recorded in our
  // own store and replayed on the next boot instead.
  if (remember) {
    rememberNappletDecision({
      dTag: request.dTag,
      aggregateHash: request.aggregateHash,
      capability: request.capability,
      allowed: true,
    });
  }
  resolve(request);
  reloadListeners.forEach((listener) => listener(request.windowId));
}

/**
 * Refuse the capability.
 *
 * A remembered deny is recorded as a decision, not as a firewall policy. The
 * firewall keys on dTag alone — version-agnostic and author-agnostic — so
 * `setPolicy(dTag, 'deny')` would permanently brick every napplet anyone
 * publishes under that identifier, and it rejects every operation rather than
 * the one capability that was refused. Under a restrictive default, simply not
 * granting is the whole deny; the record just stops us asking again.
 */
export function denyNappletCapability(
  request: NappletConsentRequest,
  remember: boolean,
): void {
  if (remember) {
    rememberNappletDecision({
      dTag: request.dTag,
      aggregateHash: request.aggregateHash,
      capability: request.capability,
      allowed: false,
    });
  }
  resolve(request);
}

/**
 * Take a permission back.
 *
 * Forgetting the stored decision only stops it being replayed next boot — the
 * bridge outlives individual frames, so the live ACL state still holds the
 * grant. Revoke there too, and clear the session dedupe so the napplet can ask
 * again rather than silently failing.
 */
export function revokeNappletCapability(
  dTag: string,
  aggregateHash: string,
  capability: string,
): void {
  const bridge = getNappletBridge();
  bridge.runtime.aclState.revoke(
    "",
    dTag,
    aggregateHash,
    capability as Parameters<typeof bridge.runtime.aclState.revoke>[3],
  );
  forgetNappletDecision(dTag, aggregateHash, capability);
  settled.delete(`${dTag}:${aggregateHash}:${capability}`);
}

/** Take back every remembered permission for one napplet version. */
export function revokeAllNappletCapabilities(
  dTag: string,
  aggregateHash: string,
): void {
  for (const decision of getNappletDecisions()) {
    if (decision.dTag !== dTag || decision.aggregateHash !== aggregateHash) {
      continue;
    }
    const bridge = getNappletBridge();
    bridge.runtime.aclState.revoke(
      "",
      dTag,
      aggregateHash,
      decision.capability as Parameters<
        typeof bridge.runtime.aclState.revoke
      >[3],
    );
    settled.delete(`${dTag}:${aggregateHash}:${decision.capability}`);
  }
  forgetNappletDecisions(dTag, aggregateHash);
}

/* -------------------------------------------------------------------------- */
/*  Signing confirmations                                                      */
/* -------------------------------------------------------------------------- */

const signingRequests = new Map<string, NappletSigningRequest>();
const signingListeners = new Set<(r: NappletSigningRequest[]) => void>();
let signingCounter = 0;

/**
 * Best-effort attribution for signing prompts.
 *
 * `auth.getSigner()` takes no window context, so the signer cannot know which
 * napplet is asking. The ACL check for `relay:write` happens synchronously
 * immediately before the publish path calls it, so the last window to pass that
 * check is the caller in practice. Stale entries are discarded rather than
 * shown, so a wrong name is never displayed — only a missing one.
 */
let lastWriter: { title: string; pubkey: string; at: number } | null = null;
const WRITER_ATTRIBUTION_WINDOW_MS = 2000;

export function noteRelayWriteAllowed(dTag: string, hash: string): void {
  for (const identity of identities.values()) {
    if (identity.dTag === dTag && identity.aggregateHash === hash) {
      lastWriter = {
        title: identity.title,
        pubkey: identity.pubkey,
        at: Date.now(),
      };
      return;
    }
  }
}

function emitSigning(): void {
  const snapshot = [...signingRequests.values()];
  signingListeners.forEach((listener) => listener(snapshot));
}

export function subscribeNappletSigning(
  listener: (requests: NappletSigningRequest[]) => void,
): () => void {
  signingListeners.add(listener);
  listener([...signingRequests.values()]);
  return () => signingListeners.delete(listener);
}

/** Ask the user to confirm a signing operation. Resolves false on refusal. */
export function requestSigningConsent(input: {
  summary: string;
  detail: string;
}): Promise<boolean> {
  const attribution =
    lastWriter && Date.now() - lastWriter.at < WRITER_ATTRIBUTION_WINDOW_MS
      ? lastWriter
      : null;

  return new Promise<boolean>((resolveConsent) => {
    const key = `sign-${++signingCounter}`;
    signingRequests.set(key, {
      key,
      summary: input.summary,
      detail: input.detail,
      title: attribution?.title,
      pubkey: attribution?.pubkey,
      resolve: (allowed) => {
        signingRequests.delete(key);
        emitSigning();
        resolveConsent(allowed);
      },
    });
    emitSigning();
  });
}
