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
import { StrictMode, useMemo } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  act,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  grimoireStateAtom,
  standaloneWindowAtom,
  useGrimoire,
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

function RunProbe() {
  const window = useMemo(
    () =>
      runCommandWindow({
        appId: "man",
        props: { cmd: "kind" },
        commandString: "man kind",
      }),
    [],
  );
  useRevealOnOpen(window);
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

function DashboardProbe() {
  const { state } = useGrimoire();
  const ws = state.workspaces[state.activeWorkspaceId];
  return <div data-testid="dashboard">{ws.windowIds.join(",")}</div>;
}

let store: ReturnType<typeof createStore>;

function mount(initial = "/run?cmd=man%20kind") {
  const router = createMemoryRouter(
    [
      { path: "/", element: <DashboardProbe /> },
      { path: "/run", element: <RunProbe /> },
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

describe("useRevealOnOpen on /run", () => {
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
