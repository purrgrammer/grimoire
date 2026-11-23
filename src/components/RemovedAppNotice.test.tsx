// @vitest-environment jsdom
/**
 * Saved windows and links that name a removed command — `ai`, `agent`,
 * `concord`.
 *
 * Both arrive from places this build does not control: `grimoire_v6` restores
 * every window a user had open, a published spellbook (kind 30777) carries
 * windows in its layout, and a `/run?cmd=` link is a URL anyone can hold. None
 * of them may run removed code, crash the workspace, or be quietly answered by
 * a different app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { createMemoryRouter, RouterProvider } from "react-router";
import { grimoireStateAtom } from "@/core/state";
import { WindowRenderer } from "./WindowRenderer";
import RunCommandPage from "./pages/RunCommandPage";
import { CURRENT_VERSION } from "@/lib/migrations";
import { getRemovedApp } from "@/lib/removed-apps";
import type { GrimoireState, WindowInstance } from "@/types/app";

configure({ asyncUtilTimeout: 10000 });
vi.setConfig({ testTimeout: 20000 });

const COMMUNITY = "3fa2c1".padEnd(64, "0");

/** A window as `grimoire_v6` or a spellbook would hand it back. */
const saved = (appId: string, props: Record<string, unknown>) =>
  ({
    id: `w-${appId}`,
    appId,
    props,
    commandString: appId,
  }) as unknown as WindowInstance;

function emptyState(): GrimoireState {
  return {
    __version: CURRENT_VERSION,
    windows: {},
    activeWorkspaceId: "ws-1",
    layoutConfig: {
      insertionMode: "row",
      splitPercentage: 50,
      insertionPosition: "second",
    },
    workspaces: {
      "ws-1": { id: "ws-1", number: 1, windowIds: [], layout: null },
    },
  };
}

let store: ReturnType<typeof createStore>;

beforeEach(() => {
  store = createStore();
  store.set(grimoireStateAtom, emptyState());
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("grimoire_v6");
});

const windowsIn = () => Object.values(store.get(grimoireStateAtom).windows);

function renderSaved(window: WindowInstance, onClose = vi.fn()) {
  render(
    <Provider store={store}>
      <WindowRenderer window={window} onClose={onClose} />
    </Provider>,
  );
  return onClose;
}

describe("getRemovedApp", () => {
  it("knows the three removed apps and nothing else", () => {
    expect(getRemovedApp("ai")).toEqual({ command: "ai" });
    expect(getRemovedApp("agent")).toEqual({ command: "agent" });
    expect(getRemovedApp("concord")).toEqual({
      command: "concord",
      replacement: "chat",
    });
    for (const supported of ["chat", "call", "kind", "man", "nip"]) {
      expect(getRemovedApp(supported), supported).toBeUndefined();
    }
    // Not fooled by what every object inherits.
    expect(getRemovedApp("toString")).toBeUndefined();
    expect(getRemovedApp("__proto__")).toBeUndefined();
  });
});

describe("a saved window of a removed app", () => {
  it.each([
    ["ai", { prompt: "what is a relay?", conversation: "c1" }],
    ["agent", { agent: "a".repeat(64), session: "s1" }],
    ["concord", { communityId: COMMUNITY, channelId: "c".repeat(64) }],
  ])("%s renders a notice, not the old app", async (appId, props) => {
    renderSaved(saved(appId, props));

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain(`${appId} is no longer available`);
    expect(screen.queryByText(/Window Crashed/)).toBeNull();
    expect(screen.queryByText(/Unknown app/)).toBeNull();
    // Rendering it opened nothing.
    expect(windowsIn()).toEqual([]);
  });

  it("closes from the notice", async () => {
    const onClose = renderSaved(saved("ai", {}));
    fireEvent.click(
      await screen.findByRole("button", { name: "Close window" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers no replacement for ai or agent", async () => {
    renderSaved(saved("agent", {}));
    await screen.findByRole("status");
    expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
  });

  it("points concord at chat, and opens it only when asked", async () => {
    renderSaved(saved("concord", { communityId: COMMUNITY }));
    await screen.findByRole("status");
    // Not redirected on render: the reader decides.
    expect(windowsIn()).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    });

    const opened = windowsIn();
    expect(opened).toHaveLength(1);
    expect(opened[0].appId).toBe("chat");
    expect(opened[0].commandString).toBe("chat");
    expect(opened[0].props).toEqual({
      identifier: { type: "browser" },
      communityId: COMMUNITY,
    });
  });

  it("opens a bare chat browser when the concord window named no community", async () => {
    renderSaved(saved("concord", {}));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Open chat" }));
    });
    expect(windowsIn()[0].props).toEqual({ identifier: { type: "browser" } });
  });
});

describe("a supported window beside it", () => {
  it("still renders its own app", async () => {
    renderSaved(saved("man", { cmd: "chat" }));
    expect(await screen.findByText(/chat \[identifier/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a /run link naming a removed command", () => {
  it.each(["ai what is a relay?", "agent npub1xyz", "concord Bitcoin"])(
    "/run?cmd=%s reports an unknown command and opens nothing",
    async (cmd) => {
      const router = createMemoryRouter(
        [{ path: "/run", element: <RunCommandPage /> }],
        { initialEntries: [`/run?cmd=${encodeURIComponent(cmd)}`] },
      );
      render(
        <Provider store={store}>
          <RouterProvider router={router} />
        </Provider>,
      );

      expect(await screen.findByText("Command Error")).toBeTruthy();
      expect(
        screen.getByText(`Unknown command: ${cmd.split(" ")[0]}`),
      ).toBeTruthy();
      expect(windowsIn()).toEqual([]);
    },
  );
});
