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

import { toast } from "sonner";

import {
  getNappletBridge,
  onNappletAclCheck,
  type AclCheckEvent,
} from "./napplet-host";
import {
  setNappletWindowTitle,
  clearNappletWindowTitle,
  takeCurrentWriter,
} from "./napplet-attribution";
import {
  hasAcknowledgedUnenforceable,
  acknowledgeUnenforceable,
  rememberNappletDecision,
  getNappletDecision,
  getNappletDecisions,
  forgetNappletDecision,
  forgetNappletDecisions,
} from "./napplet-acl";
import {
  isHostCapability,
  REMOTE_MEDIA_CAPABILITY,
} from "./napplet-capabilities";

/** A per-operation confirmation, resolved by the user answering the prompt. */
export interface NappletSigningRequest {
  key: string;
  /**
   * `sign` puts the user's signature on something; `action` is any other
   * operation that needs a decision. The toast must say which — labelling a
   * window-opening request "Sign" would train the user to ignore the word.
   */
  kind: "sign" | "action";
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
  "relay:write": "publish events signed as you, to relays it names",
  "outbox:read": "read events from the right relays for each author",
  "outbox:write": "publish events signed as you, to your own relays",
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
  "cvm:call": "call external tool servers over Nostr",
  [REMOTE_MEDIA_CAPABILITY]: "load images, video and fonts from any website",
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
/** Triples already answered or asked this session — never re-prompt. */
const settled = new Set<string>();

const reloadListeners = new Set<(windowId: string) => void>();

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
  setNappletWindowTitle(windowId, identity.title);
}

export function unregisterNappletIdentity(windowId: string): void {
  identities.delete(windowId);
  clearNappletWindowTitle(windowId);
  for (const [key, group] of buffered) {
    if (group.windowId !== windowId) continue;
    clearTimeout(group.timer);
    buffered.delete(key);
  }

  // A dialog naming a napplet that is gone is worse than no dialog: answering it
  // grants a capability to something the user just closed, and leaving it there
  // means the promise behind it never settles — one leak per occurrence, plus a
  // viewer waiting on a decision that can no longer arrive.
  for (const request of [...launchRequests.values()]) {
    if (request.windowId === windowId) request.resolve(null);
  }
}

function triple(event: AclCheckEvent): string {
  return `${event.identity.dTag}:${event.identity.hash}:${event.capability}`;
}

/**
 * Group denials before asking.
 *
 * A napplet that did not declare its capabilities gets refused once per
 * capability, and each of those arrives as a separate ACL check within a few
 * milliseconds of the others. Prompting per denial produced a stack of toasts
 * that reflowed as they resolved — easy to mis-click — and a frame reload per
 * answer. Buffering briefly turns that into one dialog and one reload.
 */
const DENIAL_GROUPING_MS = 250;

