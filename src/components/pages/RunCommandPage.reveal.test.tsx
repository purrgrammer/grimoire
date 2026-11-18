// @vitest-environment jsdom
/**
 * Opening a window from `/run` (#313, follow-up to #371) — through the real
 * components: RunCommandPage parses the command and renders the `kind` window
 * through WindowRenderer; the click lands on that window's own AskHexButton;
 * the pop-out URL comes from WindowToolbar's real menu item.
 *
 * Reported after #371 merged: with a workspace (a tab in the TabBar) already
 * holding windows, the reveal added the `/run` window and the requested one
 * to the tab that was focused at the time. The expected behaviour, and what a
 * fresh profile with an empty tab already gave, is a NEW tab that holds only
 * the `/run` window and the requested one, selected, with the previous tab,
 * its windows and its layout left exactly as they were.
 *
 * For a pop-out that also means the previous tab keeps the window it was
 * popped out of: the new tab shows the `/run` window (`pop-out:<cmd>`), not
 * the original moved over.
 */
import { StrictMode } from "react";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  render,
  screen,
  act,
  fireEvent,
  cleanup,
  configure,
  waitFor,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { createMemoryRouter, RouterProvider } from "react-router";
import { grimoireStateAtom, useGrimoire } from "@/core/state";
import RunCommandPage from "./RunCommandPage";
import { WindowToolbar } from "@/components/WindowToolbar";
import { CURRENT_VERSION } from "@/lib/migrations";
import type { GrimoireState, WindowInstance, Workspace } from "@/types/app";

const RUN_ID = "pop-out:kind 1";

const ORIGINAL: WindowInstance = {
  id: "w-original",
  appId: "kind",
  props: { number: "1" },
  commandString: "kind 1",
};
const OTHER: WindowInstance = {
  id: "w-other",
  appId: "man",
  props: { cmd: "req" },
  commandString: "man req",
};
const ELSEWHERE: WindowInstance = {
  id: "w-elsewhere",
  appId: "nip",
  props: { number: "01" },
  commandString: "nip 1",
};

const layoutOf = (ids: string[]): Workspace["layout"] =>
  ids.length === 0
    ? null
    : ids.length === 1
      ? ids[0]
      : {
          direction: "column",
          first: ids[0],
          second: ids[1],
          splitPercentage: 40,
        };

/**
 * Tab 1 (active) holds `windows`; tab 2 holds one more window, so there are
 * several tabs and a non-trivial layout to keep intact.
 */
function state(windows: WindowInstance[]): GrimoireState {
  const ids = windows.map((w) => w.id);
  return {
    __version: CURRENT_VERSION,
    windows: Object.fromEntries([...windows, ELSEWHERE].map((w) => [w.id, w])),
    activeWorkspaceId: "ws-1",
    layoutConfig: {
      insertionMode: "row",
      splitPercentage: 50,
      insertionPosition: "second",
    },
    workspaces: {
      "ws-1": { id: "ws-1", number: 1, windowIds: ids, layout: layoutOf(ids) },
      "ws-2": {
        id: "ws-2",
        number: 2,
        windowIds: [ELSEWHERE.id],
        layout: ELSEWHERE.id,
      },
    },
  };
}

function Dashboard() {
  const { state } = useGrimoire();
  return (
    <div data-testid="dashboard">
      {state.workspaces[state.activeWorkspaceId].windowIds.join(",")}
    </div>
  );
}

// The real window renders lazily and parses its command asynchronously; the
// first case pays the cold import, and under a loaded full-suite run that
// outlasts testing-library's 1s default and vitest's 5s budget.
configure({ asyncUtilTimeout: 10000 });
vi.setConfig({ testTimeout: 20000 });

let store: ReturnType<typeof createStore>;

function mountRun(url: string) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <Dashboard /> },
      { path: "/run", element: <RunCommandPage /> },
    ],
    { initialEntries: [url] },
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

/** The URL the real toolbar's "Pop out window" opens for `window`. */
async function popOutUrlFromToolbar(window: WindowInstance): Promise<string> {
  const open = vi.spyOn(globalThis.window, "open").mockReturnValue(null);
  const { unmount } = render(
    <Provider store={store}>
      <WindowToolbar window={window} onClose={() => {}} />
    </Provider>,
  );
  const trigger = screen.getByRole("button", { name: "More actions" });
  // Radix opens the menu on pointerdown (jsdom lacks PointerEvent: keyboard).
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /Pop out/ }));
  const url = open.mock.calls[0]?.[0] as string;
  open.mockRestore();
  unmount();
  return url;
}

