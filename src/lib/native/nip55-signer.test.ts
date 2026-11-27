import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { EventTemplate, NostrEvent } from "nostr-tools";

const plugin = vi.hoisted(() => ({
  getInstalledSignerApps: vi.fn(),
  getPublicKey: vi.fn(),
  setPackageName: vi.fn(),
  signEvent: vi.fn(),
  nip04Encrypt: vi.fn(),
  nip04Decrypt: vi.fn(),
  nip44Encrypt: vi.fn(),
  nip44Decrypt: vi.fn(),
}));
vi.mock("capacitor-plugin-nostr-signer", () => ({
  NostrSignerPlugin: plugin,
}));

import { Nip55Account, Nip55Error, Nip55Signer } from "./nip55-signer";

// An ephemeral key standing in for the signer app's; never leaves the test.
const sk = generateSecretKey();
const PUBKEY = getPublicKey(sk);
const OTHER_SK = generateSecretKey();
const PKG = "com.greenart7c3.nostrsigner";

const template: EventTemplate = {
  kind: 1,
  created_at: 1_700_000_000,
  tags: [["t", "test"]],
  content: "hello from a fixture",
};

/** What an honest signer returns: a real signature over the request. */
function honestSign(_pkg: string, eventJson: string, id: string) {
  const req = JSON.parse(eventJson) as NostrEvent;
  const signed = finalizeEvent(
    {
      kind: req.kind,
      created_at: req.created_at,
      tags: req.tags,
      content: req.content,
    },
    sk,
  );
  return Promise.resolve({
    signature: signed.sig,
    id,
    event: JSON.stringify(signed),
  });
}

beforeEach(() => {
  for (const fn of Object.values(plugin)) fn.mockReset();
  plugin.setPackageName.mockResolvedValue(undefined);
});

describe("Nip55Signer.connect", () => {
  it("accepts a hex pubkey from the package it asked", async () => {
    plugin.getPublicKey.mockResolvedValue({ pubkey: PUBKEY, package: PKG });
    const signer = await Nip55Signer.connect(PKG);
    expect(await signer.getPublicKey()).toBe(PUBKEY);
    expect(plugin.setPackageName).toHaveBeenCalledWith(PKG);
  });

  it("refuses an answer from a different package", async () => {
    plugin.getPublicKey.mockResolvedValue({
      pubkey: PUBKEY,
      package: "com.evil.signer",
    });
    await expect(Nip55Signer.connect(PKG)).rejects.toMatchObject({
      code: "WRONG_PACKAGE",
    });
  });

  it("refuses a malformed pubkey", async () => {
    for (const pubkey of [null, "", "npub1xyz", "zz".repeat(32)]) {
      plugin.getPublicKey.mockResolvedValue({ pubkey, package: PKG });
      await expect(Nip55Signer.connect(PKG)).rejects.toBeInstanceOf(Nip55Error);
    }
  });

  it("reports the user saying no, and backing out", async () => {
    plugin.getPublicKey.mockRejectedValue({ code: "REJECTED" });
    await expect(Nip55Signer.connect(PKG)).rejects.toMatchObject({
      code: "REJECTED",
    });
    plugin.getPublicKey.mockRejectedValue({ code: "CANCELLED" });
    await expect(Nip55Signer.connect(PKG)).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });

  it("will not address something that is not a package name", async () => {
    await expect(Nip55Signer.connect("content://x")).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
    });
    expect(plugin.getPublicKey).not.toHaveBeenCalled();
  });
});

