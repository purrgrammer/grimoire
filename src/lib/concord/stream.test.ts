import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { EventTemplate } from "nostr-tools/pure";
import { describe, expect, it, beforeEach } from "vitest";

import {
  channelGroupKey,
  controlGroupKey,
  controlSignerGroupKey,
  guestbookGroupKey,
  type StreamKeyView,
} from "./derive";
import {
  KIND_CONTROL,
  KIND_MESSAGE,
  KIND_SEAL_ENCRYPTED,
  KIND_SEAL_PLAINTEXT,
  KIND_WRAP,
  KIND_WRAP_EPHEMERAL,
} from "./kinds";
import {
  buildRumor,
  channelBindingTags,
  checkChannelBinding,
  openWrap,
  resolveMs,
  rewrapSeal,
  sealRumor,
  wrapSeal,
} from "./stream";
import { _resetVerifyCacheForTests } from "./verify-cache";

const secret = new Uint8Array(32).fill(9);
const communityId = new Uint8Array(32).fill(5);
const channelId = new Uint8Array(32).fill(4);
const channelIdHex = "04".repeat(32);

function testSigner(sk = generateSecretKey()) {
  return {
    sk,
    pubkey: getPublicKey(sk),
    signEvent: async (t: EventTemplate) => finalizeEvent(t, sk),
  };
}

beforeEach(() => {
  _resetVerifyCacheForTests();
});

