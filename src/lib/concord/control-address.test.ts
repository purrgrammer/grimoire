import { describe, expect, it } from "vitest";

import {
  bytesToHex,
  communityIdOf,
  controlGroupKey,
  controlSignerGroupKey,
  hex32,
  random32,
} from "./derive";
import { currentControlPlane, heldControlPlanes } from "./control-address";
import type { Community } from "./types";

const owner = bytesToHex(random32());
const ownerSalt = random32();
const id = communityIdOf(hex32(owner), ownerSalt);

function community(over: Partial<Community> = {}): Community {
  const root = random32();
  return {
    id,
    idHex: bytesToHex(id),
    owner,
    ownerSalt,
    root,
    rootEpoch: 0n,
    heldRoots: [{ epoch: 0n, key: root }],
    privateChannels: [],
    relays: ["wss://a.example"],
    name: "Test",
    ...over,
  };
}

describe("legacy (pre-split) epoch", () => {
  it("is the derived key whole — address, signer and read key in one", () => {
    const c = community();
    const view = currentControlPlane(c);
    const derived = controlGroupKey(c.root, c.id, 0n);
    expect(view.group.pk).toBe(derived.pk);
    expect(view.group.sk).toEqual(derived.sk);
    expect(view.canAuthenticate).toBe(true);
    // NOT write-restricted: the signature is made with a key every member
    // derives, so verifying it would prove nothing.
    expect(view.group.restricted).toBeUndefined();
  });
});

describe("split epoch (CORD-02 §2)", () => {
  it("reads at the HELD address under the root-derived conversation key", () => {
    const controlRoot = random32();
    const root = random32();
    const controlPk = controlSignerGroupKey(controlRoot, id, 0n).pk;
    const c = community({
      root,
      controlPk,
      heldRoots: [{ epoch: 0n, key: root, controlPk }],
    });
    const view = currentControlPlane(c);
    expect(view.group.pk).toBe(controlPk);
    // Only the ADDRESS moves; the wrap content is still encrypted under the
    // community_root-derived key in both generations.
    expect(view.group.convKey).toEqual(controlGroupKey(root, id, 0n).convKey);
    // WRITE-RESTRICTED: the signature proves a control_root holder published
    // it, so openWrap must verify it — skipping that lets any member mint
    // editions.
    expect(view.group.restricted).toBe(true);
  });

  it("gives an ordinary member no secret — ADDRESS-ONLY", () => {
    const controlPk = controlSignerGroupKey(random32(), id, 0n).pk;
    const c = community({
      controlPk,
      heldRoots: [{ epoch: 0n, key: random32(), controlPk }],
    });
    const view = currentControlPlane(c);
    expect(view.group.sk).toBeUndefined();
    expect(view.canAuthenticate).toBe(false);
  });

  it("gives a STAFF member the signer, so they can answer a NIP-42 challenge", () => {
    // Grimoire never publishes control editions, but the secret still decides
    // whether a staff member can READ their own plane on a gating relay.
    // Omitting it locks an admin out of the plane they administer.
    const controlRoot = random32();
    const signer = controlSignerGroupKey(controlRoot, id, 0n);
    const c = community({
      controlPk: signer.pk,
      controlRoot,
      heldRoots: [{ epoch: 0n, key: random32(), controlPk: signer.pk }],
    });
    const view = currentControlPlane(c);
    expect(view.group.sk).toEqual(signer.sk);
    expect(view.canAuthenticate).toBe(true);
  });

  it("fails closed when the held secret does not derive to the held address", () => {
    // Corrupt state, not a signer: minting wraps at an address nobody
    // subscribes to would be worse than staying read-only.
    const controlPk = controlSignerGroupKey(random32(), id, 0n).pk;
    const c = community({
      controlPk,
      controlRoot: random32(), // unrelated secret
      heldRoots: [{ epoch: 0n, key: random32(), controlPk }],
    });
    const view = currentControlPlane(c);
    expect(view.group.sk).toBeUndefined();
    expect(view.canAuthenticate).toBe(false);
  });

  it("never claims the signer for a RETIRED epoch", () => {
    // `controlRoot` is the CURRENT epoch's secret only; a prior epoch's signer
    // is not derivable from it, so a retained root must stay address-only.
    const controlRoot = random32();
    const current = controlSignerGroupKey(controlRoot, id, 1n);
    const priorPk = controlSignerGroupKey(random32(), id, 0n).pk;
    const c = community({
      rootEpoch: 1n,
      controlPk: current.pk,
      controlRoot,
      heldRoots: [
        { epoch: 1n, key: random32(), controlPk: current.pk },
        { epoch: 0n, key: random32(), controlPk: priorPk },
      ],
    });
    const views = heldControlPlanes(c);
    expect(views.find((v) => v.epoch === 1n)!.canAuthenticate).toBe(true);
    expect(views.find((v) => v.epoch === 0n)!.canAuthenticate).toBe(false);
  });
});

describe("heldControlPlanes", () => {
  it("yields one view per held epoch, so every address can be registered", () => {
    // An address missing from the auth registry reports "not yet registered"
    // rather than "accounted for", which blocks a sweep instead of proceeding.
    const c = community({
      rootEpoch: 2n,
      heldRoots: [
        { epoch: 2n, key: random32() },
        { epoch: 1n, key: random32() },
        { epoch: 0n, key: random32() },
      ],
    });
    expect(heldControlPlanes(c).map((v) => Number(v.epoch))).toEqual([2, 1, 0]);
  });
});
