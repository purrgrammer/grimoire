/**
 * Loading a settings blob written by an older Grimoire.
 *
 * Every section is merged onto its defaults precisely so a blob stored before
 * that section existed still loads, and a blob stored before `notifications`
 * existed is now on every machine that used Grimoire before this week. The
 * failure mode is not a crash — it is a Settings pane reading blank and a
 * cascade whose bottom rung is `undefined`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "grimoire-settings-v2";

/** A fresh module graph, so the manager loads from what is in storage now. */
async function loadManager() {
  vi.resetModules();
  // eslint-disable-next-line grimoire/no-inline-dynamic-import -- a fresh module graph after vi.resetModules() is the point
  return (await import("@/services/settings")).settingsManager;
}

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  vi.resetModules();
});

describe("a blob stored before notifications existed", () => {
  it("loads with the notification defaults filled in", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __version: 1,
        post: { includeClientTag: false },
        appearance: { showClientTags: false, loadMedia: true },
      }),
    );
    const manager = await loadManager();
    expect(manager.value.notifications).toEqual({
      enabled: false,
      defaultLevel: "mentions",
    });
    // And the sections it DID store are still the user's.
    expect(manager.value.post.includeClientTag).toBe(false);
    expect(manager.value.appearance.showClientTags).toBe(false);
  });

  it("keeps a partially written notifications section", async () => {
    // Half a section is what a blob from a build midway through this feature
    // looks like; the missing half must come from the defaults, not be absent.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ __version: 1, notifications: { enabled: true } }),
    );
    const manager = await loadManager();
    expect(manager.value.notifications.enabled).toBe(true);
    expect(manager.value.notifications.defaultLevel).toBe("mentions");
  });

  it("falls back to defaults for a blob that is not an object at all", async () => {
    localStorage.setItem(STORAGE_KEY, '"nonsense"');
    const manager = await loadManager();
    expect(manager.value.notifications.defaultLevel).toBe("mentions");
  });

  it("survives storage holding something that is not JSON", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, "{not json");
    const manager = await loadManager();
    expect(manager.value.notifications.enabled).toBe(false);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("big emoji", () => {
  it("is on with nothing stored", async () => {
    const manager = await loadManager();
    expect(manager.value.appearance.bigEmoji).toBe(true);
  });

  it("is on for a blob stored before the setting existed", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        __version: 1,
        post: { includeClientTag: true },
        appearance: {
          showClientTags: false,
          loadMedia: false,
          collapseThreads: false,
        },
        notifications: { enabled: true, defaultLevel: "all" },
      }),
    );
    const manager = await loadManager();
    expect(manager.value.appearance.bigEmoji).toBe(true);
    // Without disturbing what the user had already chosen.
    expect(manager.value.appearance.loadMedia).toBe(false);
    expect(manager.value.appearance.collapseThreads).toBe(false);
  });

  it("stays off across a reload once switched off, and comes back on", async () => {
    const manager = await loadManager();
    manager.updateSetting("appearance", "bigEmoji", false);
    expect(manager.value.appearance.bigEmoji).toBe(false);

    const reloaded = await loadManager();
    expect(reloaded.value.appearance.bigEmoji).toBe(false);

    reloaded.updateSetting("appearance", "bigEmoji", true);
    expect((await loadManager()).value.appearance.bigEmoji).toBe(true);
  });
});
