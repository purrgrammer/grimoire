/**
 * The directory's job is not the Dexie read — `readStoredState` has its own
 * tests — it is knowing when NOT to do it. A wire ring arrives per message, so
 * a directory that re-folded every community per ring would fold the vault
 * hundreds of times a minute.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Community } from "@/lib/concord/types";

const loadStoredCommunities = vi.hoisted(() => vi.fn());
const readStoredState = vi.hoisted(() => vi.fn());

vi.mock("@/services/concord-communities", () => ({ loadStoredCommunities }));
vi.mock("@/services/concord-state", () => ({ readStoredState }));

const { channelDirectory, invalidateChannelDirectory, resolveChannel } =
  await import("./concord-channel-directory");

const ME = "11".repeat(32);
const BANNED = "99".repeat(32);
const ALPHA = "aa".repeat(32);
const BETA = "bb".repeat(32);
const GENERAL = "c1".repeat(32);
const SECRET = "c2".repeat(32);
const LOBBY = "c3".repeat(32);

const community = (idHex: string, name: string) =>
  ({ idHex, name, rootEpoch: 0n }) as unknown as Community;

const channel = (idHex: string, name: string, isPrivate = false) => ({
  idHex,
  name,
  isPrivate,
});

function stock(): void {
  loadStoredCommunities.mockResolvedValue([
    community(ALPHA, "Alpha"),
    community(BETA, "Beta"),
  ]);
  readStoredState.mockImplementation(async (c: Community) =>
    c.idHex === ALPHA
      ? {
          folded: { banned: new Set([BANNED]) },
          channels: [
            channel(GENERAL, "general"),
            channel(SECRET, "secret", true),
          ],
        }
      : {
          folded: { metadata: { name: "Beta Renamed" }, banned: new Set() },
          channels: [channel(LOBBY, "lobby")],
        },
  );
}

beforeEach(() => {
  loadStoredCommunities.mockReset();
  readStoredState.mockReset();
  invalidateChannelDirectory();
  stock();
});

describe("channelDirectory", () => {
  it("maps every channel of every mirrored community", async () => {
    const directory = await channelDirectory(ME);
    expect([...directory.keys()].sort()).toEqual(
      [GENERAL, SECRET, LOBBY].sort(),
    );
    expect(directory.get(SECRET)).toMatchObject({
      communityId: ALPHA,
      communityName: "Alpha",
      channelName: "secret",
      isPrivate: true,
    });
  });

  it("prefers the folded metadata name over the list entry's", async () => {
    expect((await channelDirectory(ME)).get(LOBBY)?.communityName).toBe(
      "Beta Renamed",
    );
  });

  it("carries the community's banlist to whoever asks about the channel", async () => {
    // What keeps a notification from pulling the reader to a message the
    // timeline will not show them.
    const entry = (await channelDirectory(ME)).get(GENERAL);
    expect(entry?.banned.has(BANNED)).toBe(true);
  });

  it("is built once and reused, however many times it is asked", async () => {
    await channelDirectory(ME);
    await channelDirectory(ME);
    await resolveChannel(ME, GENERAL);
    expect(loadStoredCommunities).toHaveBeenCalledTimes(1);
  });

  it("folds the vault once for a burst of simultaneous asks", async () => {
    await Promise.all([
      channelDirectory(ME),
      channelDirectory(ME),
      channelDirectory(ME),
    ]);
    expect(loadStoredCommunities).toHaveBeenCalledTimes(1);
  });

  it("rebuilds after an invalidation, and not before", async () => {
    await channelDirectory(ME);
    invalidateChannelDirectory();
    await channelDirectory(ME);
    expect(loadStoredCommunities).toHaveBeenCalledTimes(2);
  });

  it("rebuilds for a different account", async () => {
    await channelDirectory(ME);
    await channelDirectory("22".repeat(32));
    expect(loadStoredCommunities).toHaveBeenCalledTimes(2);
  });

  it("answers nothing for an account with no key", async () => {
    expect(await channelDirectory("")).toEqual(new Map());
    expect(loadStoredCommunities).not.toHaveBeenCalled();
  });
});

describe("resolveChannel", () => {
  it("finds a channel by its bare id, the way a wire ring names it", async () => {
    expect(await resolveChannel(ME, GENERAL)).toMatchObject({
      communityId: ALPHA,
      channelName: "general",
    });
  });

  it("matches regardless of the case the id arrives in", async () => {
    expect(await resolveChannel(ME, GENERAL.toUpperCase())).toBeDefined();
  });

  it("rebuilds once for an id it has never seen, in case it is new", async () => {
    const fresh = "c9".repeat(32);
    await channelDirectory(ME);
    expect(loadStoredCommunities).toHaveBeenCalledTimes(1);

    // The channel appears between the build and the ring — one rebuild finds it.
    readStoredState.mockImplementation(async (c: Community) =>
      c.idHex === ALPHA
        ? { folded: { banned: new Set() }, channels: [channel(fresh, "new")] }
        : { folded: { banned: new Set() }, channels: [] },
    );
    expect(await resolveChannel(ME, fresh)).toMatchObject({
      channelName: "new",
    });
    expect(loadStoredCommunities).toHaveBeenCalledTimes(2);
  });

  it("does not rebuild again for an id that genuinely belongs to nobody", async () => {
    const stranger = "ff".repeat(32);
    expect(await resolveChannel(ME, stranger)).toBeUndefined();
    const after = loadStoredCommunities.mock.calls.length;
    expect(await resolveChannel(ME, stranger)).toBeUndefined();
    expect(loadStoredCommunities).toHaveBeenCalledTimes(after);
  });

  it("looks again for a stranger once something invalidates the directory", async () => {
    const stranger = "ff".repeat(32);
    await resolveChannel(ME, stranger);
    const before = loadStoredCommunities.mock.calls.length;
    invalidateChannelDirectory();
    await resolveChannel(ME, stranger);
    expect(loadStoredCommunities.mock.calls.length).toBeGreaterThan(before);
  });

  it("survives a vault that will not open", async () => {
    invalidateChannelDirectory();
    loadStoredCommunities.mockRejectedValue(new Error("locked"));
    expect(await resolveChannel(ME, GENERAL)).toBeUndefined();
  });
});