describe("stream envelope (CORD-01)", () => {
  it("round-trips a message through an encrypted seal", async () => {
    const alice = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    const ms = 1719800000417;
    const rumor = buildRumor({
      kind: KIND_MESSAGE,
      content: "Hey chat!",
      tags: channelBindingTags(channelIdHex, 0n),
      pubkey: alice.pubkey,
      ms,
    });
    const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, stream, alice);
    const wrap = wrapSeal(seal, stream);

    expect(wrap.kind).toBe(KIND_WRAP);
    expect(wrap.pubkey).toBe(stream.pk); // fixed author (NIP-59 reversed)
    expect(wrap.tags.find((t) => t[0] === "p")?.[1]).toBeTruthy(); // ephemeral p

    const opened = openWrap(wrap, stream);
    expect(opened.author).toBe(alice.pubkey);
    expect(opened.content).toBe("Hey chat!");
    expect(opened.kind).toBe(KIND_MESSAGE);
    expect(opened.ms).toBe(ms);
    expect(opened.sealKind).toBe(KIND_SEAL_ENCRYPTED);
    expect(() => checkChannelBinding(opened, channelIdHex, 0n)).not.toThrow();
  });

  it("round-trips a plaintext seal (Control Plane form)", async () => {
    const alice = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    const rumor = buildRumor({
      kind: KIND_CONTROL,
      content: "{}",
      tags: [],
      pubkey: alice.pubkey,
      ms: null,
    });
    const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, stream, alice);
    // The plaintext seal's content IS the rumor JSON, byte-verbatim.
    expect(JSON.parse(seal.content).id).toBe(rumor.id);
    const opened = openWrap(wrapSeal(seal, stream), stream);
    expect(opened.rumorId).toBe(rumor.id);
    expect(opened.sealKind).toBe(KIND_SEAL_PLAINTEXT);
  });

  it("a plaintext seal survives a re-wrap into another epoch (compaction)", async () => {
    const alice = testSigner();
    const e0 = channelGroupKey(secret, channelId, 0);
    const e1 = channelGroupKey(secret, channelId, 1);
    const rumor = buildRumor({
      kind: KIND_CONTROL,
      content: "{}",
      tags: [],
      pubkey: alice.pubkey,
      ms: null,
    });
    const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, e0, alice);
    const opened0 = openWrap(wrapSeal(seal, e0), e0);
    const rewrapped = rewrapSeal(opened0.seal, e1);
    const opened1 = openWrap(rewrapped, e1);
    expect(opened1.rumorId).toBe(rumor.id);
    expect(opened1.author).toBe(alice.pubkey);
  });

  it("an ENCRYPTED seal cannot be re-encrypted into another stream", async () => {
    // The signature binds to the ciphertext, which is why only the Control
    // Plane's plaintext seals can be compacted across epochs.
    const alice = testSigner();
    const e0 = channelGroupKey(secret, channelId, 0);
    const e1 = channelGroupKey(secret, channelId, 1);
    const rumor = buildRumor({
      kind: KIND_MESSAGE,
      content: "hi",
      tags: channelBindingTags(channelIdHex, 0n),
      pubkey: alice.pubkey,
      ms: Date.now(),
    });
    const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, e0, alice);
    // A keyholder re-wraps the SAME seal at epoch 1: the wrap opens, but the
    // seal's ciphertext was encrypted under e0's conv key → rumor recover fails.
    expect(() => openWrap(wrapSeal(seal, e1), e1)).toThrow();
  });

  it("rejects a foreign wrap (author is not the stream address)", async () => {
    const alice = testSigner();
    const s1 = channelGroupKey(secret, channelId, 0);
    const s2 = guestbookGroupKey(secret, channelId, 0);
    const rumor = buildRumor({
      kind: KIND_MESSAGE,
      content: "x",
      tags: [],
      pubkey: alice.pubkey,
      ms: Date.now(),
    });
    const wrap = wrapSeal(
      await sealRumor(rumor, KIND_SEAL_ENCRYPTED, s1, alice),
      s1,
    );
    expect(() => openWrap(wrap, s2)).toThrow(/stream's address/);
  });

  it("rejects a rumor whose author differs from the seal's signer", async () => {
    const alice = testSigner();
    const mallory = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    // Mallory (a keyholder) seals a rumor claiming Alice authored it.
    const forged = buildRumor({
      kind: KIND_MESSAGE,
      content: "im alice",
      tags: [],
      pubkey: alice.pubkey,
      ms: Date.now(),
    });
    const seal = await sealRumor(forged, KIND_SEAL_ENCRYPTED, stream, mallory);
    expect(() => openWrap(wrapSeal(seal, stream), stream)).toThrow(
      /does not match the seal/,
    );
  });

  it("rejects a rumor whose id is not its hash (grounds the ordering tiebreak)", async () => {
    const alice = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    const rumor = buildRumor({
      kind: KIND_MESSAGE,
      content: "x",
      tags: [],
      pubkey: alice.pubkey,
      ms: Date.now(),
    });
    const lying = { ...rumor, id: "00".repeat(32) };
    const seal = await sealRumor(lying, KIND_SEAL_ENCRYPTED, stream, alice);
    expect(() => openWrap(wrapSeal(seal, stream), stream)).toThrow(
      /event hash/,
    );
  });

  it("drops an event with a malformed ms tag rather than interpreting it", async () => {
    const alice = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    const rumor = buildRumor({
      kind: KIND_MESSAGE,
      content: "x",
      tags: [["ms", "5000"]],
      pubkey: alice.pubkey,
      ms: null,
    });
    const wrap = wrapSeal(
      await sealRumor(rumor, KIND_SEAL_ENCRYPTED, stream, alice),
      stream,
    );
    expect(() => openWrap(wrap, stream)).toThrow(/ms/);
    expect(resolveMs(100, [["ms", "999"]])).toBe(100999);
    expect(resolveMs(100, [])).toBe(100000);
    expect(() => resolveMs(100, [["ms", "-1"]])).toThrow();
  });

  it("parses the ms remainder as STRICT decimal only", () => {
    // `Number()` is lenient — these must all be rejected as malformed, or two
    // clients would disagree on the ordering basis every comparison rides
    // (CORD-02 §4/§5).
    expect(() => resolveMs(1000, [["ms", ""]])).toThrow(); // Number("") === 0
    expect(() => resolveMs(1000, [["ms", "0x1f"]])).toThrow();
    expect(() => resolveMs(1000, [["ms", "1e2"]])).toThrow();
    expect(() => resolveMs(1000, [["ms", " 5 "]])).toThrow();
    expect(() => resolveMs(1000, [["ms", "+5"]])).toThrow();
    expect(() => resolveMs(1000, [["ms", "05"]])).toThrow(); // no leading zeros
    expect(() => resolveMs(1000, [["ms", "1000"]])).toThrow(); // out of 0..999
    expect(resolveMs(1000, [["ms", "0"]])).toBe(1_000_000);
    expect(resolveMs(1000, [["ms", "417"]])).toBe(1_000_417);
  });

  it("refuses a negative or non-finite send time rather than emitting a bad ms tag", () => {
    const alice = testSigner();
    // A glitched clock would otherwise mint `["ms","-234"]`, an un-decodable
    // event every reader drops (CORD-02 §5).
    expect(() =>
      buildRumor({
        kind: KIND_MESSAGE,
        content: "x",
        pubkey: alice.pubkey,
        ms: -1234,
      }),
    ).toThrow(/ms/);
    expect(() =>
      buildRumor({
        kind: KIND_MESSAGE,
        content: "x",
        pubkey: alice.pubkey,
        ms: NaN,
      }),
    ).toThrow(/ms/);
    const ok = buildRumor({
      kind: KIND_MESSAGE,
      content: "x",
      pubkey: alice.pubkey,
      ms: 1_719_800_000_417,
    });
    expect(ok.tags.find((t) => t[0] === "ms")?.[1]).toBe("417");
  });

  it("detects a cross-channel splice via the binding tags", async () => {
    const alice = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    const rumor = buildRumor({
      kind: KIND_MESSAGE,
      content: "x",
      tags: channelBindingTags("ff".repeat(32), 0n), // committed to another channel
      pubkey: alice.pubkey,
      ms: Date.now(),
    });
    const wrap = wrapSeal(
      await sealRumor(rumor, KIND_SEAL_ENCRYPTED, stream, alice),
      stream,
    );
    expect(() =>
      checkChannelBinding(openWrap(wrap, stream), channelIdHex, 0n),
    ).toThrow(/splice/);
  });

  it("refuses a duplicated binding tag rather than picking one", async () => {
    // Two `channel` tags make the binding ambiguous; accepting either would let
    // a keyholder satisfy two different coordinates with one rumor.
    const alice = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    const rumor = buildRumor({
      kind: KIND_MESSAGE,
      content: "x",
      tags: [
        ["channel", channelIdHex],
        ["channel", "ff".repeat(32)],
        ["epoch", "0"],
      ],
      pubkey: alice.pubkey,
      ms: Date.now(),
    });
    const wrap = wrapSeal(
      await sealRumor(rumor, KIND_SEAL_ENCRYPTED, stream, alice),
      stream,
    );
    expect(() =>
      checkChannelBinding(openWrap(wrap, stream), channelIdHex, 0n),
    ).toThrow(/duplicate/);
  });

  it("ephemeral wraps carry the 21059 kind", async () => {
    const alice = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    const rumor = buildRumor({
      kind: 23311,
      content: "",
      tags: [],
      pubkey: alice.pubkey,
      ms: Date.now(),
    });
    const wrap = wrapSeal(
      await sealRumor(rumor, KIND_SEAL_ENCRYPTED, stream, alice),
      stream,
      { ephemeral: true },
    );
    expect(wrap.kind).toBe(KIND_WRAP_EPHEMERAL);
    expect(openWrap(wrap, stream).kind).toBe(23311);
  });
});

