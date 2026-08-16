import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";

import { makeRosterProfileSearch } from "./roster-search";
import type { ProfileSearchResult } from "@/services/profile-search";

const ALICE = "aa".repeat(32);
const BOB = "bb".repeat(32);
const GHOST = "cc".repeat(32);
const STRANGER = "dd".repeat(32);

const profiles = new Map<string, ProfileSearchResult>([
  [ALICE, { pubkey: ALICE, displayName: "Alice", username: "alice" }],
  [BOB, { pubkey: BOB, displayName: "Bob Loblaw", nip05: "bob@example.com" }],
  [STRANGER, { pubkey: STRANGER, displayName: "Someone Else" }],
]);

const lookup = (pubkey: string) => profiles.get(pubkey);
const roster = [{ pubkey: ALICE }, { pubkey: BOB }, { pubkey: GHOST }];
const search = makeRosterProfileSearch(roster, lookup);

describe("makeRosterProfileSearch", () => {
  it("offers every member when nothing has been typed yet", async () => {
    const all = await search("");
    expect(all.map((r) => r.pubkey)).toEqual([ALICE, BOB, GHOST]);
  });

  it("never offers a non-member, however well known they are", async () => {
    // The whole point: the global index has this profile and the room does not.
    expect(await search("Someone")).toEqual([]);
  });

  it("offers a member with no cached profile, labelled by their npub", async () => {
    const ghost = (await search("")).find((r) => r.pubkey === GHOST);
    expect(ghost?.displayName).toBe(`${nip19.npubEncode(GHOST).slice(0, 12)}…`);
  });

  it("matches on the display name, the username and the nip-05", async () => {
    expect((await search("ali")).map((r) => r.pubkey)).toEqual([ALICE]);
    expect((await search("loblaw")).map((r) => r.pubkey)).toEqual([BOB]);
    expect((await search("bob@example")).map((r) => r.pubkey)).toEqual([BOB]);
  });

  it("matches regardless of case", async () => {
    expect((await search("ALICE")).map((r) => r.pubkey)).toEqual([ALICE]);
  });

  it("keeps the roster's own order, so the owner and admins lead", async () => {
    const ordered = makeRosterProfileSearch(
      [{ pubkey: BOB }, { pubkey: ALICE }],
      lookup,
    );
    expect((await ordered("")).map((r) => r.pubkey)).toEqual([BOB, ALICE]);
  });

  it("lists a member once even if the roster names them twice", async () => {
    const duped = makeRosterProfileSearch(
      [{ pubkey: ALICE }, { pubkey: ALICE }],
      lookup,
    );
    expect(await duped("")).toHaveLength(1);
  });

  it("finds a member by the hex of their key", async () => {
    expect((await search(GHOST)).map((r) => r.pubkey)).toEqual([GHOST]);
  });
});