interface Buffered {
  windowId: string;
  title: string;
  pubkey: string;
  capabilities: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

const buffered = new Map<string, Buffered>();

/**
 * Triples with a question on screen right now.
 *
 * `settled` marks a triple the moment it is buffered, so it cannot tell an
 * answered question from an open one — and a refusal reported while its own
 * dialog is still up would claim the user had already said no.
 */
const asking = new Set<string>();

/**
 * Re-run every live window showing this napplet version.
 *
 * The runtime's ACL state is seeded when the frame is built, so a decision
 * changed afterwards does not reach a napplet already running. Nothing here
 * changes what was decided — it only makes the frame ask again with the new
 * answer in place.
 */
function reloadNappletWindows(dTag: string, aggregateHash: string): void {
  for (const [id, identity] of identities) {
    if (identity.dTag === dTag && identity.aggregateHash === aggregateHash) {
      reloadListeners.forEach((listener) => listener(id));
    }
  }
}

/**
 * Turn a refusal into a grant, and make it take effect.
 *
 * `requestLaunchConsent` treats a remembered deny as final — it skips the
 * capability rather than re-asking, which is right for a napplet that should
 * stop nagging and wrong as the ONLY behaviour, because it left a user who
 * changed their mind with no way through. Refusing `inc` on a napplet that
 * declared it, for instance, kills its buttons for good: the launch dialog
 * never mentions the capability again, so the refusal cannot be revisited from
 * the flow that caused it.
 *
 * This is that way through. It is deliberately explicit — a button the user
 * presses on a named capability — rather than anything automatic.
 */
export function allowNappletCapability(
  dTag: string,
  aggregateHash: string,
  capability: string,
): void {
  rememberNappletDecision({ dTag, aggregateHash, capability, allowed: true });
  settled.delete(`${dTag}:${aggregateHash}:${capability}`);
  lastReported.delete(`${dTag}:${aggregateHash}:${capability}`);
  reloadNappletWindows(dTag, aggregateHash);
}

/**
 * Tell the user a refusal just happened, and offer to take it back.
 *
 * Every path above that stops without asking used to `return` in silence, and
 * from inside the napplet that is indistinguishable from a broken button: the
 * click does nothing, no dialog appears, and the only trace is a console line.
 * A napplet whose publish is refused looks dead rather than refused.
 *
 * Rate-limited per triple rather than shown once per denial, because a napplet
 * that retries on a timer would otherwise paper the screen. The refusal itself
 * is unchanged — this only makes it visible.
 */
const REFUSAL_TOAST_INTERVAL_MS = 20_000;
const lastReported = new Map<string, number>();

function reportRefusal(
  event: AclCheckEvent,
  key: string,
  remembered: boolean,
): void {
  // Its own dialog is still on screen; the answer is being given right now.
  if (asking.has(key)) return;

  const now = Date.now();
  const previous = lastReported.get(key);
  if (previous !== undefined && now - previous < REFUSAL_TOAST_INTERVAL_MS) {
    return;
  }
  lastReported.set(key, now);

  const { dTag, hash } = {
    dTag: event.identity.dTag,
    hash: event.identity.hash,
  };
  const name = identityTitle(dTag, hash);

  toast.error(`${name} was refused: ${describeCapability(event.capability)}`, {
    description: remembered
      ? "You answered no for this version. It will keep being refused until you change that."
      : "You answered no earlier in this session. Reloading grimoire asks again.",
    action: {
      label: "Allow",
      onClick: () => allowNappletCapability(dTag, hash, event.capability),
    },
  });
}

/** The napplet's own name when a live window has one, else its d-tag. */
function identityTitle(dTag: string, aggregateHash: string): string {
  for (const identity of identities.values()) {
    if (identity.dTag === dTag && identity.aggregateHash === aggregateHash) {
      return identity.title;
    }
  }
  return dTag;
}

function handleDenial(event: AclCheckEvent): void {
  if (event.decision !== "deny") return;

  const { dTag, hash } = {
    dTag: event.identity.dTag,
    hash: event.identity.hash,
  };
  const key = triple(event);
  if (settled.has(key)) {
    reportRefusal(event, key, false);
    return;
  }

  // A remembered deny means never ask again for this exact version.
  const remembered = getNappletDecision(dTag, hash, event.capability);
  if (remembered && !remembered.allowed) {
    settled.add(key);
    reportRefusal(event, key, true);
    return;
  }

  // Find the live window running this identity. Without one there is nothing
  // to re-run after granting, so asking would be pointless.
  let windowId: string | undefined;
  let title = dTag;
  let pubkey = "";
  for (const [id, identity] of identities) {
    if (identity.dTag === dTag && identity.aggregateHash === hash) {
      windowId = id;
      title = identity.title;
      pubkey = identity.pubkey;
      break;
    }
  }
  if (!windowId) return;

  // Marked as *asked*, so further denials for the same capability while the
  // dialog is open do not queue a second one. Cleared again if the question is
  // never answered — dismissing by closing the window used to mean grimoire
  // never asked about that capability again for the rest of the session.
  settled.add(key);
  asking.add(key);

  const groupKey = `${dTag}:${hash}`;
  const existing = buffered.get(groupKey);
  if (existing) {
    existing.capabilities.add(event.capability);
    return;
  }

  const group: Buffered = {
    windowId,
    title,
    pubkey,
    capabilities: new Set([event.capability]),
    timer: setTimeout(() => {
      buffered.delete(groupKey);
      void askForUndeclared(dTag, hash, group);
    }, DENIAL_GROUPING_MS),
  };
  buffered.set(groupKey, group);
}

async function askForUndeclared(
  dTag: string,
  aggregateHash: string,
  group: Buffered,
): Promise<void> {
  const capabilities = [...group.capabilities];
  const allowed = await new Promise<string[] | null>((resolveAsk) => {
    const key = `undeclared-${++launchCounter}`;
    launchRequests.set(key, {
      key,
      dTag,
      aggregateHash,
      title: group.title,
      pubkey: group.pubkey,
      capabilities,
      unenforceable: [],
      undeclared: true,
      windowId: group.windowId,
      resolve: (answer) => {
        launchRequests.delete(key);
        emitLaunch();
        resolveAsk(answer);
      },
    });
    emitLaunch();
  });

  for (const capability of capabilities) {
    asking.delete(`${dTag}:${aggregateHash}:${capability}`);
  }

  if (allowed === null) {
    // Dismissed or the window went away: the question stands, so let it be asked
    // again rather than treating silence as a decision.
    for (const capability of capabilities) {
      settled.delete(`${dTag}:${aggregateHash}:${capability}`);
    }
    return;
  }

  for (const capability of capabilities) {
    rememberNappletDecision({
      dTag,
      aggregateHash,
      capability,
      allowed: allowed.includes(capability),
    });
  }
  if (allowed.length > 0) {
    grantLaunchCapabilities(dTag, aggregateHash, allowed);
    // One reload for the whole group rather than one per capability.
    reloadListeners.forEach((listener) => listener(group.windowId));
  }
}

let wired = false;

/** Start observing ACL denials. Idempotent. */
export function startNappletConsent(): void {
  if (wired) return;
  wired = true;
  onNappletAclCheck(handleDenial);
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
  if (!isHostCapability(capability)) {
    const bridge = getNappletBridge();
    bridge.runtime.aclState.revoke(
      "",
      dTag,
      aggregateHash,
      capability as Parameters<typeof bridge.runtime.aclState.revoke>[3],
    );
  }
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
    if (isHostCapability(decision.capability)) continue;
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
/*  Launch consent                                                             */
/* -------------------------------------------------------------------------- */

export interface NappletLaunchRequest {
  key: string;
  dTag: string;
  aggregateHash: string;
  title: string;
  pubkey: string;
  /** Capabilities to decide. */
  capabilities: string[];
  /** Declared domains Kehto defines no capability for. */
  unenforceable: string[];
  /**
   * True when these capabilities were never declared in the manifest, i.e. the
   * napplet was refused once and this is the catch-up ask. A well-formed
   * napplet never reaches this path.
   */
  undeclared: boolean;
  /** Set for the undeclared path: the window to re-run once granted. */
  windowId?: string;
  resolve: (allowed: string[] | null) => void;
}

const launchRequests = new Map<string, NappletLaunchRequest>();
const launchListeners = new Set<(r: NappletLaunchRequest[]) => void>();
let launchCounter = 0;

function emitLaunch(): void {
  const snapshot = [...launchRequests.values()];
  launchListeners.forEach((listener) => listener(snapshot));
}

export function subscribeNappletLaunch(
  listener: (requests: NappletLaunchRequest[]) => void,
): () => void {
  launchListeners.add(listener);
  listener([...launchRequests.values()]);
  return () => launchListeners.delete(listener);
}

export interface LaunchDecision {
  /** Capabilities to grant before the frame is created. */
  granted: string[];
  /** True when the user refused outright and the napplet must not render. */
  cancelled: boolean;
}

/**
 * Ask once, up front, for everything the verified manifest declared.
 *
 * This is what keeps a well-behaved napplet from ever reloading: the grants are
 * applied before `srcdoc`, so its first call succeeds. Capabilities already
 * answered are reused without asking, and if nothing is left undecided the
 * promise resolves synchronously with no dialog at all.
 */
export function requestLaunchConsent(input: {
  dTag: string;
  aggregateHash: string;
  title: string;
  pubkey: string;
  capabilities: string[];
  unenforceable: string[];
}): Promise<LaunchDecision> {
  const remembered: string[] = [];
  const undecided: string[] = [];

  for (const capability of input.capabilities) {
    const decision = getNappletDecision(
      input.dTag,
      input.aggregateHash,
      capability,
    );
    if (decision?.allowed) remembered.push(capability);
    else if (decision)
      continue; // remembered deny — never re-ask
    else undecided.push(capability);
  }

  /*
   * The unenforceable list is a notice, not a question — `link` and friends
   * carry no capability, so there is nothing to answer and nothing that would
   * ever be recorded as answered. Gating the dialog on it therefore re-asked
   * on every single launch, forever. Shown once per version, then it only
   * rides along on a dialog that some real decision already raised.
   */
  const explain =
    input.unenforceable.length > 0 &&
    !hasAcknowledgedUnenforceable(input.dTag, input.aggregateHash);

  if (undecided.length === 0 && !explain) {
    return Promise.resolve({ granted: remembered, cancelled: false });
  }

  return new Promise<LaunchDecision>((resolveLaunch) => {
    const key = `launch-${++launchCounter}`;
    launchRequests.set(key, {
      key,
      dTag: input.dTag,
      aggregateHash: input.aggregateHash,
      title: input.title,
      pubkey: input.pubkey,
      capabilities: undecided,
      unenforceable: explain ? input.unenforceable : [],
      undeclared: false,
      resolve: (allowed) => {
        launchRequests.delete(key);
        emitLaunch();
        if (allowed === null) {
          resolveLaunch({ granted: [], cancelled: true });
          return;
        }
        // Only once it was actually run: a cancelled dialog explained nothing.
        if (explain) {
          acknowledgeUnenforceable(input.dTag, input.aggregateHash);
        }
        // Everything shown is answered, so nothing re-prompts later.
        for (const capability of undecided) {
          rememberNappletDecision({
            dTag: input.dTag,
            aggregateHash: input.aggregateHash,
            capability,
            allowed: allowed.includes(capability),
          });
          settled.add(`${input.dTag}:${input.aggregateHash}:${capability}`);
        }
        resolveLaunch({
          granted: [...remembered, ...allowed],
          cancelled: false,
        });
      },
    });
    emitLaunch();
  });
}

/** Apply a launch decision to the live ACL, before the frame exists. */
export function grantLaunchCapabilities(
  dTag: string,
  aggregateHash: string,
  capabilities: readonly string[],
): void {
  const bridge = getNappletBridge();
  for (const capability of capabilities) {
    // Host-enforced capabilities are ours alone; the runtime must not hold them.
    if (isHostCapability(capability)) continue;
    bridge.runtime.aclState.grant(
      "",
      dTag,
      aggregateHash,
      capability as Parameters<typeof bridge.runtime.aclState.grant>[3],
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Signing confirmations                                                      */
/* -------------------------------------------------------------------------- */

const signingRequests = new Map<string, NappletSigningRequest>();
const signingListeners = new Set<(r: NappletSigningRequest[]) => void>();
let signingCounter = 0;

/**
 * Who is asking, for the prompt.
 *
 * `auth.getSigner()` takes no window context, so the signer cannot know its
 * caller. `napplet-attribution` is written synchronously at the `relay:write`
 * ACL check that immediately precedes the signature, in the same turn, and is
 * read here before any `await` — so the name is exact rather than a guess.
 *
 * There used to be a second copy of this in this file, populated by a function
 * nobody called, which meant every prompt said "A napplet" no matter how many
 * were open. With two panes running, that is the spoofing surface the
 * attribution exists to close.
 */
function currentAttribution(): { title: string; pubkey: string } | null {
  const writer = takeCurrentWriter();
  if (!writer) return null;
  for (const identity of identities.values()) {
    if (
      identity.dTag === writer.dTag &&
      identity.aggregateHash === writer.aggregateHash
    ) {
      return { title: identity.title, pubkey: identity.pubkey };
    }
  }
  return null;
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
  return requestConfirmation({ ...input, kind: "sign" });
}

/**
 * Ask the user to confirm an operation that is not a signature.
 *
 * Shares the signing queue and its toast, because the shape is identical: one
 * napplet-originated operation, one decision, never remembered.
 */
export function requestActionConsent(input: {
  summary: string;
  detail: string;
}): Promise<boolean> {
  return requestConfirmation({ ...input, kind: "action" });
}

function requestConfirmation(input: {
  kind: "sign" | "action";
  summary: string;
  detail: string;
}): Promise<boolean> {
  // Only a signature has a synchronous ACL check in front of it; an `action`
  // confirmation is requested by host code that already knows its own context.
  const attribution = input.kind === "sign" ? currentAttribution() : null;

  return new Promise<boolean>((resolveConsent) => {
    const key = `sign-${++signingCounter}`;
    signingRequests.set(key, {
      key,
      kind: input.kind,
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
