import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  SystemBars: { setStyle: vi.fn() },
  SystemBarsStyle: { Dark: "DARK", Light: "LIGHT" },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/app", () => ({ App: {} }));

import { decideBack, luminance } from "./shell";

describe("decideBack", () => {
  const base = { overlayOpen: false, pathname: "/", historyIndex: 0 };

  it("closes an open overlay before anything else", () => {
    expect(decideBack({ ...base, overlayOpen: true, historyIndex: 3 })).toBe(
      "dismiss-overlay",
    );
  });

  it("goes back through in-app navigation", () => {
    expect(decideBack({ ...base, pathname: "/run", historyIndex: 1 })).toBe(
      "history-back",
    );
  });

  it("sends a deep-linked route home instead of exiting", () => {
    expect(decideBack({ ...base, pathname: "/npub1x" })).toBe("go-home");
  });

  it("minimizes on the dashboard, keeping windows", () => {
    expect(decideBack(base)).toBe("minimize");
  });
});

describe("luminance", () => {
  it("tells the dark theme from the light one", () => {
    expect(luminance("rgb(2, 8, 23)")!).toBeLessThan(0.1);
    expect(luminance("rgba(255, 255, 255, 1)")!).toBeGreaterThan(0.9);
    expect(luminance("oklch(0.2 0 0)")).toBeNull();
  });
});
