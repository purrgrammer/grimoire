import { beforeEach, describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import { bytesToHex, random32 } from "@/lib/concord/derive";
import {
  KIND_CONTROL,
  KIND_JOIN_LEAVE,
  KIND_MESSAGE,
  KIND_SEAL_ENCRYPTED,
  KIND_SEAL_PLAINTEXT,
} from "@/lib/concord/kinds";
import type { OpenedEvent, OpenedWireEvent } from "@/lib/concord/stream";
import db from "@/services/db";

import {
  clearCommunityRumors,
  noteControlSnapshot,
  pruneControlSnapshots,
  queryPlane,
  readControlSnapshot,
  writeChatRumors,
  writeOpened,
} from "./concord-rumor-store";

const COMMUNITY = bytesToHex(random32());
const OTHER = bytesToHex(random32());
const author = generateSecretKey();

let counter = 0;

/** A wire-opened event: everything the plane fences actually inspect. */
function opened(over: Partial<OpenedWireEvent> = {}): OpenedWireEvent {
  counter++;
  const seal = finalizeEvent(
    { kind: KIND_SEAL_PLAINTEXT, content: "{}", tags: [], created_at: 1 },
    author,
  ) as NostrEvent;
  return {
    rumorId: counter.toString(16).padStart(64, "0"),
    author: getPublicKey(author),
    kind: KIND_CONTROL,
    content: "{}",
    tags: [],
    createdAt: 1_700_000_000,
    ms: 1_700_000_000_000,
    wrapId: `w${counter}`.padStart(64, "0"),
    streamPk: "aa".repeat(32),
    sealKind: KIND_SEAL_PLAINTEXT,
    seal,
    ...over,
  };
}

beforeEach(async () => {
  await db.concordRumors.clear();
  await db.concordSnapshots.clear();
});

describe("the plane boundary — writeOpened", () => {
  it("stores a well-formed control edition", async () => {
    expect(await writeOpened(COMMUNITY, [opened()], "control")).toBe(true);
    expect(await queryPlane(COMMUNITY, "control")).toHaveLength(1);
  });

  it("refuses a rumor whose kind belongs to another plane", async () => {
    // A holder of the CONTROL stream key wrapping a guestbook kind. Planes are
    // read back by kind, so without this the guestbook read serves it.
    await writeOpened(
      COMMUNITY,
      [opened({ kind: KIND_JOIN_LEAVE, sealKind: KIND_SEAL_PLAINTEXT })],
      "control",
    );
    expect(await queryPlane(COMMUNITY, "control")).toEqual([]);
    expect(await queryPlane(COMMUNITY, "guestbook")).toEqual([]);
  });

  it("refuses a control edition under the WRONG seal form", async () => {
    // CORD-02 §5 fixes 3308 as plaintext-sealed because a compaction re-wraps
    // it verbatim. An encrypted one could never survive that — it would mint
    // state that vanishes for the next joiner.
    await writeOpened(
      COMMUNITY,
      [opened({ sealKind: KIND_SEAL_ENCRYPTED })],
      "control",
    );
    expect(await queryPlane(COMMUNITY, "control")).toEqual([]);
  });

  it("refuses a plane rumor carrying a `channel` tag", async () => {
    // Half the fence: a channel tag would index it under a chat timeline —
    // possibly a private channel, possibly in another community.
    await writeOpened(
      COMMUNITY,
      [opened({ tags: [["channel", "bb".repeat(32)]] })],
      "control",
    );
    expect(await queryPlane(COMMUNITY, "control")).toEqual([]);
  });

  it("keeps the good rows when one in the batch is refused", async () => {
    await writeOpened(
      COMMUNITY,
      [opened(), opened({ kind: KIND_MESSAGE })],
      "control",
    );
    expect(await queryPlane(COMMUNITY, "control")).toHaveLength(1);
  });
});

describe("the plane boundary — writeChatRumors", () => {
  it("stores a chat message with its channel binding", async () => {
    const chat: OpenedEvent & { channel: string } = {
      ...opened({ kind: KIND_MESSAGE }),
      channel: "CC".repeat(32),
    };
    expect(await writeChatRumors(COMMUNITY, [chat])).toBe(true);
    const rows = await db.concordRumors
      .where("communityId")
      .equals(COMMUNITY)
      .toArray();
    // Normalized: CORD-01 has hex lowercase, and a query on the other spelling
    // must not miss the row.
    expect(rows[0].channel).toBe("cc".repeat(32));
  });

  it("refuses a chat rumor carrying a PLANE's kind", async () => {
    // The other half of the fence: a holder of any one channel's stream key
    // could otherwise wrap a kind-3308 rumor with a valid channel binding and
    // have the plane read serve it as a control edition. Nothing downstream
    // catches it — a stored rumor has no seal for the edition parser to check.
    const forged: OpenedEvent & { channel: string } = {
      ...opened({ kind: KIND_CONTROL }),
      channel: "cc".repeat(32),
    };
    await writeChatRumors(COMMUNITY, [forged]);
    expect(await queryPlane(COMMUNITY, "control")).toEqual([]);
  });
});

describe("community isolation", () => {
  it("never serves one community's plane into another's", async () => {
    await writeOpened(COMMUNITY, [opened()], "control");
    await writeOpened(OTHER, [opened()], "control");
    expect(await queryPlane(COMMUNITY, "control")).toHaveLength(1);
    expect(await queryPlane(OTHER, "control")).toHaveLength(1);

    await clearCommunityRumors(OTHER);
    expect(await queryPlane(COMMUNITY, "control")).toHaveLength(1);
    expect(await queryPlane(OTHER, "control")).toEqual([]);
  });
});

describe("control snapshot membership", () => {
  it("records which control address each edition arrived on", async () => {
    const pk = "11".repeat(32);
    await writeOpened(COMMUNITY, [opened({ streamPk: pk })], "control", {
      refounded: true,
    });
    const set = await readControlSnapshot(COMMUNITY, pk);
    expect(set?.size).toBe(1);
  });

  it("skips the bookkeeping for a community that never Refounded", async () => {
    // Nothing reads it there, and writing it grows an id list forever.
    const pk = "22".repeat(32);
    await writeOpened(COMMUNITY, [opened({ streamPk: pk })], "control", {
      refounded: false,
    });
    expect(await readControlSnapshot(COMMUNITY, pk)).toBeUndefined();
  });

  it("defaults to recording when the caller does not know", async () => {
    const pk = "33".repeat(32);
    await writeOpened(COMMUNITY, [opened({ streamPk: pk })], "control");
    expect(await readControlSnapshot(COMMUNITY, pk)).toBeDefined();
  });

  it("merges rather than replaces across sweeps", async () => {
    const pk = "44".repeat(32);
    await noteControlSnapshot(COMMUNITY, [{ streamPk: pk, rumorId: "a" }]);
    await noteControlSnapshot(COMMUNITY, [{ streamPk: pk, rumorId: "b" }]);
    expect([...(await readControlSnapshot(COMMUNITY, pk))!].sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("prunes the addresses whose keys are no longer held", async () => {
    await noteControlSnapshot(COMMUNITY, [
      { streamPk: "55".repeat(32), rumorId: "a" },
      { streamPk: "66".repeat(32), rumorId: "b" },
    ]);
    await pruneControlSnapshots(COMMUNITY, ["55".repeat(32)]);
    expect(await readControlSnapshot(COMMUNITY, "55".repeat(32))).toBeDefined();
    expect(
      await readControlSnapshot(COMMUNITY, "66".repeat(32)),
    ).toBeUndefined();
  });
});
