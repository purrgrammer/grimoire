/**
 * The dissolution tombstone (CORD-02 §9), and the one check that stops it being
 * a kill switch for every community its owner runs.
 */

import { describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import { bytesToHex, dissolvedGroupKey, random32 } from "@/lib/concord/derive";
import { findTombstone, isDissolvedOpened } from "@/lib/concord/dissolution";
import {
  KIND_CONTROL,
  KIND_SEAL_ENCRYPTED,
  KIND_SEAL_PLAINTEXT,
  VSK_DISSOLVED,
  VSK_METADATA,
} from "@/lib/concord/kinds";
import {
  buildRumor,
  openWrap,
  sealRumor,
  wrapSeal,
} from "@/lib/concord/stream";

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const communityId = random32();
const otherId = random32();

/** One tombstone on the wire, signed by `sk`, naming `eid`. */
async function tombstone(opts: {
  sk?: Uint8Array;
  eid?: string;
  vsk?: string;
  sealKind?: number;
  at?: Uint8Array;
}): Promise<NostrEvent> {
  const sk = opts.sk ?? ownerSk;
  const group = dissolvedGroupKey(opts.at ?? communityId);
  const rumor = buildRumor({
    kind: KIND_CONTROL,
    content: "",
    tags: [
      ["vsk", opts.vsk ?? VSK_DISSOLVED],
      ["eid", opts.eid ?? bytesToHex(communityId)],
    ],
    pubkey: getPublicKey(sk),
    ms: 5_000,
  });
  const seal = await sealRumor(
    rumor,
    (opts.sealKind ?? KIND_SEAL_PLAINTEXT) as typeof KIND_SEAL_PLAINTEXT,
    group,
    { signEvent: async (t) => finalizeEvent(t, sk) },
  );
  return wrapSeal(seal, group);
}

const open = async (wrap: NostrEvent, at = communityId) =>
  openWrap(wrap, dissolvedGroupKey(at));

describe("isDissolvedOpened", () => {
  it("accepts an owner-signed tombstone naming this community", async () => {
    expect(
      isDissolvedOpened(await open(await tombstone({})), owner, communityId),
    ).toBe(true);
  });

  it("refuses a tombstone signed by anyone but the owner", async () => {
    // The address derives from the community_id alone and that id ships in
    // every invite, so anyone can publish here. Only the signature counts.
    const impostor = generateSecretKey();
    expect(
      isDissolvedOpened(
        await open(await tombstone({ sk: impostor })),
        owner,
        communityId,
      ),
    ).toBe(false);
  });

  it("REFUSES an all-zero `eid` rather than grandfathering it", async () => {
    // Earlier revisions specified this placeholder; accepting it IS the
    // vulnerability. The failure modes are not symmetric — refusing leaves a
    // dead community reading alive, which its owner fixes by re-dissolving.
    expect(
      isDissolvedOpened(
        await open(await tombstone({ eid: "0".repeat(64) })),
        owner,
        communityId,
      ),
    ).toBe(false);
  });

  it("refuses a genuine tombstone lifted from ANOTHER of the owner's communities", async () => {
    // The attack the `eid` exists to stop: the seal is plaintext, so it
    // re-wraps verbatim with its signature intact. Without the binding, one
    // real tombstone kills every community the same owner runs.
    const lifted = await tombstone({
      eid: bytesToHex(otherId),
      at: communityId,
    });
    expect(isDissolvedOpened(await open(lifted), owner, communityId)).toBe(
      false,
    );
    // …and it is still valid for the community it was actually minted for.
    expect(isDissolvedOpened(await open(lifted), owner, otherId)).toBe(true);
  });

  it("refuses a non-plaintext seal (CORD-02 §5)", async () => {
    expect(
      isDissolvedOpened(
        await open(await tombstone({ sealKind: KIND_SEAL_ENCRYPTED })),
        owner,
        communityId,
      ),
    ).toBe(false);
  });

  it("refuses another edition kind at the same address", async () => {
    expect(
      isDissolvedOpened(
        await open(await tombstone({ vsk: VSK_METADATA })),
        owner,
        communityId,
      ),
    ).toBe(false);
  });
});

describe("findTombstone", () => {
  it("returns the tombstone's ms, so a caller can order actions around it", async () => {
    // A timestamp rather than a boolean: both planes replay from history, so a
    // caller judging a past action needs to know which side of the grave it
    // falls on.
    const wraps = [
      await tombstone({ sk: generateSecretKey() }),
      await tombstone({}),
    ];
    expect(findTombstone(wraps, communityId, owner)).toBe(5_000);
  });

  it("is undefined when nothing at the address is a valid tombstone", async () => {
    const wraps = [await tombstone({ eid: "0".repeat(64) })];
    expect(findTombstone(wraps, communityId, owner)).toBeUndefined();
  });

  it("ignores a wrap that will not open under the dissolved key", async () => {
    const junk = finalizeEvent(
      { kind: 1059, content: "nope", tags: [], created_at: 1 },
      dissolvedGroupKey(communityId).sk!,
    );
    expect(findTombstone([junk], communityId, owner)).toBeUndefined();
  });
});
