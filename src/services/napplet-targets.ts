/**
 * The window half of NAP-INTENT: open or reuse the resolved handler, wait
 * until it can actually receive, and report which window took it.
 *
 * The spec is explicit that delivery must not race the target:
 * "The shell MUST deliver `payload` to the resolved handler only after that
 * handler is ready to receive it." Readiness here means a live session in the
 * runtime's registry, which only exists after the napplet's `shell.ready`
 * handshake — so a window that has been created but whose iframe has not
 * finished verifying and booting is deliberately not ready yet.
 *
 * Reuse is by *live session*, not by open window: a window whose napplet is
 * still resolving has no session, so it cannot be handed a payload and a
 * second one is opened rather than dropping the intent on the floor.
 */

import { getDefaultStore } from "jotai";
import { nip19 } from "nostr-tools";

import { grimoireStateAtom } from "@/core/state";
import * as Logic from "@/core/logic";
import { getNappletBridge } from "./napplet-host";
import { listNapplets, pointerFromCoordinate } from "./napplet-library";

/** How long to wait for a freshly opened napplet to complete its handshake. */
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 150;

/** A live session for this dTag, if exactly one exists. */
function liveWindowFor(dTag: string): string | undefined {
  const bridge = getNappletBridge();
  const matches = bridge.runtime.sessionRegistry
    .getAllEntries()
    .filter((entry) => entry.dTag === dTag);
  // Ambiguity fails closed: with two instances there is no "the" target.
  return matches.length === 1 ? matches[0].windowId : undefined;
}

async function waitForSession(
  dTag: string,
  deadline: number,
): Promise<string | undefined> {
  for (;;) {
    const windowId = liveWindowFor(dTag);
    if (windowId) return windowId;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
}

/**
 * Open a napplet by dTag from the installed catalog.
 *
 * Only catalogued napplets can be opened: the pointer comes from the library,
 * never from anything the calling napplet supplied, so a caller cannot name a
 * coordinate and have the shell fetch it.
 */
async function openHandler(dTag: string): Promise<boolean> {
  const rows = await listNapplets();
  const row = rows.find((entry) => entry.identifier === dTag);
  if (!row) return false;

  const pointer = pointerFromCoordinate(row.coordinate);
  if (!pointer || "id" in pointer) return false;

  const store = getDefaultStore();
  store.set(grimoireStateAtom, (prev) =>
    Logic.addWindow(prev, {
      appId: "app",
      props: { pointer },
      commandString: `app ${nip19.naddrEncode(pointer)}`,
    }),
  );
  return true;
}

export function createNappletTargetController() {
  return {
    async dispatch(params: {
      readonly handler: string;
      readonly behavior?: Readonly<{ newWindow?: boolean; reuse?: boolean }>;
    }): Promise<{ windowId: string }> {
      const { handler, behavior } = params;

      // Reuse unless the caller explicitly asked for a new window. Reuse is a
      // hint, not a promise — a napplet cannot demand its own instance count.
      if (!behavior?.newWindow) {
        const existing = liveWindowFor(handler);
        if (existing) return { windowId: existing };
      }

      if (!(await openHandler(handler))) {
        throw new Error(`no installed napplet with dTag "${handler}"`);
      }

      const windowId = await waitForSession(
        handler,
        Date.now() + READY_TIMEOUT_MS,
      );
      if (!windowId) {
        // Verification can legitimately fail or a blob can be unavailable.
        // Reporting rather than delivering keeps the payload from vanishing
        // into a window that never booted.
        throw new Error(`"${handler}" did not become ready`);
      }
      return { windowId };
    },
  };
}
