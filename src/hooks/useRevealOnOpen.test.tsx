// @vitest-environment jsdom
/**
 * #313: on `/run?cmd=…` (and the NIP-19 previews) a click that opens another
 * window used to write it into the persisted workspace and leave the tab on
 * the single-window view. The route now registers its window; opening anything
 * brings that window into the workspace beside the new one and switches the tab
 * to `/`, the dashboard, which renders both.
 *
 * The probe stands in for RunCommandPage: a memoized window, `useRevealOnOpen`,
 * and real openers inside it — `NIPBadge` (`useAddWindow`) and a button on
 * `useGrimoire().addWindow` — under StrictMode, so effects run twice.
 */
import { StrictMode, useEffect, useMemo, useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  act,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  grimoireStateAtom,
  standaloneWindowAtom,
  useGrimoire,
  type RevealPlacement,
} from "@/core/state";
import { useRevealOnOpen } from "./useRevealOnOpen";
import { runCommandWindow } from "@/lib/standalone-window";
import { NIPBadge } from "@/components/NIPBadge";
import { CURRENT_VERSION } from "@/lib/migrations";
import type { GrimoireState } from "@/types/app";

const RUN_ID = "pop-out:man kind";

const seeded = (): GrimoireState => ({
  __version: CURRENT_VERSION,
  windows: {
    "w-existing": { id: "w-existing", appId: "man", props: { cmd: "req" } },
  },
  activeWorkspaceId: "ws-1",
  layoutConfig: {
    insertionMode: "row",
    splitPercentage: 50,
    insertionPosition: "second",
  },
  workspaces: {
    "ws-1": {
      id: "ws-1",
      number: 1,
      windowIds: ["w-existing"],
      layout: "w-existing",
    },
  },
});

function RunProbe({ placement }: { placement: RevealPlacement }) {
  const window = useMemo(
    () =>
      runCommandWindow({
        appId: "man",
        props: { cmd: "kind" },
        commandString: "man kind",
      }),
    [],
  );
  useRevealOnOpen(window, placement);
  const { addWindow } = useGrimoire();
  return (
    <div>
      <span>run view</span>
      <NIPBadge nipNumber="19" />
      <button onClick={() => addWindow("kind", { number: "1" }, "kind 1")}>
        open kind
      </button>
    </div>
  );
}

/** Busy-render for longer than one scheduler slice (5ms). */
function outlastSchedulerSlice() {
  const start = performance.now();
  while (performance.now() - start < 10) {
    // spin
  }
}

/**
 * RunCommandPage's shape: nothing to bring along while the command parses,
 * then the window and its content in one commit. The content holds the
 * opener, so it is clickable the instant it is on screen.
 *
 * The render is padded past the scheduler's time slice (5ms) so React
 * yields after the commit and passive effects run in a later task — which is
 * what a real page does when a window takes a frame to render.
 */
function LateRunProbe() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);
  const window = useMemo(
    () =>
      ready
        ? runCommandWindow({
            appId: "man",
            props: { cmd: "kind" },
            commandString: "man kind",
          })
        : null,
    [ready],
  );
  useRevealOnOpen(window, "own-workspace");
  const { addWindow } = useGrimoire();
  if (!ready) return <span>loading</span>;
  outlastSchedulerSlice();
  return (
    <button onClick={() => addWindow("kind", { number: "1" }, "kind 1")}>
      open kind
    </button>
  );
}

function DashboardProbe() {
  const { state } = useGrimoire();
  const ws = state.workspaces[state.activeWorkspaceId];
  return <div data-testid="dashboard">{ws.windowIds.join(",")}</div>;
}

let store: ReturnType<typeof createStore>;

function mount(
  placement: RevealPlacement = "active-workspace",
  initial = "/run?cmd=man%20kind",
) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <DashboardProbe /> },
      { path: "/run", element: <RunProbe placement={placement} /> },
    ],
    { initialEntries: [initial] },
  );
  render(
    <StrictMode>
      <Provider store={store}>
        <RouterProvider router={router} />
      </Provider>
    </StrictMode>,
  );
  return router;
}

const workspace = () => store.get(grimoireStateAtom).workspaces["ws-1"];

beforeEach(() => {
  store = createStore();
  store.set(grimoireStateAtom, seeded());
});

afterEach(() => {
  cleanup();
  localStorage.removeItem("grimoire_v6");
});

describe("useRevealOnOpen with active-workspace placement (the previews)", () => {
  it("shows only the run view at first and touches no workspace", () => {
    const router = mount();
    expect(screen.getByText("run view")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/run");
    const state = store.get(grimoireStateAtom);
    expect(state.windows).toEqual(seeded().windows);
    expect(state.workspaces).toEqual(seeded().workspaces);
    // StrictMode ran the registration twice; one registration is left.
    expect(store.get(standaloneWindowAtom)).toMatchObject({
      window: { id: RUN_ID },
      revealed: false,
    });
  });

  it("clicking a NIP badge reveals the dashboard with both windows", async () => {
    const router = mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /19/ }));
    });

    expect(router.state.location.pathname).toBe("/");
    const ids = workspace().windowIds;
    expect(ids).toHaveLength(3);
    expect(ids.slice(0, 2)).toEqual(["w-existing", RUN_ID]);
    expect(store.get(grimoireStateAtom).windows[ids[2]]).toMatchObject({
      appId: "nip",
      props: { number: "19" },
    });
    expect(screen.getByTestId("dashboard").textContent).toBe(ids.join(","));
    // The route unmounted and took its registration with it.
    expect(store.get(standaloneWindowAtom)).toBeNull();
  });

  it("useGrimoire().addWindow reveals the same way", async () => {
    const router = mount();
    await act(async () => {
      fireEvent.click(screen.getByText("open kind"));
    });
    expect(router.state.location.pathname).toBe("/");
    expect(workspace().windowIds.slice(0, 2)).toEqual(["w-existing", RUN_ID]);
    expect(
      store.get(grimoireStateAtom).windows[workspace().windowIds[2]],
    ).toMatchObject({ appId: "kind", commandString: "kind 1" });
  });

  it("two clicks before the route unmounts add the run window once", async () => {
    const router = mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /19/ }));
      fireEvent.click(screen.getByText("open kind"));
    });
    expect(router.state.location.pathname).toBe("/");
    const ids = workspace().windowIds;
    expect(ids).toHaveLength(4);
    expect(ids.filter((id) => id === RUN_ID)).toHaveLength(1);
  });

  it("returning to the same /run and clicking again does not duplicate it", async () => {
    const router = mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /19/ }));
    });
    await act(async () => {
      await router.navigate("/run?cmd=man%20kind");
    });
    expect(screen.getByText("run view")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("open kind"));
    });
    expect(router.state.location.pathname).toBe("/");
    const ids = workspace().windowIds;
    expect(ids).toHaveLength(4);
    expect(ids.filter((id) => id === RUN_ID)).toHaveLength(1);
  });
});

