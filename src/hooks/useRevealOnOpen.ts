import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useStandaloneWindow, type RevealPlacement } from "@/core/state";
import type { WindowInstance } from "@/types/app";

/**
 * For a route that renders one window outside the workspace (`/run`, the
 * NIP-19 previews): when anything opens another window, show the dashboard.
 *
 * `useStandaloneWindow` does the state half — the next window opened brings
 * `window` along into the persisted state — and this switches the tab to
 * `/`, where both are on screen. Without it the new window landed in a
 * workspace this route never shows.
 *
 * `placement` says which workspace they land in: `"own-workspace"` gives them
 * a tab of their own and leaves the focused tab as it was (`/run`);
 * `"active-workspace"` puts them beside the focused tab's windows (the
 * previews).
 *
 * `window` must be referentially stable (memoize it); pass null while there is
 * nothing on screen to bring along — loading, or an error — and a window
 * opened meanwhile is revealed on its own.
 */
export function useRevealOnOpen(
  window: WindowInstance | null,
  placement: RevealPlacement,
): void {
  const revealed = useStandaloneWindow(window, placement);
  const navigate = useNavigate();

  useEffect(() => {
    if (revealed) navigate("/");
  }, [revealed, navigate]);
}