describe("write-restricted streams (CORD-01, the split Control Plane)", () => {
  // The half of CORD-01 that only the split Control Plane uses, and the half
  // grimoire depends on most: a member holds `control_pk` and the
  // community_root-derived read key, but not the signer secret. The wrap
  // signature is therefore the write gate, and a reader MUST check it — where
  // an ordinary stream's wrap signature is made with a key every reader holds
  // and proves nothing.
  const controlRoot = new Uint8Array(32).fill(0xc0);

  /** How a member holds a split Control Plane: address from staff, key derived. */
  function memberView(epoch: number): StreamKeyView {
    const signer = controlSignerGroupKey(controlRoot, communityId, epoch);
    const read = controlGroupKey(secret, communityId, epoch);
    return { pk: signer.pk, convKey: read.convKey, restricted: true };
  }

  it("opens a wrap signed by the control_root holder", async () => {
    const alice = testSigner();
    const signer = controlSignerGroupKey(controlRoot, communityId, 0);
    const read = controlGroupKey(secret, communityId, 0);
    const rumor = buildRumor({
      kind: KIND_CONTROL,
      content: "{}",
      tags: [],
      pubkey: alice.pubkey,
      ms: null,
    });
    // Staff seal under the READ key and sign the wrap with the SIGNER key.
    const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, read, alice);
    const wrap = wrapSeal(seal, { ...signer, convKey: read.convKey });

    const opened = openWrap(wrap, memberView(0));
    expect(opened.rumorId).toBe(rumor.id);
    expect(opened.author).toBe(alice.pubkey);
  });

  it("refuses a wrap whose signature does not verify", async () => {
    const alice = testSigner();
    const signer = controlSignerGroupKey(controlRoot, communityId, 0);
    const read = controlGroupKey(secret, communityId, 0);
    const rumor = buildRumor({
      kind: KIND_CONTROL,
      content: "{}",
      tags: [],
      pubkey: alice.pubkey,
      ms: null,
    });
    const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, read, alice);
    const wrap = wrapSeal(seal, { ...signer, convKey: read.convKey });

    const tampered = { ...wrap, sig: "00".repeat(64) };
    expect(() => openWrap(tampered, memberView(0))).toThrow(
      /write-restricted wrap signature/,
    );
  });

  it("refuses a wrap that carries no signature at all", async () => {
    // A stored/parked wrap has its signature stripped. That is fine for an
    // ordinary plane, whose signature is never checked, but a restricted plane
    // cannot be verified from one — it must be refused, not waved through.
    const alice = testSigner();
    const signer = controlSignerGroupKey(controlRoot, communityId, 0);
    const read = controlGroupKey(secret, communityId, 0);
    const rumor = buildRumor({
      kind: KIND_CONTROL,
      content: "{}",
      tags: [],
      pubkey: alice.pubkey,
      ms: null,
    });
    const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, read, alice);
    const { sig: _sig, ...unsigned } = wrapSeal(seal, {
      ...signer,
      convKey: read.convKey,
    });
    expect(() => openWrap(unsigned, memberView(0))).toThrow(
      /write-restricted wrap signature/,
    );
  });

  it("does not check the wrap signature on an ordinary stream", async () => {
    // The contrast that makes the check meaningful: an ordinary plane's wrap is
    // signed by a key every member holds, so its signature proves nothing and a
    // stripped one must still open (that is how stored wraps are replayed).
    const alice = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    const rumor = buildRumor({
      kind: KIND_MESSAGE,
      content: "x",
      tags: [],
      pubkey: alice.pubkey,
      ms: Date.now(),
    });
    const { sig: _sig, ...unsigned } = wrapSeal(
      await sealRumor(rumor, KIND_SEAL_ENCRYPTED, stream, alice),
      stream,
    );
    expect(openWrap(unsigned, stream).content).toBe("x");
  });

  it("a member cannot forge a wrap at the control address", async () => {
    // The whole point of the split: a member holds the read key and the
    // address, so they can encrypt a convincing payload — but they cannot sign
    // at the address, and the reader checks.
    const mallory = testSigner();
    const read = controlGroupKey(secret, communityId, 0);
    const rumor = buildRumor({
      kind: KIND_CONTROL,
      content: "{}",
      tags: [],
      pubkey: mallory.pubkey,
      ms: null,
    });
    const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, read, mallory);
    // Mallory signs with a key of her own and relabels it as the control address.
    const forged = {
      ...wrapSeal(seal, read),
      pubkey: memberView(0).pk,
    };
    expect(() => openWrap(forged, memberView(0))).toThrow(
      /write-restricted wrap signature/,
    );
  });
});

