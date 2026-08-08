/**
 * A traffic log for the host↔napplet wire, for debugging napplets.
 *
 * Two sources, and they are not equally trustworthy:
 *
 *  - **Inbound** (napplet → host) is tapped by wrapping `bridge.handleMessage`,
 *    so it is exactly what the runtime saw, including messages the runtime then
 *    dropped as unroutable.
 *  - **Outbound** (host → napplet) has no hook. Kehto posts to frames from eight
 *    separate call sites and exposes none of them, and a cross-origin
 *    `contentWindow.postMessage` cannot be wrapped from outside. So outbound is
 *    reported by a tap inside the napplet's own document, which means a napplet
 *    could suppress or fabricate entries. That is acceptable for a developer
 *    tool and unacceptable as an audit trail — nothing security-relevant may be
 *    decided from this log.
 *
 * Nothing here is persisted. Signing envelopes carry plaintext the user has not
 * agreed to store, and a debug log outliving the session is how that leaks.
 */

export type NappletMessageDirection = "in" | "out" | "acl";

export interface NappletMessageEntry {
  seq: number;
  at: number;
  windowId: string;
  direction: NappletMessageDirection;
  /** `domain.action`, a NIP-01 verb, or `?` when the envelope has no label. */
  label: string;
  /** Set for `acl` entries: whether the runtime allowed the operation. */
  allowed?: boolean;
  /** Pretty-printed envelope, clamped. */
  payload: string;
}

/** Enough to see a handshake and the burst after it, bounded so it cannot grow. */
const CAPACITY = 500;

/** A relay event payload can be large and the drawer only ever shows a preview. */
const MAX_PAYLOAD = 4000;

const entries: NappletMessageEntry[] = [];
const listeners = new Set<() => void>();
let seq = 0;

/**
 * Windows currently being logged.
 *
 * Recording is off until a drawer asks for it. Serializing every envelope from a
 * napplet streaming a relay timeline is real work to do for nobody, and the
 * outbound tap costs an extra `postMessage` per message, so both halves stay
 * dormant together. The consequence is that a drawer opens empty — which the
 * drawer says out loud rather than looking broken.
 */
const recording = new Set<string>();

export function setNappletMessageRecording(
  windowId: string,
  on: boolean,
): void {
  if (on) recording.add(windowId);
  else recording.delete(windowId);
}

export function isNappletMessageRecording(windowId: string): boolean {
  return recording.has(windowId);
}

/**
 * Windows whose outbound tap the host has switched on.
 *
 * Tracked separately from `recording` because the tap lives in the napplet's
 * document: a reload builds a fresh one, dormant again, and the enable message
 * has to be re-sent. Without this the drawer keeps logging inbound traffic after
 * a reload and silently shows no replies — which reads as "the host stopped
 * answering" rather than "the tap went away".
 */
const tapWanted = new Set<string>();

export function setNappletTapWanted(windowId: string, on: boolean): void {
  if (on) tapWanted.add(windowId);
  else tapWanted.delete(windowId);
}

export function isNappletTapWanted(windowId: string): boolean {
  return tapWanted.has(windowId);
}

export function subscribeNappletMessages(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A short label for an envelope.
 *
 * Kehto speaks two shapes on the same channel: NIP-5D envelopes are objects with
 * a `type` in `domain.action` form, and relay traffic is bare NIP-01 arrays.
 */
export function labelOf(data: unknown): string {
  if (Array.isArray(data)) {
    const verb = typeof data[0] === "string" ? data[0] : "?";
    const sub = typeof data[1] === "string" ? `:${data[1]}` : "";
    return `${verb}${sub}`;
  }
  if (data && typeof data === "object") {
    const type = (data as { type?: unknown }).type;
    if (typeof type === "string") return type;
  }
  return "?";
}

function serialize(data: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(data, null, 1) ?? String(data);
  } catch {
    // Cyclic or non-serializable — the label is still worth keeping.
    text = "[unserializable]";
  }
  return text.length > MAX_PAYLOAD
    ? `${text.slice(0, MAX_PAYLOAD)}\n… truncated`
    : text;
}

export function recordNappletMessage(input: {
  windowId: string;
  direction: NappletMessageDirection;
  data: unknown;
  label?: string;
  allowed?: boolean;
}): void {
  if (!recording.has(input.windowId)) return;
  entries.push({
    seq: ++seq,
    at: Date.now(),
    windowId: input.windowId,
    direction: input.direction,
    label: input.label ?? labelOf(input.data),
    allowed: input.allowed,
    payload: serialize(input.data),
  });
  if (entries.length > CAPACITY) entries.splice(0, entries.length - CAPACITY);
  listeners.forEach((listener) => listener());
}

/** Everything logged for one window, oldest first. */
export function getNappletMessages(windowId: string): NappletMessageEntry[] {
  return entries.filter((entry) => entry.windowId === windowId);
}

export function clearNappletMessages(windowId: string): void {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].windowId === windowId) entries.splice(i, 1);
  }
  listeners.forEach((listener) => listener());
}

/* -------------------------------------------------------------------------- */
/*  The in-frame outbound tap                                                  */
/* -------------------------------------------------------------------------- */

/** Reserved envelope label. The host consumes these and never forwards them. */
export const TAP_MESSAGE = "__grimoire_tap__";

/** Host → frame control message that switches the tap on or off. */
export const TAP_CONTROL = "__grimoire_tap_control__";

/**
 * Script injected into every napplet document, after Kehto's prelude.
 *
 * It installs dormant and echoes nothing until the host enables it, so a closed
 * drawer costs exactly one idle listener. Enabling it doubles host-ward traffic
 * for that frame, which is why it is not on by default.
 *
 * Everything it touches is captured before the napplet's own code runs, so a
 * napplet reassigning `postMessage` or `JSON` later cannot break the tap — it
 * can still simply not send the messages the tap would have reported, which is
 * the limitation documented at the top of this file.
 */
export function buildNappletTapScript(): string {
  return `<script>(function(){
  var post = window.parent.postMessage.bind(window.parent);
  var on = false;
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (Array.isArray(data) && data[0] === ${JSON.stringify(TAP_CONTROL)}) {
      on = data[1] === true;
      return;
    }
    if (!on) return;
    try { post([${JSON.stringify(TAP_MESSAGE)}, data], "*"); } catch (e) {}
  });
})();</script>`;
}

/** Append the tap to a document that already carries its CSP and prelude. */
export function injectNappletTap(html: string): string {
  return html + buildNappletTapScript();
}