const askHexButton = () =>
  screen.findByRole("button", { name: /Ask Hex about kind 1/ });

async function clickAskHex() {
  const button = await askHexButton();
  await act(async () => {
    fireEvent.click(button);
  });
}

const current = () => store.get(grimoireStateAtom);
const workspaces = () => Object.values(current().workspaces);
const tab = (id: string) => current().workspaces[id];
const appsIn = (ws: Workspace) =>
  ws.windowIds.map((id) => current().windows[id]?.appId);
const windowsOfApp = (ws: Workspace, appId: string) =>
  ws.windowIds.filter((id) => current().windows[id]?.appId === appId);

/** The tab the reveal created: the one that is neither seeded tab. */
const newTab = () => {
  const created = workspaces().filter(
    (ws) => ws.id !== "ws-1" && ws.id !== "ws-2",
  );
  expect(created).toHaveLength(1);
  return created[0];
};

beforeAll(() => {
  // Ask Hex renders only when some inference is reachable. Presence is all it
  // checks; nothing here ever calls it.
  (globalThis as { LanguageModel?: unknown }).LanguageModel = {
    availability: async () => "unavailable",
  };
});
afterAll(() => {
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
});
beforeEach(() => {
  store = createStore();
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("grimoire_v6");
});

describe("Ask Hex from /run opened directly, with a focused tab that has windows", () => {
  it("opens a new, selected tab holding only the /run window and the requested one", async () => {
    store.set(grimoireStateAtom, state([OTHER, ORIGINAL]));
    const router = mountRun("/run?cmd=kind%201");

    await clickAskHex();

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    const created = newTab();
    expect(current().activeWorkspaceId).toBe(created.id);
    expect(created.windowIds).toHaveLength(2);
    expect(created.windowIds[0]).toBe(RUN_ID);
    expect(appsIn(created)).toEqual(["kind", "ai"]);
    expect(created.number).toBe(3);
    expect(screen.getByTestId("dashboard").textContent).toBe(
      created.windowIds.join(","),
    );
  });

  it("leaves the previous tab, its windows, its layout and the other tabs untouched", async () => {
    const before = state([OTHER, ORIGINAL]);
    store.set(grimoireStateAtom, before);
    mountRun("/run?cmd=kind%201");

    await clickAskHex();

    await waitFor(() => expect(windowsOfApp(newTab(), "ai")).toHaveLength(1));
    expect(tab("ws-1")).toEqual(before.workspaces["ws-1"]);
    expect(tab("ws-2")).toEqual(before.workspaces["ws-2"]);
    expect(current().windows[ORIGINAL.id]).toEqual(ORIGINAL);
    expect(current().windows[OTHER.id]).toEqual(OTHER);
    expect(workspaces()).toHaveLength(3);
  });

  it("from a fresh, empty tab: that tab, with exactly the /run window and the requested one", async () => {
    store.set(grimoireStateAtom, state([]));
    const router = mountRun("/run?cmd=kind%201");

    await clickAskHex();

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(workspaces()).toHaveLength(2);
    expect(current().activeWorkspaceId).toBe("ws-1");
    expect(tab("ws-1").windowIds).toHaveLength(2);
    expect(appsIn(tab("ws-1"))).toEqual(["kind", "ai"]);
    expect(tab("ws-1").windowIds[0]).toBe(RUN_ID);
  });

  it("a second click before navigating adds to the same new tab, never a tab per click", async () => {
    store.set(grimoireStateAtom, state([OTHER, ORIGINAL]));
    mountRun("/run?cmd=kind%201");

    const button = await askHexButton();
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(windowsOfApp(newTab(), "ai")).toHaveLength(2));
    expect(workspaces()).toHaveLength(3);
    expect(windowsOfApp(newTab(), "kind")).toEqual([RUN_ID]);
    expect(tab("ws-1").windowIds).toEqual([OTHER.id, ORIGINAL.id]);
  });

  it("returning to the same /run and asking again reuses the tab that holds the /run window", async () => {
    store.set(grimoireStateAtom, state([OTHER, ORIGINAL]));
    const router = mountRun("/run?cmd=kind%201");
    await clickAskHex();
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    const created = newTab();

    await act(async () => {
      await router.navigate(-1);
    });
    await clickAskHex();

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await waitFor(() =>
      expect(windowsOfApp(tab(created.id), "ai")).toHaveLength(2),
    );
    expect(workspaces()).toHaveLength(3);
    expect(current().activeWorkspaceId).toBe(created.id);
    expect(windowsOfApp(tab(created.id), "kind")).toEqual([RUN_ID]);
    expect(tab("ws-1").windowIds).toEqual([OTHER.id, ORIGINAL.id]);
  });

  it("persists the new tab where the dashboard reads it", async () => {
    store.set(grimoireStateAtom, state([OTHER, ORIGINAL]));
    mountRun("/run?cmd=kind%201");

    await clickAskHex();

    await waitFor(() => expect(windowsOfApp(newTab(), "ai")).toHaveLength(1));
    const stored = JSON.parse(localStorage.getItem("grimoire_v6")!);
    expect(stored.activeWorkspaceId).toBe(newTab().id);
    expect(stored.workspaces[newTab().id].windowIds).toEqual(
      newTab().windowIds,
    );
    expect(stored.workspaces["ws-1"].windowIds).toEqual([
      OTHER.id,
      ORIGINAL.id,
    ]);
  });
});

