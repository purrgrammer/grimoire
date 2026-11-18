/**
 * #313: a window opened from a single-window route (`/run`, the NIP-19
 * previews) used to land in the persisted workspace while the route kept
 * showing only its own window. `openWindowAtom` is where every opener now goes
 * — the `addWindow` hooks and the services outside React — so these cover the
 * state half of the reveal; `useRevealOnOpen.test.tsx` covers the navigation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createStore } from "jotai";
import type { MosaicNode } from "react-mosaic-component";
import {
  grimoireStateAtom,
  openPersistedWindow,
  openWindowAtom,
  standaloneWindowAtom,
} from "./state";
import * as Logic from "./logic";
import { CURRENT_VERSION } from "@/lib/migrations";
import type { GrimoireState, WindowInstance } from "@/types/app";

const LAYOUT: MosaicNode<string> = {
  direction: "column",
  first: "w-a",
  second: "w-b",
  splitPercentage: 30,
};

const seeded = (): GrimoireState => ({
  __version: CURRENT_VERSION,
  windows: {
    "w-a": { id: "w-a", appId: "man", props: { cmd: "req" } },
    "w-b": { id: "w-b", appId: "nip", props: { number: "01" } },
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
      windowIds: ["w-a", "w-b"],
      layout: LAYOUT,
    },
  },
});

const runWindow: WindowInstance = {
  id: "pop-out:man kind",
  appId: "man",
  props: { cmd: "kind" },
  commandString: "man kind",
};

const nip19 = {
  appId: "nip",
  props: { number: "19" },
  commandString: "nip 19",
};

let store: ReturnType<typeof createStore>;
const owner = {};

beforeEach(() => {
  store = createStore();
  store.set(grimoireStateAtom, seeded());
});

afterEach(() => {
  localStorage.removeItem("grimoire_v6");
});

const open = (payload: Logic.AddWindowPayload, persisted = false) =>
  store.set(openWindowAtom, { payload, persisted });

const workspace = () => store.get(grimoireStateAtom).workspaces["ws-1"];

describe("openWindowAtom without a single-window route", () => {
  it("adds the window exactly as Logic.addWindow does", () => {
    const id = open(nip19);
    const expected = Logic.addWindow(seeded(), { ...nip19, id });
    expect(store.get(grimoireStateAtom)).toEqual(expected);
  });

  it("returns the id of the window it opened", () => {
    const id = open(nip19);
    expect(store.get(grimoireStateAtom).windows[id]).toMatchObject(nip19);
  });
});

describe("openWindowAtom from a preview route (active-workspace placement)", () => {
  beforeEach(() => {
    store.set(standaloneWindowAtom, {
      owner,
      window: runWindow,
      placement: "active-workspace",
      revealed: false,
    });
  });

  it("brings the route's window along beside the new one, and reveals", () => {
    const id = open(nip19);

    expect(workspace().windowIds).toEqual(["w-a", "w-b", runWindow.id, id]);
    expect(store.get(grimoireStateAtom).windows[runWindow.id]).toEqual(
      runWindow,
    );
    expect(store.get(standaloneWindowAtom)).toEqual({
      owner,
      window: runWindow,
      placement: "active-workspace",
      revealed: true,
    });
  });

  it("preserves the persisted windows and layout", () => {
    open(nip19);
    const state = store.get(grimoireStateAtom);
    expect(state.windows["w-a"]).toEqual(seeded().windows["w-a"]);
    expect(state.windows["w-b"]).toEqual(seeded().windows["w-b"]);
    // Row insertion keeps the old tree as an untouched subtree.
    const layout = workspace().layout as Exclude<
      MosaicNode<string>,
      string | null
    >;
    expect((layout.first as Exclude<MosaicNode<string>, string>).first).toEqual(
      LAYOUT,
    );
  });

  it("writes through to localStorage, where the dashboard reads it", () => {
    open(nip19);
    const saved = JSON.parse(localStorage.getItem("grimoire_v6") ?? "null");
    expect(saved.workspaces["ws-1"].windowIds).toContain(runWindow.id);
  });

  it("adds the route's window once when two windows open before navigating", () => {
    const first = open(nip19);
    const second = open({ appId: "kind", props: { number: "1" } });

    expect(workspace().windowIds).toEqual([
      "w-a",
      "w-b",
      runWindow.id,
      first,
      second,
    ]);
  });

  it("does not duplicate the route's window when it is already placed", () => {
    // A previous visit to the same /run URL already brought it in.
    store.set(grimoireStateAtom, (prev) => Logic.adoptWindow(prev, runWindow));
    const id = open(nip19);
    expect(workspace().windowIds).toEqual(["w-a", "w-b", runWindow.id, id]);
  });

  it("reveals the requested window alone when the route had nothing on screen", () => {
    store.set(standaloneWindowAtom, {
      owner,
      window: null,
      placement: "active-workspace",
      revealed: false,
    });
    const id = open(nip19);
    expect(workspace().windowIds).toEqual(["w-a", "w-b", id]);
    expect(store.get(standaloneWindowAtom)?.revealed).toBe(true);
  });

  it("serves the services outside React too, returning the new window's id", () => {
    // Before #313, napplet services found the id by diffing the window map,
    // which here would also have turned up the route's window.
    const id = openPersistedWindow(nip19, store);
    expect(id).not.toBe(runWindow.id);
    expect(store.get(grimoireStateAtom).windows[id]).toMatchObject(nip19);
    expect(workspace().windowIds).toEqual(["w-a", "w-b", runWindow.id, id]);
  });
});

/**
 * Follow-up to #371: `/run` places its window and the requested one in a
 * workspace of their own — a new tab, selected — and the tab the user had
 * focused keeps its windows and layout.
 */
