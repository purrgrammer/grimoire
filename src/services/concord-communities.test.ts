import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { nip44 } from "nostr-tools";

import {
  bytesToHex,
  communityIdOf,
  hex32,
  random32,
} from "@/lib/concord/derive";
import { KIND_COMMUNITY_LIST } from "@/lib/concord/kinds";
import type {
  CommunityList,
  CommunityListEntry,
  JoinMaterial,
} from "@/lib/concord/community-list";
import type { NostrEvent } from "@/types/nostr";

// The vault must be readable with no network and no relay selection at all.
const requestEvents = vi.hoisted(() => vi.fn());
vi.mock("@/lib/relay-subscription", () => ({ requestEvents }));
vi.mock("@/services/relay-selection", () => ({
  selectRelaysForFilter: vi.fn(async () => ({
    relays: ["wss://outbox.example"],
    reasoning: [],
    isOptimized: true,
  })),
}));
vi.mock("@/services/event-store", () => ({ default: {} }));

/** The things the logout wipe does in MEMORY, which Dexie cannot show. */
const invalidateChannelDirectory = vi.hoisted(() => vi.fn());
vi.mock("@/services/concord-channel-directory", () => ({
  invalidateChannelDirectory,
}));
const resetNotifPrefsMemory = vi.hoisted(() => vi.fn());
vi.mock("@/services/concord-notif-prefs", () => ({ resetNotifPrefsMemory }));
const resetAnnouncedMemory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/concord/notify", () => ({ resetAnnouncedMemory }));

const {
  _resetDecryptMemoForTests,
  clearCommunities,
  loadStoredCommunities,
  readJoinedAtMs,
  syncCommunities,
} = await import("./concord-communities");
const { markChannelRead } = await import("./concord-reads");
const { default: db } = await import("./db");

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const selfKey = nip44.getConversationKey(sk, pubkey);
/** The real signer capability, exactly as an account exposes it. */
const signer = {
  nip44: {
    decrypt: async (_pk: string, ct: string) => nip44.decrypt(ct, selfKey),
  },
};

function joinMaterial(name: string): JoinMaterial {
  const owner = bytesToHex(random32());
  const salt = random32();
  return {
    community_id: bytesToHex(communityIdOf(hex32(owner), salt)),
    owner,
    owner_salt: bytesToHex(salt),
    community_root: bytesToHex(random32()),
    root_epoch: 0,
    channels: [],
    relays: ["wss://community.example"],
    name,
  };
}

function entry(jm: JoinMaterial, addedAt = 1000): CommunityListEntry {
  return {
    community_id: jm.community_id,
    seed: jm,
    current: jm,
    added_at: addedAt,
  };
}

/** A genuine kind-13302: the list JSON, NIP-44 self-encrypted, signed. */
function listEvent(list: CommunityList, createdAt = 1_700_000_000): NostrEvent {
  return finalizeEvent(
    {
      kind: KIND_COMMUNITY_LIST,
      content: nip44.encrypt(JSON.stringify(list), selfKey),
      tags: [],
      created_at: createdAt,
    },
    sk,
  ) as NostrEvent;
}

beforeEach(async () => {
  await db.concordCommunities.clear();
  await db.concordKv.clear();
  _resetDecryptMemoForTests();
  requestEvents.mockReset();
});

describe("readJoinedAtMs", () => {
  it("reads the list entry's added_at", async () => {
    const alpha = joinMaterial("Alpha");
    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(alpha, 4242)], tombstones: [] }),
    ]);
    await syncCommunities(pubkey, signer);
    expect(await readJoinedAtMs(pubkey, alpha.community_id)).toBe(4242);
  });

  it("is UNDEFINED, never 0, when it cannot be established", async () => {
    // A join time of 0 makes every rotation in history postdate the join, which
    // turns off the single guard stopping a stale-invite joiner being ejected
    // from channels. "We do not know" must be distinguishable from "epoch 0",
    // so the watcher can decline to act at all — the way armada does.
    const alpha = joinMaterial("Alpha");
    const broken = entry(alpha);
    delete (broken as { added_at?: number }).added_at;
    requestEvents.mockResolvedValue([
      listEvent({ entries: [broken], tombstones: [] }),
    ]);
    await syncCommunities(pubkey, signer);
    expect(await readJoinedAtMs(pubkey, alpha.community_id)).toBeUndefined();

    // …and for a community with no row at all.
    expect(await readJoinedAtMs(pubkey, "ff".repeat(32))).toBeUndefined();
  });
});