describe("wrap expiration (CORD-08 §2)", () => {
  it("stamps the wrap with a NIP-40 tag on request, and opens unchanged", async () => {
    const alice = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    const rumor = buildRumor({
      kind: KIND_MESSAGE,
      content: "fleeting",
      tags: [
        ...channelBindingTags(channelIdHex, 0n),
        ["expiration", "1735689600"],
      ],
      pubkey: alice.pubkey,
      ms: Date.now(),
    });
    const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, stream, alice);

    const wrap = wrapSeal(seal, stream, { expiration: 1735689600.7 });
    // Floored to whole seconds — a fractional deadline is not a NIP-40 value.
    expect(wrap.tags).toContainEqual(["expiration", "1735689600"]);
    // The ephemeral `p` camouflage stays alongside it.
    expect(wrap.tags.some((t) => t[0] === "p")).toBe(true);
    expect(openWrap(wrap, stream).content).toBe("fleeting");
  });

  it("stamps nothing by default", async () => {
    const alice = testSigner();
    const stream = channelGroupKey(secret, channelId, 0);
    const rumor = buildRumor({
      kind: KIND_MESSAGE,
      content: "x",
      tags: channelBindingTags(channelIdHex, 0n),
      pubkey: alice.pubkey,
      ms: Date.now(),
    });
    const wrap = wrapSeal(
      await sealRumor(rumor, KIND_SEAL_ENCRYPTED, stream, alice),
      stream,
    );
    expect(wrap.tags.some((t) => t[0] === "expiration")).toBe(false);
  });
});
