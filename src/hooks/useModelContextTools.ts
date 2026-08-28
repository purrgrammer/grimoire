import { useEffect } from "react";

import { createWindowExecutor } from "@/lib/ai-window-tool";
import { registerModelContextTools } from "@/services/webmcp";
import { useAccount } from "@/hooks/useAccount";
import { useAddWindow } from "@/core/state";

/**
 * Publishes grimoire's tools to the browser's agent, for the whole app.
 *
 * Mounted at the shell rather than in the `ai` window: WebMCP tools belong to
 * the document, and an agent asking what this page can do should get the same
 * answer whether or not the user happens to have Hex open. It is also the only
 * place `grimoire.window` can come from — the executor adds a window, so it
 * needs the state hooks, and the shell outlives every window it opens.
 *
 * Nothing here runs in a browser without `document.modelContext`; the service
 * feature-detects and reports back unsupported.
 */
export function useModelContextTools(): void {
  const addWindow = useAddWindow();
  const { pubkey } = useAccount();

  useEffect(() => {
    const controller = new AbortController();

    void registerModelContextTools(
      {
        "grimoire.window": createWindowExecutor(addWindow, pubkey),
      },
      controller.signal,
    ).then((result) => {
      // A refused tool is worth saying out loud: the usual cause is the
      // document not being origin-keyed, which no amount of retrying fixes and
      // which is otherwise invisible — the page works, the agent just sees
      // nothing.
      for (const { id, error } of result.failed) {
        console.warn(`[webmcp] ${id} was not registered: ${error}`);
      }
    });

    // Aborting unregisters every tool this run registered, so a re-register
    // with a new `addWindow` cannot leave the old closure reachable.
    return () => controller.abort();
  }, [addWindow, pubkey]);
}
