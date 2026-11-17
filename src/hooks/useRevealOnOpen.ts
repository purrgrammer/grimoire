import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useStandaloneWindow } from "@/core/state";
import type { WindowInstance } from "@/types/app";

/**
 * For a route that renders one window outside the workspace (`/run`, the
 * NIP-19 previews): when anything opens another window, show the dashboard.
 *
 * `useStandaloneWindow` does the state half — the next window opened brings
 * `window` along into the persisted active workspace — and this switches the
 * tab to `/`, where both are on screen. Without it the new window landed in a
 * workspace this route never shows.
 *
 * `window` must be referentially stable (memoize it); pass null while there is
 * nothing on screen to bring along — loading, or an error — and a window
 * opened meanwhile is revealed on its own.
 *
 * `sourceId` is the workspace window this view was popped out of, if any
 * (`POP_OUT_SOURCE_PARAM`): while it is still in the active workspace, the
 * reveal shows it instead of placing `window` as a copy beside it.
 */
export function useRevealOnOpen(
  window: WindowInstance | null,
  sourceId?: string | null,
): void {
  const revealed = useStandaloneWindow(window, sourceId);
  const navigate = useNavigate();

  useEffect(() => {
    if (revealed) navigate("/");
  }, [revealed, navigate]);
}
