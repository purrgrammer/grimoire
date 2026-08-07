/**
 * Which napplet is currently asking the signer to sign.
 *
 * `ShellAdapter.auth.getSigner()` takes no window context, so the signer cannot
 * know its caller. The runtime's dispatch is synchronous, though:
 * `createMessageHandler` runs the ACL check, then `handleRelayPublish`, then
 * `getSigner().signEvent(...)`, all in one turn — and both the wrapper and the
 * consent prompt read this slot before their first `await`. So a *synchronous*
 * record taken at the ACL check is exact, not a heuristic, and no other napplet
 * can interleave.
 *
 * Two things this depends on, both load-bearing:
 *
 *  - The write must not be deferred. A `void import(...).then(...)` would land
 *    a microtask too late and name the *previous* napplet — which is precisely
 *    the spoof the signing prompt exists to prevent.
 *  - Only the publish envelopes may record. `inc.emit` also maps to
 *    `relay:write`, so recording on the capability alone would let any napplet
 *    poison the slot for the next one.
 *
 * This module deliberately imports nothing, so the host and consent modules can
 * both use it without a cycle.
 */

/**
 * Human labels for live napplet windows, written by the consent layer.
 *
 * Kept here rather than in `napplet-consent` so the host can attribute a
 * notification without importing that module — which imports the host back.
 */
const titles = new Map<string, string>();

export function setNappletWindowTitle(windowId: string, title: string): void {
  titles.set(windowId, title);
}

export function clearNappletWindowTitle(windowId: string): void {
  titles.delete(windowId);
}

/** The label for whatever is running in a window, if anything is. */
export function getNappletWindowTitle(windowId: string): string | undefined {
  return titles.get(windowId);
}

export interface NappletWriter {
  windowId: string;
  dTag: string;
  aggregateHash: string;
}

let current: NappletWriter | null = null;

/** Message types that lead to a signature, and therefore to a prompt. */
const SIGNING_TYPES = new Set([
  "relay.publish",
  "relay.publishEncrypted",
  "outbox.publish",
]);

export function isSigningEnvelope(message: unknown): boolean {
  if (typeof message !== "object" || message === null) return false;
  const type = (message as { type?: unknown }).type;
  return typeof type === "string" && SIGNING_TYPES.has(type);
}

/** Record the napplet whose publish just passed the ACL gate. Synchronous. */
export function setCurrentWriter(writer: NappletWriter | null): void {
  current = writer;
}

/** The napplet currently publishing, if this is being read in the same turn. */
export function getCurrentWriter(): NappletWriter | null {
  return current;
}