describe("syncCommunities", () => {
  it("decrypts the list and mirrors the live memberships", async () => {
    const alpha = joinMaterial("Alpha");
    const beta = joinMaterial("Beta");
    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(alpha), entry(beta)], tombstones: [] }),
    ]);

    const result = await syncCommunities(pubkey, signer);
    expect(result.status).toBe("ok");
    expect(result.communities.map((c) => c.name)).toEqual(["Alpha", "Beta"]);
    // And they survive without a signer or a relay — the point of mirroring.
    expect((await loadStoredCommunities(pubkey)).map((c) => c.name)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("drops a tombstoned membership from the mirror", async () => {
    const alpha = joinMaterial("Alpha");
    const gone = joinMaterial("Gone");
    requestEvents.mockResolvedValue([
      listEvent({
        entries: [entry(alpha), entry(gone)],
        tombstones: [{ community_id: gone.community_id, removed_at: 5000 }],
      }),
    ]);
    const { communities } = await syncCommunities(pubkey, signer);
    expect(communities.map((c) => c.name)).toEqual(["Alpha"]);
  });

  it("removes a community the user has since left", async () => {
    // The replace is a delete-then-put in one transaction; without the delete
    // a left community would linger in the vault forever.
    const alpha = joinMaterial("Alpha");
    const beta = joinMaterial("Beta");
    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(alpha), entry(beta)], tombstones: [] }),
    ]);
    await syncCommunities(pubkey, signer);

    requestEvents.mockResolvedValue([
      listEvent(
        {
          entries: [entry(alpha), entry(beta)],
          tombstones: [{ community_id: beta.community_id, removed_at: 9000 }],
        },
        1_700_000_100,
      ),
    ]);
    const { communities } = await syncCommunities(pubkey, signer);
    expect(communities.map((c) => c.name)).toEqual(["Alpha"]);
  });

  it("takes the newest event when a relay serves two copies", async () => {
    const old = joinMaterial("Old");
    const fresh = joinMaterial("Fresh");
    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(old)], tombstones: [] }, 1_700_000_000),
      listEvent({ entries: [entry(fresh)], tombstones: [] }, 1_700_000_500),
    ]);
    const { communities } = await syncCommunities(pubkey, signer);
    expect(communities.map((c) => c.name)).toEqual(["Fresh"]);
  });

  it("memoizes the decrypt of a given list event", async () => {
    // Independently of the mirror floor below: a remote signer round-trip on a
    // few KB of NIP-44 is the one cost worth never paying twice.
    const decrypt = vi.fn(signer.nip44.decrypt);
    const event = listEvent({
      entries: [entry(joinMaterial("Alpha"))],
      tombstones: [],
    });
    requestEvents.mockResolvedValue([event]);
    await syncCommunities(pubkey, { nip44: { decrypt } });
    await db.concordKv.clear(); // drop the floor, so only the memo can save us
    await syncCommunities(pubkey, { nip44: { decrypt } });
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it("NEVER clears the vault when the list will not decrypt", async () => {
    // The community_root and channel keys live in that document: a wrongful
    // empty looks exactly like leaving every community at once.
    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(joinMaterial("Alpha"))], tombstones: [] }),
    ]);
    await syncCommunities(pubkey, signer);

    requestEvents.mockResolvedValue([
      {
        ...listEvent({ entries: [], tombstones: [] }, 1_700_000_900),
        content: "garbage",
      },
    ]);
    const result = await syncCommunities(pubkey, signer);
    expect(result.status).toBe("decrypt-failed");
    expect(result.communities.map((c) => c.name)).toEqual(["Alpha"]);
  });

  it("retries a transient decrypt failure rather than memoizing it", async () => {
    const event = listEvent({
      entries: [entry(joinMaterial("Alpha"))],
      tombstones: [],
    });
    requestEvents.mockResolvedValue([event]);
    const decrypt = vi
      .fn()
      .mockRejectedValueOnce(new Error("signer asleep"))
      .mockImplementation(signer.nip44.decrypt);

    expect((await syncCommunities(pubkey, { nip44: { decrypt } })).status).toBe(
      "decrypt-failed",
    );
    expect((await syncCommunities(pubkey, { nip44: { decrypt } })).status).toBe(
      "ok",
    );
  });

  it("returns the stored vault untouched with no NIP-44 signer", async () => {
    // A read-only account, or a remote signer still connecting: the
    // communities must not blank while it wakes up.
    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(joinMaterial("Alpha"))], tombstones: [] }),
    ]);
    await syncCommunities(pubkey, signer);

    const result = await syncCommunities(pubkey, {});
    expect(result.status).toBe("no-decryptor");
    expect(result.communities.map((c) => c.name)).toEqual(["Alpha"]);
    expect(requestEvents).toHaveBeenCalledTimes(1); // no pointless fetch
  });

  it("keeps the vault when no relay serves a list", async () => {
    // Silence is not proof of absence — the relays may simply not carry it.
    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(joinMaterial("Alpha"))], tombstones: [] }),
    ]);
    await syncCommunities(pubkey, signer);

    requestEvents.mockResolvedValue([]);
    const result = await syncCommunities(pubkey, signer);
    expect(result.status).toBe("ok");
    expect(result.communities.map((c) => c.name)).toEqual(["Alpha"]);
  });

  it("refuses an OLDER list served by a lagging relay", async () => {
    // Armada gets this from its merge ("a transient short relay read can't
    // drop rooms"). With no merge, monotonicity is the substitute: a relay
    // behind on a replaceable serves a genuine, decryptable, older 13302, and
    // taking it deletes the rows — keys and all — for everything joined since.
    const alpha = joinMaterial("Alpha");
    const beta = joinMaterial("Beta");
    requestEvents.mockResolvedValue([
      listEvent(
        { entries: [entry(alpha), entry(beta)], tombstones: [] },
        1_700_000_500,
      ),
    ]);
    await syncCommunities(pubkey, signer);

    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(alpha)], tombstones: [] }, 1_700_000_100),
    ]);
    const result = await syncCommunities(pubkey, signer);
    expect(result.status).toBe("ok");
    expect(result.communities.map((c) => c.name)).toEqual(["Alpha", "Beta"]);
  });

  it("does not re-decrypt the list event already mirrored", async () => {
    const event = listEvent({
      entries: [entry(joinMaterial("Alpha"))],
      tombstones: [],
    });
    requestEvents.mockResolvedValue([event]);
    const decrypt = vi.fn(signer.nip44.decrypt);
    await syncCommunities(pubkey, { nip44: { decrypt } });
    _resetDecryptMemoForTests(); // even with a cold memo
    await syncCommunities(pubkey, { nip44: { decrypt } });
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it("holds the floor for a viewer whose list is legitimately empty", async () => {
    // The floor lives beside the rows, not on them, so an empty vault still
    // refuses a rollback to an older document.
    requestEvents.mockResolvedValue([
      listEvent({ entries: [], tombstones: [] }, 1_700_000_500),
    ]);
    await syncCommunities(pubkey, signer);

    requestEvents.mockResolvedValue([
      listEvent(
        { entries: [entry(joinMaterial("Ghost"))], tombstones: [] },
        1_700_000_100,
      ),
    ]);
    expect((await syncCommunities(pubkey, signer)).communities).toEqual([]);
  });

  it("keeps one account's vault out of another's", async () => {
    // The rows carry decrypted community_roots, so they are keyed by viewer.
    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(joinMaterial("Alpha"))], tombstones: [] }),
    ]);
    await syncCommunities(pubkey, signer);

    const other = getPublicKey(generateSecretKey());
    expect(await loadStoredCommunities(other)).toEqual([]);
    await clearCommunities(other);
    expect(await loadStoredCommunities(pubkey)).toHaveLength(1);
    await clearCommunities(pubkey);
    expect(await loadStoredCommunities(pubkey)).toEqual([]);
    // And the floor goes with the rows, so a re-login re-mirrors from scratch.
    expect(
      await db.concordKv.get(`concordListState:${pubkey}`),
    ).toBeUndefined();
  });

  it("takes the decrypted messages, not just the keys", async () => {
    // The comment on the rumor store said "Wiped on logout" for the whole port
    // and nothing did it: `clearCommunityRumors` had no caller outside its own
    // test. Clearing the keys alone protects nothing — these rows are ALREADY
    // plaintext, so nothing has to be decrypted a second time to read them.
    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(joinMaterial("Alpha"))], tombstones: [] }),
    ]);
    await syncCommunities(pubkey, signer);

    await db.concordRumors.put({
      id: "aa".repeat(32),
      communityId: "cc".repeat(32),
      kind: 9,
      pubkey,
      created_at: 1,
      ms: 1000,
      content: "the plaintext of a private message",
      tags: [],
      sig: "",
      channel: "dd".repeat(32),
    } as never);
    await db.concordKv.put({ key: "wire-cursor:whatever", value: 1 });
    // Read state names the channels this person was reading and when they last
    // looked — the same class of thing, and account-scoped, so it goes too.
    await markChannelRead(pubkey, "cc".repeat(32), "dd".repeat(32), 1_700_000);

    await clearCommunities(pubkey);

    expect(await db.concordRumors.count()).toBe(0);
    expect(await db.concordKv.count()).toBe(0);
    expect(await db.chatReads.count()).toBe(0);
  });

  it("takes what was never sent as well as what was read", async () => {
    // A queued send and a half-typed draft are prose this account WROTE and no
    // relay has even seen. Both are account-scoped, so both go — and only this
    // account's: signing out must not wipe another account's composer.
    const other = getPublicKey(generateSecretKey());
    await db.concordOutbox.bulkPut([
      {
        id: "mine",
        pubkey,
        communityId: "cc".repeat(32),
        channel: "dd".repeat(32),
        kind: 9,
        content: "never sent",
        createdAt: 1,
        status: "failed",
        attempts: 1,
      },
      {
        id: "theirs",
        pubkey: other,
        communityId: "cc".repeat(32),
        channel: "dd".repeat(32),
        kind: 9,
        content: "someone else's",
        createdAt: 1,
        status: "failed",
        attempts: 1,
      },
    ]);
    await db.chatDrafts.bulkPut([
      {
        key: `${pubkey}:concord:cc:dd`,
        content: { half: "typed" },
        updatedAt: 1,
      },
      {
        key: `${other}:concord:cc:dd`,
        content: { half: "typed" },
        updatedAt: 1,
      },
    ]);

    await clearCommunities(pubkey);

    expect((await db.concordOutbox.toArray()).map((r) => r.id)).toEqual([
      "theirs",
    ]);
    expect((await db.chatDrafts.toArray()).map((r) => r.key)).toEqual([
      `${other}:concord:cc:dd`,
    ]);
  });

  it("forgets the in-memory channel directory, names and all", async () => {
    // It holds decrypted community and channel names, so it must not outlive
    // the fold it read them from — a memo left populated is the running tab's
    // copy of what was just erased from disk.
    invalidateChannelDirectory.mockClear();
    await clearCommunities(pubkey);
    expect(invalidateChannelDirectory).toHaveBeenCalled();
  });

  it("forgets the notification levels the emptied kv table held", async () => {
    // The rows go with `db.concordKv.clear()` above; the memo in front of them
    // has to go too, or this tab keeps muting channels for the next account.
    resetNotifPrefsMemory.mockClear();
    await clearCommunities(pubkey);
    expect(resetNotifPrefsMemory).toHaveBeenCalled();
  });

  it("forgets the drafts it was holding in memory to answer renders", async () => {
    // The rows go with the wipe above; the cache in front of them answers the
    // composer synchronously, so leaving it populated hands one account's
    // half-typed messages to whoever signs in next.
    const { draftKey, draftsReady, readDraft, writeDraft } =
      await import("./chat-drafts");
    const key = draftKey(pubkey, "concord", "cc:dd");
    await draftsReady();
    writeDraft(key, { type: "doc" });
    expect(readDraft(key)).toBeDefined();

    await clearCommunities(pubkey);
    expect(readDraft(key)).toBeUndefined();
  });

  it("forgets how this device had the sidebar arranged", async () => {
    // Pins, folded categories and the channel each community was left on live
    // in localStorage rather than `concordKv`, so the table wipe cannot reach
    // them — and they name the communities and channels this account cared
    // enough about to arrange, which is the same disclosure the levels go for.
    const { CHAT_PREFS_STORAGE_KEY, concordPrefsManager, loadPrefs } =
      await import("./concord-prefs");
    concordPrefsManager.togglePin("cc".repeat(32), "dd".repeat(32));
    concordPrefsManager.setLastChannel("cc".repeat(32), "dd".repeat(32));
    expect(localStorage.getItem(CHAT_PREFS_STORAGE_KEY)).not.toBeNull();

    await clearCommunities(pubkey);

    expect(localStorage.getItem(CHAT_PREFS_STORAGE_KEY)).toBeNull();
    // And the tab it was still painting from, not only the stored copy.
    expect(concordPrefsManager.value.pinnedChannels).toEqual([]);
    expect(loadPrefs().lastChannelByContainer).toEqual({});
  });

  it("forgets which messages this tab has already announced", async () => {
    // Rumor ids belonging to the account that just left. Bounded and opaque,
    // so nothing leaks — but the memo block is where the account's traces go,
    // and a memo nobody reset is the one that gets missed next time.
    resetAnnouncedMemory.mockClear();
    await clearCommunities(pubkey);
    expect(resetAnnouncedMemory).toHaveBeenCalled();
  });

  it("drops a stored row whose owner commitment no longer verifies", async () => {
    const jm = joinMaterial("Alpha");
    requestEvents.mockResolvedValue([
      listEvent({ entries: [entry(jm)], tombstones: [] }),
    ]);
    await syncCommunities(pubkey, signer);

    const row = (
      await db.concordCommunities.where("pubkey").equals(pubkey).toArray()
    )[0];
    const tampered = row.entry as CommunityListEntry;
    tampered.current = { ...tampered.current, owner: bytesToHex(random32()) };
    await db.concordCommunities.put({ ...row, entry: tampered });

    expect(await loadStoredCommunities(pubkey)).toEqual([]);
  });
});
