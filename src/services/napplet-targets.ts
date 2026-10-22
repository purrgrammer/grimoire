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
import {
  getNappletBridge,
  originRegistry,
  windowsForCatalogId,
} from "./napplet-host";
import {
  getDeclaredDomains,
  BUILTIN_OPEN_CAPABILITY,
} from "./napplet-capabilities";
import { pointerFromCoordinate } from "./napplet-library";
import { findCatalogRecord } from "./napplet-intent";
import type { IntentTargetController } from "./kehto";
import { intentTopic, waitForNappletReady } from "./napplet-readiness";
import {
  buildBuiltinWindow,
  openBuiltinWindow,
  parseBuiltinHandlerDTag,
} from "./napplet-builtins";
import { requestActionConsent } from "./napplet-consent";
import { getNappletDecision, rememberNappletDecision } from "./napplet-acl";

/**
 * How long to wait for a target to become able to receive.
 *
 * Generous because a cold target has to fetch a manifest, verify every blob and
 * boot before its first `inc.subscribe` — the same budget a manual `app` launch
 * gets.
 */
const READY_TIMEOUT_MS = 20_000;

/**
 * A live session for this catalog entry, if exactly one exists.
 *
 * Matched on the catalog ID recorded when the window's manifest was verified —
 * publisher, kind and d-tag — not on the d-tag alone, so another author's napplet
 * with the same name is never mistaken for the handler.
 */
function liveWindowFor(catalogId: string): string | undefined {
  const bridge = getNappletBridge();
  const live = new Set(
    bridge.runtime.sessionRegistry.getAllEntries().map((e) => e.windowId),
  );
  const matches = windowsForCatalogId(catalogId).filter((id) => live.has(id));
  // Ambiguity fails closed: with two instances there is no "the" target.
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Open a napplet by catalog ID from the installed catalog, returning its window id.
 *
 * Only catalogued napplets can be opened: the pointer comes from the library,
 * never from anything the calling napplet supplied, so a caller cannot name a
 * coordinate and have the shell fetch it.
 *
 * `Logic.addWindow` mints the id internally and returns only the new state, so
 * the id is recovered by diffing. Threading it out of `logic.ts` would be
 * cleaner but that signature is shared with every other command.
 */
async function openHandler(catalogId: string): Promise<string | undefined> {
  const record = await findCatalogRecord(catalogId);
  if (!record?.coordinate) return undefined;

  const pointer = pointerFromCoordinate(record.coordinate);
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
 * The verified identity running in the calling napplet's window.
 *
 * A decision is remembered per *version*, so it is keyed by dTag and aggregate
 * hash. The source window is runtime-attested, so this is exact — there is no
 * guessing between two instances of the same napplet. Without one, the answer is
 * asked fresh rather than guessed at.
 */
function identityForWindow(
  windowId: string | undefined,
): { dTag: string; aggregateHash: string } | undefined {
  if (!windowId) return undefined;
  const frame = originRegistry.getIframeWindow(windowId);
  const identity = frame ? originRegistry.getIdentity(frame) : undefined;
  return identity
    ? { dTag: identity.dTag, aggregateHash: identity.aggregateHash }
    : undefined;
}

/**
 * Hand an intent to grimoire's own built-in, with the user's say-so.
 *
 * Kehto auto-selects a sole candidate with no chooser, and on a fresh install
 * grimoire *is* the sole candidate for every role it fills. Without a decision
 * here, a napplet holding `intent` could open host windows — and reach the
 * network through the requests they make — with no user interaction at all.
 * `fromNapplet` additionally narrows what the payload may name.
 *
 * The say-so can be durable. Answering "don't ask again" records
 * `builtin:open` against that exact version, where it joins the napplet's other
 * permissions in `apps` and is revoked the same way. Only an allow is ever
 * remembered: a stored refusal would make every later click throw silently, and
 * the napplet swallows that — which reads as the feature being broken, not as a
 * decision the user made.
 */
async function openBuiltinForNapplet(
  archetype: string,
  action: string,
  payload: unknown,
  sourceWindowId: string | undefined,
): Promise<string> {
  const window = await buildBuiltinWindow(
    archetype,
    action,
    payload,
    undefined,
    true,
  );

  const identity = identityForWindow(sourceWindowId);
  const remembered = identity
    ? getNappletDecision(
        identity.dTag,
        identity.aggregateHash,
        BUILTIN_OPEN_CAPABILITY,
      )
    : undefined;

  if (remembered?.allowed !== true) {
    const allowed = await requestActionConsent({
      summary: `open ${archetype} in grimoire`,
      detail: `Runs \`${window.commandString}\`. No napplet you have run handles "${archetype}", so grimoire would.`,
      ...(identity
        ? {
            remember: {
              label: "Don't ask again for this napplet",
              onAllow: () =>
                rememberNappletDecision({
                  ...identity,
                  capability: BUILTIN_OPEN_CAPABILITY,
                  allowed: true,
                }),
            },
          }
        : {}),
    });
    if (!allowed) throw new Error("refused");
  }

  return openBuiltinWindow(window);
}

/**
 * Why a delivery failed, for the console.
 *
 * Kehto answers the calling napplet as soon as `accept` returns — a successful
 * result means the host has taken responsibility for delivery, not that it
 * happened — so a failure here no longer reaches the caller as an error. The
 * napplet author's only trace of it is this.
 */
function reportDeliveryFailure(error: unknown): void {
  console.warn(
    "[napplet] intent delivery failed:",
    error instanceof Error ? error.message : error,
  );
}

export function createNappletTargetController(): IntentTargetController {
  return {
    accept(params) {
      const { handler, archetype, action, payload, behavior, sourceWindowId } =
        params;
      const completion = deliver();
      // Observed here as well as by Kehto, which swallows it: this is the one
      // place that can say what went wrong.
      completion.catch(reportDeliveryFailure);
      return { completion };

      async function deliver(): Promise<void> {
        // Grimoire itself resolved as the handler: confirm, then open the native
        // window. No readiness dance — there is no frame to wait for — but this
        // path leaves the napplet sandbox, so it needs a decision the sandbox
        // cannot make for the user.
        const builtin = parseBuiltinHandlerDTag(handler);
        if (builtin) {
          await openBuiltinForNapplet(builtin, action, payload, sourceWindowId);
          return;
        }

        const record = await findCatalogRecord(handler);
        const name = record?.dTag ?? handler;

        // Reuse unless the caller explicitly asked for a new window. Reuse is a
        // hint, not a promise — a napplet cannot demand its own instance count.
        // Kehto's behavior carries `reuse`; `reuse: false` is the new-window ask.
        const existing =
          behavior?.reuse === false ? undefined : liveWindowFor(handler);
        const windowId = existing ?? (await openHandler(handler));
        if (!windowId) {
          throw new Error(`no installed napplet "${name}"`);
        }

        const ready = await waitForNappletReady(
          windowId,
          archetype,
          action,
          READY_TIMEOUT_MS,
        );
        if (!ready) throw new Error(readinessFailure(name, windowId));

        const frame = originRegistry.getIframeWindow(windowId);
        if (!frame) {
          // The window was closed between becoming ready and now.
          throw new Error(`"${name}" went away before delivery`);
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
      }
    },
  };
}