/**
 * Follow-up to #371: `/run` reveals into a tab of its own. The navigation half
 * is the same; the state half is covered in `state.test.ts`.
 */
describe("useRevealOnOpen with own-workspace placement (/run)", () => {
  const created = () => {
    const state = store.get(grimoireStateAtom);
    const ws = Object.values(state.workspaces).filter((w) => w.id !== "ws-1");
    expect(ws).toHaveLength(1);
    return ws[0];
  };

  it("clicking a NIP badge shows the dashboard on a new tab with both windows", async () => {
    const router = mount("own-workspace");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /19/ }));
    });

    expect(router.state.location.pathname).toBe("/");
    const ws = created();
    expect(store.get(grimoireStateAtom).activeWorkspaceId).toBe(ws.id);
    expect(ws.windowIds[0]).toBe(RUN_ID);
    expect(ws.windowIds).toHaveLength(2);
    expect(screen.getByTestId("dashboard").textContent).toBe(
      ws.windowIds.join(","),
    );
    expect(workspace()).toEqual(seeded().workspaces["ws-1"]);
    expect(store.get(standaloneWindowAtom)).toBeNull();
  });

  it("two clicks before the route unmounts make one tab", async () => {
    mount("own-workspace");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /19/ }));
      fireEvent.click(screen.getByText("open kind"));
    });
    expect(created().windowIds).toHaveLength(3);
    expect(created().windowIds.filter((id) => id === RUN_ID)).toHaveLength(1);
  });

  it("returning to the same /run and clicking again reuses that tab", async () => {
    const router = mount("own-workspace");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /19/ }));
    });
    await act(async () => {
      await router.navigate("/run?cmd=man%20kind");
    });
    await act(async () => {
      fireEvent.click(screen.getByText("open kind"));
    });
    expect(router.state.location.pathname).toBe("/");
    expect(created().windowIds).toHaveLength(3);
    expect(created().windowIds.filter((id) => id === RUN_ID)).toHaveLength(1);
    expect(workspace()).toEqual(seeded().workspaces["ws-1"]);
  });

  it("reveals the run window when the click lands before its passive effects ran", async () => {
    // Seen in CI (QA run 44398997389) and locally, 2 of 25 runs of the
    // RunCommandPage test: an in-window button (then Ask Hex, since removed)
    // clicked as soon as the window was on screen opened the requested window
    // alone in a new tab, and the tab stayed on /run. The window must be registered in the commit that shows it, not
    // in a passive effect that a click can get ahead of.
    const router = createMemoryRouter(
      [
        { path: "/", element: <DashboardProbe /> },
        { path: "/run", element: <LateRunProbe /> },
      ],
      { initialEntries: ["/run?cmd=man%20kind"] },
    );
    render(
      <StrictMode>
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      </StrictMode>,
    );

    // Click from the mutation observer: a microtask right after the commit,
    // ahead of any task React scheduled for its passive effects.
    let clicked = false;
    const observer = new MutationObserver(() => {
      const button = screen.queryByText("open kind");
      if (button && !clicked) {
        clicked = true;
        fireEvent.click(button);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      await waitFor(() => expect(clicked).toBe(true));
    } finally {
      observer.disconnect();
    }

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    const ws = created();
    expect(ws.windowIds).toEqual([RUN_ID, expect.any(String)]);
    expect(store.get(grimoireStateAtom).activeWorkspaceId).toBe(ws.id);
    expect(workspace()).toEqual(seeded().workspaces["ws-1"]);
  });
});

describe("addWindow on the dashboard", () => {
  it("is unchanged: adds one window and stays on /", async () => {
    function Dashboard() {
      const { addWindow } = useGrimoire();
      return (
        <>
          <DashboardProbe />
          <button onClick={() => addWindow("kind", { number: "1" }, "kind 1")}>
            open kind
          </button>
        </>
      );
    }
    const router = createMemoryRouter([{ path: "/", element: <Dashboard /> }], {
      initialEntries: ["/"],
    });
    render(
      <StrictMode>
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>
      </StrictMode>,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("open kind"));
    });
    expect(router.state.location.pathname).toBe("/");
    expect(workspace().windowIds).toHaveLength(2);
    expect(workspace().windowIds[0]).toBe("w-existing");
    expect(workspace().windowIds).not.toContain(RUN_ID);
    expect(store.get(standaloneWindowAtom)).toBeNull();
  });
});
