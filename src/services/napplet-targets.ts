/** NAP-INTENT target lifecycle and runtime-attested, queued delivery. */

import type { IntentDispatchParams, IntentTargetController } from "./kehto";

import { getDefaultStore } from "jotai";
import { nip19 } from "nostr-tools";

import { grimoireStateAtom } from "@/core/state";
import * as Logic from "@/core/logic";
import { getNappletBridge, originRegistry } from "./napplet-host";
import {
  getDeclaredDomains,
  BUILTIN_OPEN_CAPABILITY,
} from "./napplet-capabilities";
import {
  getWindowCatalogId,
  installedNappletCatalogId,
  listNapplets,
  pointerFromCoordinate,
} from "./napplet-library";

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
 * boot before its `shell.ready` handshake — the same budget a manual `app` launch
 * gets.
 */
const READY_TIMEOUT_MS = 20_000;

/** A live session for this dTag, if exactly one exists. */
function liveWindowFor(dTag: string): string | undefined {
  const bridge = getNappletBridge();
  const matches = bridge.runtime.sessionRegistry
    .getAllEntries()
    .filter((entry) => getWindowCatalogId(entry.windowId) === dTag);
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
  const row = rows.find((entry) => installedNappletCatalogId(entry) === dTag);
  if (!row) return undefined;

  const pointer = pointerFromCoordinate(row.coordinate);
  if (!pointer) return undefined;

  const store = getDefaultStore();
  const before = new Set(Object.keys(store.get(grimoireStateAtom).windows));
  store.set(grimoireStateAtom, (prev) =>
    Logic.addWindow(prev, {
      appId: "app",
      props: { pointer },
      commandString: `app ${"id" in pointer ? nip19.neventEncode({ ...pointer, kind: row.kind, author: row.pubkey }) : nip19.naddrEncode(pointer)}`,
    }),
  );
  return Object.keys(store.get(grimoireStateAtom).windows).find(
    (id) => !before.has(id),
  );
}

/**
 * Why a target never became ready, in the terms the napplet author needs.
 *
 * A missing `intent` declaration is the failure worth naming: the domain is
 * narrowed away from anything that did not declare it, so the target's
 * `napplet.intent` is undefined and it cannot receive a delivery. That looks
 * identical to a slow boot from here, and the fix is a one-line manifest change.
 */
function readinessFailure(dTag: string, windowId: string): string {
  const frame = originRegistry.getIframeWindow(windowId);
  const identity = frame ? originRegistry.getIdentity(frame) : undefined;
  const declared = identity
    ? getDeclaredDomains(identity.dTag, identity.aggregateHash)
    : undefined;

  if (declared && declared.length > 0 && !declared.includes("intent")) {
    return `"${dTag}" does not declare the "intent" NAP domain`;
  }
  return `"${dTag}" did not become ready to receive`;
}

/**
 * The verified identity behind a dTag, when there is exactly one answer.
 *
 * A decision is remembered per *version*, so a dTag alone cannot key one. With
 * no live session, or with two running different aggregates, there is no "the"
 * version and the answer is asked fresh rather than guessed at.
 */
function identityForDTag(
  dTag: string,
): { dTag: string; aggregateHash: string } | undefined {
  const bridge = getNappletBridge();
  const hashes = new Set<string>();
  for (const entry of bridge.runtime.sessionRegistry.getAllEntries()) {
    if (getWindowCatalogId(entry.windowId) !== dTag) continue;
    const frame = originRegistry.getIframeWindow(entry.windowId);
    const identity = frame ? originRegistry.getIdentity(frame) : undefined;
    if (identity) hashes.add(identity.aggregateHash);
  }
  const [only] = [...hashes];
  return hashes.size === 1 ? { dTag, aggregateHash: only } : undefined;
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
  sender: string,
  sourceWindowId?: string,
): Promise<string> {
  const window = await buildBuiltinWindow(
    archetype,
    action,
    payload,
    undefined,
    true,
  );

  const source = sourceWindowId
    ? originRegistry.getIframeWindow(sourceWindowId)
    : null;
  const identity = source
    ? originRegistry.getIdentity(source)
    : identityForDTag(sender);
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

export function createNappletTargetController(): IntentTargetController {
  return {
    accept(params) {
      // Retain the work before acknowledging acceptance to the caller.
      return { completion: dispatch(params).then(() => undefined) };
    },
  };
}

async function dispatch(
  params: IntentDispatchParams,
): Promise<{ windowId: string }> {
  const {
    handler,
    sender,
    archetype,
    action,
    payload,
    behavior,
    convention,
    sourceWindowId,
  } = params;

  // Grimoire itself resolved as the handler: confirm, then open the native
  // window. No readiness dance — there is no frame to wait for — but this
  // path leaves the napplet sandbox, so it needs a decision the sandbox
  // cannot make for the user.
  const builtin = parseBuiltinHandlerDTag(handler);
  if (builtin) {
    return {
      windowId: await openBuiltinForNapplet(
        builtin,
        action,
        payload,
        sender,
        sourceWindowId,
      ),
    };
  }

  // Reuse unless the caller explicitly asked for a new window. Reuse is a
  // hint, not a promise — a napplet cannot demand its own instance count.
  const existing =
    behavior?.reuse === false ? undefined : liveWindowFor(handler);
  const windowId = existing ?? (await openHandler(handler));
  if (!windowId) {
    throw new Error(`no installed napplet with dTag "${handler}"`);
  }

  // shell.ready installs the protected delivery binding, which queues until
  // intent.onDelivery (or a compatible legacy listener) is registered.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (
    !getNappletBridge()
      .runtime.sessionRegistry.getAllEntries()
      .some(
        (entry) =>
          entry.windowId === windowId &&
          getWindowCatalogId(windowId) === handler,
      )
  ) {
    if (Date.now() >= deadline)
      throw new Error(readinessFailure(handler, windowId));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const frame = originRegistry.getIframeWindow(windowId);
  if (!frame) {
    // The window was closed between becoming ready and now.
    throw new Error(`"${handler}" went away before delivery`);
  }

  const identity = originRegistry.getIdentity(frame);
  const declared = identity
    ? getDeclaredDomains(identity.dTag, identity.aggregateHash)
    : undefined;
  if (declared?.length && !declared.includes("intent")) {
    throw new Error(readinessFailure(handler, windowId));
  }

  frame.postMessage(
    {
      type: "intent.deliver",
      delivery: {
        sender,
        archetype,
        action,
        convention,
        ...(payload === undefined ? {} : { payload }),
      },
    },
    "*",
  );

  return { windowId };
}
