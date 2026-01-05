import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublishSpellAction } from "./publish-spell";
import accountManager from "@/services/accounts";
import pool from "@/services/relay-pool";
import * as spellStorage from "@/services/spell-storage";
import { LocalSpell } from "@/services/db";

// Mock dependencies
vi.mock("@/services/accounts", () => ({
  default: {
    active: {
      signer: {},
      pubkey: "test-pubkey",
    },
  },
}));

vi.mock("@/services/relay-pool", () => ({
  default: {
    publish: vi.fn(),
  },
}));

vi.mock("@/services/spell-storage", () => ({
  markSpellPublished: vi.fn(),
}));

vi.mock("@/services/relay-list-cache", () => ({
  relayListCache: {
    getOutboxRelays: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/services/event-store", () => ({
  default: {
    add: vi.fn(),
  },
}));

describe("PublishSpellAction", () => {
  let action: PublishSpellAction;

  beforeEach(() => {
    vi.clearAllMocks();
    action = new PublishSpellAction();
  });

  it("should fail if no active account", async () => {
    // @ts-expect-error: mocking internal state for test
    accountManager.active = null;

    const spell: LocalSpell = {
      id: "spell-1",
      command: "req -k 1",
      createdAt: 123,
      isPublished: false,
    };

    await expect(action.execute(spell)).rejects.toThrow("No active account");
  });

  it("should publish spell and update storage", async () => {
    const mockSigner = {
      getPublicKey: vi.fn().mockResolvedValue("pubkey"),
      signEvent: vi.fn().mockImplementation((draft) =>
        Promise.resolve({
          ...draft,
          id: "event-id",
          pubkey: "pubkey",
          sig: "sig",
        }),
      ),
    };

    // @ts-expect-error: mocking internal state for test
    accountManager.active = {
      signer: mockSigner,
      pubkey: "pubkey",
    };

    const spell: LocalSpell = {
      id: "local-id",
      command: "req -k 1",
      name: "My Spell",
      description: "Description",
      createdAt: 1234567890,
      isPublished: false,
    };

    await action.execute(spell);

    // Check if signer was called
    expect(mockSigner.signEvent).toHaveBeenCalled();

    // Check if published to pool
    expect(pool.publish).toHaveBeenCalled();

    // Check if storage updated
    expect(spellStorage.markSpellPublished).toHaveBeenCalledWith(
      "local-id",
      expect.objectContaining({
        kind: 777,
        // We expect tags to contain name and alt (description)
        tags: expect.arrayContaining([
          ["name", "My Spell"],
          ["alt", expect.stringContaining("Description")],
          ["cmd", "REQ"],
        ]),
      }),
    );
  });
});
