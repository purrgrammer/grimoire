// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const fixture = vi.hoisted(() => ({
  requires: ["theme", "unsupported-domain"],
  capabilities: { domains: ["shell", "theme"], services: [] },
  resolve: vi.fn(),
  consent: vi.fn(),
  prelude: vi.fn((html: string) => html),
}));
vi.mock("@/services/kehto", () => ({
  getNappletCatalogId: () => "catalog-id",
}));
vi.mock("@/services/napplet-library", () => ({
  setWindowCatalogId: vi.fn(),
  clearWindowCatalogId: vi.fn(),
  recordNappletRun: vi.fn(),
}));
vi.mock("@/lib/themes", () => ({ useTheme: () => ({ theme: {} }) }));
vi.mock("@/services/napplet-consent", () => ({
  registerNappletIdentity: vi.fn(),
  unregisterNappletIdentity: vi.fn(),
  startNappletConsent: vi.fn(),
  subscribeNappletReload: () => () => {},
  requestLaunchConsent: fixture.consent,
  grantLaunchCapabilities: vi.fn(),
}));
vi.mock("@/services/napplet-acl", () => ({
  getNappletDecisions: () => decisions,
  subscribeNappletDecisions: () => () => {},
  isRemoteMediaGranted: () => false,
}));
vi.mock("@/services/napplet-origins", () => ({ getGrantedOrigins: () => [] }));
vi.mock("@/services/napplet-messages", () => ({
  injectNappletTap: (html: string) => html,
}));
vi.mock("@/components/NappletMessageDrawer", () => ({
  NappletMessageDrawer: () => null,
}));
vi.mock("@/services/napplet-host", () => ({
  fetchManifestEvent: async () => ({}),
  getNappletBridge: vi.fn(),
  getNappletEnvironment: () => ({ capabilities: fixture.capabilities }),
  injectCspMeta: (html: string) => html,
  injectNappletNamespacePrelude: fixture.prelude,
  destroyNappletWindow: vi.fn(),
  resyncNappletTap: vi.fn(),
  originRegistry: {
    register: vi.fn(),
    setEnvironment: vi.fn(),
    getWindowId: () => "test-window",
  },
  publishNappletTheme: vi.fn(),
  toNapTheme: () => ({}),
  resolveNappletFromEvent: fixture.resolve,
  NappletLookupError: class extends Error {},
  NappletResolutionError: class extends Error {},
}));

import { NappletViewer } from "./NappletViewer";

const decisions: [] = [];
const pointer = { kind: 35129, pubkey: "a".repeat(64), identifier: "test" };

beforeEach(() => {
  vi.clearAllMocks();
  fixture.requires = ["theme", "unsupported-domain"];
  fixture.resolve.mockImplementation(async () => ({
    identity: { dTag: "test", aggregateHash: "hash" },
    indexHtml: "<!doctype html><html><body>Napplet</body></html>",
    requires: fixture.requires,
    title: "Test napplet",
    manifestEvent: { pubkey: pointer.pubkey, kind: pointer.kind },
  }));
  fixture.consent.mockResolvedValue({ cancelled: false, granted: [] });
});
afterEach(cleanup);

describe("unsupported napplet requirements", () => {
  it("loads the iframe with a warning and the actual supported environment", async () => {
    const { container } = render(
      <NappletViewer pointer={pointer} windowId="test-window" />,
    );
    await waitFor(() =>
      expect(container.querySelector("iframe")?.srcdoc).toContain("Napplet"),
    );
    const warning = screen.getByRole("status");
    expect(warning.textContent).toContain("may not work correctly");
    expect(warning.textContent).toContain("unsupported-domain");
    expect(screen.queryByText("Could not open this napplet")).toBeNull();
    expect(fixture.prelude).toHaveBeenCalledWith(
      expect.any(String),
      fixture.capabilities,
    );
    expect(fixture.capabilities.domains).not.toContain("unsupported-domain");
  });

  it("loads without a warning when every required domain is supported", async () => {
    fixture.requires = ["theme"];
    const { container } = render(
      <NappletViewer pointer={pointer} windowId="test-window" />,
    );
    await waitFor(() =>
      expect(container.querySelector("iframe")).not.toBeNull(),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still respects a cancelled launch", async () => {
    fixture.consent.mockResolvedValue({ cancelled: true, granted: [] });
    const { container } = render(
      <NappletViewer pointer={pointer} windowId="test-window" />,
    );
    await screen.findByText("You chose not to run this napplet.");
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
