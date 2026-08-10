/**
 * The window half of NAP-INTENT: open or reuse the resolved handler, wait until
 * it can actually receive, then hand it the payload.
 *
 * Kehto's `IntentTargetController` contract is "create or focus the selected
 * target, wait until it can receive the convention, then enqueue delivery
 * through the host's ordinary carrier" — three jobs, and the third is the one
 * that is easy to forget, because the resolver's `{ windowId }` result looks
 * like a complete answer. It is not: nothing in the runtime delivers the
 * payload for us. A controller that only opens a window resolves every intent
 * successfully and delivers nothing.
 *
 * The carrier is NAP-INC. It is the only channel that reaches napplet code
 * rather than the runtime, it is the channel the napplet is already listening on
 * (see `napplet-readiness`), and it is what noStrudel's shell uses, so a napplet
 * written for either shell works on both. The envelope is posted straight at the
 * frame with `sender: "shell"`, which is a dTag no napplet can hold — a napplet
 * therefore cannot forge an intent delivery by emitting on the same topic.
 *
 * The selected `convention` is deliberately not on the wire. Archetype and
 * convention are orthogonal: the archetype routes and the convention shapes the
 * payload, and the napplet knows which conventions it declared. The napplet SDK
 * rebuilds `inc.event` from `type`/`topic`/`sender`/`payload` and drops anything
 * else, so an extra field would be silently discarded anyway.
 *
 * Reuse is by *live session*, not by open window: a window whose napplet is
 * still resolving has no session, so it cannot be handed a payload and a second
 * one is opened rather than dropping the intent on the floor.
 */

import { getDefaultStore } from "jotai";
import { nip19 } from "nostr-tools";

import { grimoireStateAtom } from "@/core/state";
import * as Logic from "@/core/logic";
import { getNappletBridge, originRegistry } from "./napplet-host";
import { getDeclaredDomains } from "./napplet-capabilities";
import { listNapplets, pointerFromCoordinate } from "./napplet-library";
import { intentTopic, waitForNappletReady } from "./napplet-readiness";
import {
  buildBuiltinWindow,
  openBuiltinWindow,
  parseBuiltinHandlerDTag,
} from "./napplet-builtins";
import { requestActionConsent } from "./napplet-consent";

/**
 * How long to wait for a target to become able to receive.
 *
 * Generous because a cold target has to fetch a manifest, verify every blob and
 * boot before its first `inc.subscribe` — the same budget a manual `app` launch
 * gets.
 */
const READY_TIMEOUT_MS = 20_000;

/** A live session for this dTag, if exactly one exists. */
function liveWindowFor(dTag: string): string | undefined {
  const bridge = getNappletBridge();
  const matches = bridge.runtime.sessionRegistry
    .getAllEntries()
    .filter((entry) => entry.dTag === dTag);
  // Ambiguity fails closed: with two instances there is no "the" target.
  return matches.length === 1 ? matches[0].windowId : undefined;
}

/**
 * Open a napplet by dTag from the installed catalog, returning its window id.
 *
 * Only catalogued napplets can be opened: the pointer comes from the library,
 * never from anything the calling napplet supplied, so a caller cannot name a
 * coordinate and have the shell fetch it.
 *
 * `Logic.addWindow` mints the id internally and returns only the new state, so
 * the id is recovered by diffing. Threading it out of `logic.ts` would be
 * cleaner but that signature is shared with every other command.
 */
async function openHandler(dTag: string): Promise<string | undefined> {
  const rows = await listNapplets();
  const row = rows.find((entry) => entry.identifier === dTag);
  if (!row) return undefined;

  const pointer = pointerFromCoordinate(row.coordinate);
  if (!pointer || "id" in pointer) return undefined;

  const store = getDefaultStore();
  const before = new Set(Object.keys(store.get(grimoireStateAtom).windows));
  store.set(grimoireStateAtom, (prev) =>
    Logic.addWindow(prev, {
      appId: "app",
      props: { pointer },
      commandString: `app ${nip19.naddrEncode(pointer)}`,
    }),
  );
  return Object.keys(store.get(grimoireStateAtom).windows).find(
    (id) => !before.has(id),
  );
}

