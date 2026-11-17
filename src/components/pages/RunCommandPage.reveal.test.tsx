// @vitest-environment jsdom
/**
 * #313 regression, through the real components: the dashboard's "Pop out
 * window" (WindowToolbar) opens `/run` in a new tab for a window that is
 * already in the workspace. Clicking "Ask Hex" there must reveal the dashboard
 * with the ORIGINAL window and the requested one — two windows — not a third,
 * `pop-out:<cmd>` copy of the original beside it.
 *
 * Reproduced in a production build before this test existed: dashboard window
 * `req …` popped out, Ask Hex clicked from its event menu, dashboard showed the
 * original, `pop-out:req …` and the `ai` window. One write, one navigation,
 * one `ai` window: the copy came from the `/run` window's identity (derived
 * from the command) never matching the window it was popped out of.
 *
 * Everything on screen is real: RunCommandPage parses the command and renders
 * the `kind` window through WindowRenderer; the click lands on that window's
 * own AskHexButton; the pop-out URL comes from the toolbar's real menu item.
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
import type { GrimoireState, WindowInstance } from "@/types/app";

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

function state(windows: WindowInstance[]): GrimoireState {
  const ids = windows.map((w) => w.id);
  return {
    __version: CURRENT_VERSION,
    windows: Object.fromEntries(windows.map((w) => [w.id, w])),
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
        windowIds: ids,
        layout:
          ids.length === 0
            ? null
            : ids.length === 1
              ? ids[0]
              : {
                  direction: "column",
                  first: ids[0],
                  second: ids[1],
                  splitPercentage: 40,
                },
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

// The real window renders lazily and parses its command asynchronously; under
// a loaded full-suite run that outlasts testing-library's 1s default.
configure({ asyncUtilTimeout: 5000 });

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

async function clickAskHex() {
  const button = await screen.findByRole(
    "button",
    { name: /Ask Hex about kind 1/ },
    { timeout: 4000 },
  );
  await act(async () => {
    fireEvent.click(button);
  });
}

const windowIds = () =>
  store.get(grimoireStateAtom).workspaces["ws-1"].windowIds;
const windowsOfApp = (appId: string) =>
  windowIds().filter(
    (id) => store.get(grimoireStateAtom).windows[id]?.appId === appId,
  );

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

describe("Ask Hex from a popped-out /run window (#313)", () => {
  it("reveals the original and the requested window — two, no copy", async () => {
    store.set(grimoireStateAtom, state([ORIGINAL]));
    const url = await popOutUrlFromToolbar(ORIGINAL);
    const router = mountRun(url);

    await clickAskHex();

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(windowIds()).toHaveLength(2);
    expect(windowIds()[0]).toBe(ORIGINAL.id);
    expect(windowsOfApp("kind")).toEqual([ORIGINAL.id]);
    expect(windowsOfApp("ai")).toHaveLength(1);
  });

  it("keeps every other window and the existing layout", async () => {
    store.set(grimoireStateAtom, state([OTHER, ORIGINAL]));
    const before = store.get(grimoireStateAtom).workspaces["ws-1"].layout;
    mountRun(await popOutUrlFromToolbar(ORIGINAL));

    await clickAskHex();

    await waitFor(() => expect(windowsOfApp("ai")).toHaveLength(1));
    expect(windowIds()).toHaveLength(3);
    expect(windowsOfApp("kind")).toEqual([ORIGINAL.id]);
    expect(windowsOfApp("man")).toEqual([OTHER.id]);
    // The new window is inserted beside; the old tree survives as a subtree.
    expect(
      JSON.stringify(store.get(grimoireStateAtom).workspaces["ws-1"].layout),
    ).toContain(JSON.stringify(before).slice(1, -1));
  });

  it("brings the /run window along when the original was closed meanwhile", async () => {
    store.set(grimoireStateAtom, state([OTHER, ORIGINAL]));
    const url = await popOutUrlFromToolbar(ORIGINAL);
    // The user closes the original on the dashboard before clicking in /run.
    store.set(grimoireStateAtom, state([OTHER]));
    mountRun(url);

    await clickAskHex();

    await waitFor(() => expect(windowsOfApp("ai")).toHaveLength(1));
    expect(windowsOfApp("kind")).toEqual(["pop-out:kind 1"]);
    expect(windowIds()).toHaveLength(3);
  });

  it("from a fresh, empty workspace: exactly the /run window and the requested one", async () => {
    store.set(grimoireStateAtom, state([]));
    const router = mountRun("/run?cmd=kind%201");

    await clickAskHex();

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(windowIds()).toHaveLength(2);
    expect(windowsOfApp("kind")).toEqual(["pop-out:kind 1"]);
    expect(windowsOfApp("ai")).toHaveLength(1);
  });

  it("a second click before navigating adds a second Ask Hex window, never a copy", async () => {
    store.set(grimoireStateAtom, state([ORIGINAL]));
    mountRun(await popOutUrlFromToolbar(ORIGINAL));

    const button = await screen.findByRole(
      "button",
      { name: /Ask Hex about kind 1/ },
      { timeout: 4000 },
    );
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(windowsOfApp("ai")).toHaveLength(2));
    expect(windowsOfApp("kind")).toEqual([ORIGINAL.id]);
  });

  it("returning to the same /run and asking again adds no copy", async () => {
    store.set(grimoireStateAtom, state([ORIGINAL]));
    const url = await popOutUrlFromToolbar(ORIGINAL);
    const router = mountRun(url);
    await clickAskHex();
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));

    await act(async () => {
      await router.navigate(-1);
    });
    await clickAskHex();

    await waitFor(() => expect(windowsOfApp("ai")).toHaveLength(2));
    expect(windowsOfApp("kind")).toEqual([ORIGINAL.id]);
  });
});