describe("Ask Hex from a popped-out /run window", () => {
  it("opens a new tab with the /run window and the requested one; the original stays in its tab", async () => {
    store.set(grimoireStateAtom, state([OTHER, ORIGINAL]));
    const url = await popOutUrlFromToolbar(ORIGINAL);
    const router = mountRun(url);

    await clickAskHex();

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    const created = newTab();
    expect(current().activeWorkspaceId).toBe(created.id);
    expect(appsIn(created)).toEqual(["kind", "ai"]);
    expect(created.windowIds[0]).toBe(RUN_ID);
    expect(tab("ws-1").windowIds).toEqual([OTHER.id, ORIGINAL.id]);
    expect(tab("ws-1").layout).toEqual(layoutOf([OTHER.id, ORIGINAL.id]));
    expect(current().windows[ORIGINAL.id]).toEqual(ORIGINAL);
  });

  it("still works when the original was closed meanwhile", async () => {
    store.set(grimoireStateAtom, state([OTHER, ORIGINAL]));
    const url = await popOutUrlFromToolbar(ORIGINAL);
    // The user closes the original on the dashboard before clicking in /run.
    store.set(grimoireStateAtom, state([OTHER]));
    mountRun(url);

    await clickAskHex();

    await waitFor(() => expect(windowsOfApp(newTab(), "ai")).toHaveLength(1));
    expect(appsIn(newTab())).toEqual(["kind", "ai"]);
    expect(tab("ws-1").windowIds).toEqual([OTHER.id]);
  });

  it("a rapid double click adds a second Ask Hex window to the same new tab", async () => {
    store.set(grimoireStateAtom, state([OTHER, ORIGINAL]));
    mountRun(await popOutUrlFromToolbar(ORIGINAL));

    const button = await askHexButton();
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(windowsOfApp(newTab(), "ai")).toHaveLength(2));
    expect(workspaces()).toHaveLength(3);
    expect(windowsOfApp(newTab(), "kind")).toEqual([RUN_ID]);
    expect(tab("ws-1").windowIds).toEqual([OTHER.id, ORIGINAL.id]);
  });

  it("returning to the pop-out and asking again adds to the tab it already made", async () => {
    store.set(grimoireStateAtom, state([OTHER, ORIGINAL]));
    const router = mountRun(await popOutUrlFromToolbar(ORIGINAL));
    await clickAskHex();
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    const created = newTab();

    await act(async () => {
      await router.navigate(-1);
    });
    await clickAskHex();

    await waitFor(() =>
      expect(windowsOfApp(tab(created.id), "ai")).toHaveLength(2),
    );
    expect(workspaces()).toHaveLength(3);
    expect(windowsOfApp(tab(created.id), "kind")).toEqual([RUN_ID]);
    expect(tab("ws-1").windowIds).toEqual([OTHER.id, ORIGINAL.id]);
  });
});