describe("Nip55Signer.signEvent", () => {
  const signer = () => new Nip55Signer(PKG, PUBKEY);

  it("returns a verified event built from our own template", async () => {
    plugin.signEvent.mockImplementation(honestSign);
    const event = await signer().signEvent(template);
    expect(event.pubkey).toBe(PUBKEY);
    expect(event.content).toBe(template.content);
    expect(plugin.signEvent.mock.calls[0][0]).toBe(PKG);
    expect(plugin.signEvent.mock.calls[0][3]).toBe(PUBKEY);
  });

  it("ignores a substituted event and checks the signature", async () => {
    // The signer signs something else and returns that event: the content
    // swap is caught because the signature must verify over OUR event.
    plugin.signEvent.mockImplementation((pkg, json, id) =>
      honestSign(
        pkg,
        JSON.stringify({ ...JSON.parse(json), content: "evil" }),
        id,
      ),
    );
    await expect(signer().signEvent(template)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("refuses a signature by another key", async () => {
    plugin.signEvent.mockImplementation((_pkg, json, id) => {
      const other = finalizeEvent({ ...JSON.parse(json) }, OTHER_SK);
      return Promise.resolve({ signature: other.sig, id, event: "" });
    });
    await expect(signer().signEvent(template)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("refuses an answer to a different request id", async () => {
    plugin.signEvent.mockImplementation(async (pkg, json, id) => ({
      ...(await honestSign(pkg, json, id)),
      id: "f".repeat(64),
    }));
    await expect(signer().signEvent(template)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("treats an empty result as a rejection and a garbage one as invalid", async () => {
    plugin.signEvent.mockResolvedValue({ signature: null, id: "", event: "" });
    await expect(signer().signEvent(template)).rejects.toMatchObject({
      code: "REJECTED",
    });
    plugin.signEvent.mockResolvedValue({ signature: "abc", id: "", event: "" });
    await expect(signer().signEvent(template)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("sends one request at a time, and a failure does not wedge the queue", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    plugin.signEvent.mockImplementation(async (pkg, json, id) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (++calls === 2) throw { code: "CANCELLED" };
      return honestSign(pkg, json, id);
    });
    const s = signer();
    const results = await Promise.allSettled([
      s.signEvent(template),
      s.signEvent({ ...template, content: "2" }),
      s.signEvent({ ...template, content: "3" }),
    ]);
    expect(maxInFlight).toBe(1);
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
  });
});

describe("Nip55Signer encryption", () => {
  it("passes our pubkey and the peer's, and rejects an empty answer", async () => {
    const s = new Nip55Signer(PKG, PUBKEY);
    const peer = getPublicKey(OTHER_SK);
    plugin.nip44Encrypt.mockImplementation(async (_p, _t, id: string) => ({
      result: "ciphertext",
      id,
    }));
    expect(await s.nip44.encrypt(peer, "hi")).toBe("ciphertext");
    const call = plugin.nip44Encrypt.mock.calls[0];
    expect([call[0], call[1], call[3], call[4]]).toEqual([
      PKG,
      "hi",
      peer,
      PUBKEY,
    ]);

    plugin.nip44Decrypt.mockResolvedValue({ result: "", id: "" });
    await expect(s.nip44.decrypt(peer, "x")).rejects.toMatchObject({
      code: "REJECTED",
    });
    await expect(s.nip04.encrypt("not-a-key", "x")).rejects.toBeInstanceOf(
      Nip55Error,
    );
  });
});

describe("Nip55Account persistence", () => {
  it("round-trips through JSON", () => {
    const account = new Nip55Account(PUBKEY, new Nip55Signer(PKG, PUBKEY));
    const json = JSON.parse(JSON.stringify(account.toJSON()));
    expect(json).toMatchObject({
      type: "android-nip55",
      pubkey: PUBKEY,
      signer: { packageName: PKG },
    });
    const restored = Nip55Account.fromJSON(json);
    expect(restored.pubkey).toBe(PUBKEY);
    expect(restored.signer.packageName).toBe(PKG);
    expect(restored.id).toBe(account.id);
  });

  it("refuses a tampered package name from storage", () => {
    const json = new Nip55Account(
      PUBKEY,
      new Nip55Signer(PKG, PUBKEY),
    ).toJSON();
    expect(() =>
      Nip55Account.fromJSON({
        ...json,
        signer: { packageName: "x;rm -rf /" },
      }),
    ).toThrow(Nip55Error);
  });
});
