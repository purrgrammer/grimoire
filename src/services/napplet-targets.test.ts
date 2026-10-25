import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  postMessage: vi.fn(),
  catalog: new Map<string, string>(),
  entries: [] as { windowId: string; dTag: string; aggregateHash: string }[],
}));
vi.mock("./napplet-host", () => ({
  getNappletBridge: () => ({
    runtime: { sessionRegistry: { getAllEntries: () => fixture.entries } },
  }),
  originRegistry: {
    getIframeWindow: () => ({ postMessage: fixture.postMessage }),
    getIdentity: () => ({ dTag: "same-name", aggregateHash: "hash" }),
  },
}));
vi.mock("./napplet-library", () => ({
  getWindowCatalogId: (id: string) => fixture.catalog.get(id),
  listNapplets: async () => [],
  pointerFromCoordinate: () => null,
  installedNappletCatalogId: (row: { coordinate: string }) =>
    `nip5d:${row.coordinate}`,
}));
vi.mock("./napplet-consent", () => ({ requestActionConsent: vi.fn() }));
vi.mock("./napplet-builtins", () => ({
  parseBuiltinHandlerDTag: () => null,
  buildBuiltinWindow: vi.fn(),
  openBuiltinWindow: vi.fn(),
}));

import { setDeclaredDomains } from "./napplet-capabilities";
import { createNappletTargetController } from "./napplet-targets";

beforeEach(() => {
  setDeclaredDomains("same-name", "hash", []);
  fixture.postMessage.mockClear();
  fixture.catalog.clear();
  fixture.entries = [];
});

describe("current intent target delivery", () => {
  it("uses the verified catalog ID rather than another publisher's matching d-tag", async () => {
    fixture.entries = [
      { windowId: "wrong", dTag: "same-name", aggregateHash: "hash" },
      { windowId: "right", dTag: "same-name", aggregateHash: "hash" },
    ];
    fixture.catalog.set("wrong", "nip5d:35129:other:same-name");
    fixture.catalog.set("right", "nip5d:35129:publisher:same-name");
    const accepted = createNappletTargetController().accept({
      handler: "nip5d:35129:publisher:same-name",
      sender: "source",
      archetype: "profile",
      action: "open",
      convention: "napplet:profile/open",
      payload: { pubkey: "target" },
    });
    expect(accepted.completion).toBeInstanceOf(Promise);
    await accepted.completion;
    expect(fixture.postMessage).toHaveBeenCalledWith(
      {
        type: "intent.deliver",
        delivery: {
          sender: "source",
          archetype: "profile",
          action: "open",
          convention: "napplet:profile/open",
          payload: { pubkey: "target" },
        },
      },
      "*",
    );
  });

  it("refuses delivery when the target narrowed away the intent binding", async () => {
    fixture.entries = [
      { windowId: "target", dTag: "same-name", aggregateHash: "hash" },
    ];
    fixture.catalog.set("target", "handler");
    setDeclaredDomains("same-name", "hash", ["inc"]);
    const accepted = createNappletTargetController().accept({
      handler: "handler",
      sender: "source",
      archetype: "profile",
      action: "open",
      convention: "napplet:profile/open",
    });
    await expect(accepted.completion).rejects.toThrow(
      'does not declare the "intent" NAP domain',
    );
    expect(fixture.postMessage).not.toHaveBeenCalled();
  });

  it("does not fall back to a live d-tag when the selected catalog ID is absent", async () => {
    fixture.entries = [
      { windowId: "wrong", dTag: "same-name", aggregateHash: "hash" },
    ];
    fixture.catalog.set("wrong", "nip5d:35129:other:same-name");
    const accepted = createNappletTargetController().accept({
      handler: "nip5d:35129:publisher:same-name",
      sender: "source",
      archetype: "profile",
      action: "open",
      convention: "napplet:profile/open",
    });
    await expect(accepted.completion).rejects.toThrow("no installed napplet");
    expect(fixture.postMessage).not.toHaveBeenCalled();
  });
});