/**
 * Why a target never became ready, in the terms the napplet author needs.
 *
 * A missing `inc` declaration is the failure worth naming: the domain is
 * narrowed away from anything that did not declare it, so the target's
 * `napplet.inc` is undefined and it cannot possibly subscribe. That looks
 * identical to a slow boot from here, and the fix is a one-line manifest change.
 */
function readinessFailure(dTag: string, windowId: string): string {
  const frame = originRegistry.getIframeWindow(windowId);
  const identity = frame ? originRegistry.getIdentity(frame) : undefined;
  const declared = identity
    ? getDeclaredDomains(identity.dTag, identity.aggregateHash)
    : undefined;

  if (declared && declared.length > 0 && !declared.includes("inc")) {
    return `"${dTag}" does not declare the "inc" NAP domain, so it cannot receive an intent`;
  }
  return `"${dTag}" did not become ready to receive`;
}

/**
 * Hand an intent to grimoire's own built-in, with the user's say-so.
 *
 * Kehto auto-selects a sole candidate with no chooser, and on a fresh install
 * grimoire *is* the sole candidate for every role it fills. Without a decision
 * here, a napplet holding `intent` could open host windows — and reach the
 * network through the requests they make — with no user interaction at all.
 * `fromNapplet` additionally narrows what the payload may name.
 */
async function openBuiltinForNapplet(
  archetype: string,
  action: string,
  payload: unknown,
): Promise<string> {
  const window = await buildBuiltinWindow(
    archetype,
    action,
    payload,
    undefined,
    true,
  );

  const allowed = await requestActionConsent({
    summary: `open ${archetype} in grimoire`,
    detail: `Runs \`${window.commandString}\`. No napplet you have run handles "${archetype}", so grimoire would.`,
  });
  if (!allowed) throw new Error("refused");

  return openBuiltinWindow(window);
}

export function createNappletTargetController() {
  return {
    async dispatch(params: {
      readonly handler: string;
      readonly archetype: string;
      readonly action: string;
      readonly payload?: unknown;
      readonly behavior?: Readonly<{ newWindow?: boolean; reuse?: boolean }>;
    }): Promise<{ windowId: string }> {
      const { handler, archetype, action, payload, behavior } = params;

      // Grimoire itself resolved as the handler: confirm, then open the native
      // window. No readiness dance — there is no frame to wait for — but this
      // path leaves the napplet sandbox, so it needs a decision the sandbox
      // cannot make for the user.
      const builtin = parseBuiltinHandlerDTag(handler);
      if (builtin) {
        return {
          windowId: await openBuiltinForNapplet(builtin, action, payload),
        };
      }

      // Reuse unless the caller explicitly asked for a new window. Reuse is a
      // hint, not a promise — a napplet cannot demand its own instance count.
      const existing = behavior?.newWindow ? undefined : liveWindowFor(handler);
      const windowId = existing ?? (await openHandler(handler));
      if (!windowId) {
        throw new Error(`no installed napplet with dTag "${handler}"`);
      }

      const ready = await waitForNappletReady(
        windowId,
        archetype,
        action,
        READY_TIMEOUT_MS,
      );
      if (!ready) throw new Error(readinessFailure(handler, windowId));

      const frame = originRegistry.getIframeWindow(windowId);
      if (!frame) {
        // The window was closed between becoming ready and now.
        throw new Error(`"${handler}" went away before delivery`);
      }

      frame.postMessage(
        {
          type: "inc.event",
          topic: intentTopic(archetype, action),
          sender: "shell",
          ...(payload === undefined ? {} : { payload }),
        },
        "*",
      );

      return { windowId };
    },
  };
}