describe("openWindowAtom from /run (own-workspace placement)", () => {
  const register = (window: WindowInstance | null = runWindow) =>
    store.set(standaloneWindowAtom, {
      owner,
      window,
      placement: "own-workspace",
      revealed: false,
    });
  const created = () => {
    const state = store.get(grimoireStateAtom);
    const ws = Object.values(state.workspaces).filter((w) => w.id !== "ws-1");
    expect(ws).toHaveLength(1);
    return ws[0];
  };

  beforeEach(() => register());

  it("opens a new, selected workspace with the route's window and the new one", () => {
    const id = open(nip19);
    const ws = created();
    expect(store.get(grimoireStateAtom).activeWorkspaceId).toBe(ws.id);
    expect(ws.number).toBe(2);
    expect(ws.windowIds).toEqual([runWindow.id, id]);
    expect(store.get(standaloneWindowAtom)?.revealed).toBe(true);
  });

  it("leaves the focused workspace, its windows and its layout as they were", () => {
    open(nip19);
    expect(workspace()).toEqual(seeded().workspaces["ws-1"]);
    expect(store.get(grimoireStateAtom).windows["w-a"]).toEqual(
      seeded().windows["w-a"],
    );
    expect(store.get(grimoireStateAtom).windows["w-b"]).toEqual(
      seeded().windows["w-b"],
    );
  });

  it("writes the new workspace through to localStorage, where the dashboard reads it", () => {
    open(nip19);
    const saved = JSON.parse(localStorage.getItem("grimoire_v6") ?? "null");
    expect(saved.activeWorkspaceId).toBe(created().id);
    expect(saved.workspaces[created().id].windowIds).toEqual(
      created().windowIds,
    );
    expect(saved.workspaces["ws-1"].windowIds).toEqual(["w-a", "w-b"]);
  });

  it("adds a second window opened before navigating to the same new workspace", () => {
    const first = open(nip19);
    const second = open({ appId: "kind", props: { number: "1" } });
    expect(created().windowIds).toEqual([runWindow.id, first, second]);
  });

  it("returns to the workspace that already holds the route's window instead of making another", () => {
    const first = open(nip19);
    const made = created();
    // The user switches back to tab 1, then comes back to the same /run.
    store.set(grimoireStateAtom, (prev) => ({
      ...prev,
      activeWorkspaceId: "ws-1",
    }));
    register();
    const second = open({ appId: "kind", props: { number: "1" } });

    expect(Object.keys(store.get(grimoireStateAtom).workspaces)).toHaveLength(
      2,
    );
    expect(store.get(grimoireStateAtom).activeWorkspaceId).toBe(made.id);
    expect(created().windowIds).toEqual([runWindow.id, first, second]);
    expect(workspace().windowIds).toEqual(["w-a", "w-b"]);
  });

  it("uses the focused workspace while it is empty", () => {
    store.set(grimoireStateAtom, (prev) => ({
      ...prev,
      windows: {},
      workspaces: {
        "ws-1": { id: "ws-1", number: 1, windowIds: [], layout: null },
      },
    }));
    const id = open(nip19);
    expect(Object.keys(store.get(grimoireStateAtom).workspaces)).toEqual([
      "ws-1",
    ]);
    expect(workspace().windowIds).toEqual([runWindow.id, id]);
  });

  it("reveals the requested window alone, still in its own workspace, when the route had nothing on screen", () => {
    register(null);
    const id = open(nip19);
    expect(created().windowIds).toEqual([id]);
    expect(workspace().windowIds).toEqual(["w-a", "w-b"]);
  });

  it("serves the services outside React the same way", () => {
    const id = openPersistedWindow(nip19, store);
    expect(id).not.toBe(runWindow.id);
    expect(created().windowIds).toEqual([runWindow.id, id]);
  });
});
