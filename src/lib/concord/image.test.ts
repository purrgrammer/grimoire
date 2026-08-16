/**
 * Encrypted community images (CORD-02 §6).
 *
 * The point of this module is the REFUSALS: the media host is untrusted, so a
 * client that rendered whatever it was handed would make the encryption
 * decorative. Every test below is a way the host can lie.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bytesToHex } from "@/lib/concord/derive";
import { EncryptedImageError, fetchEncryptedBlob } from "@/lib/concord/image";

const KEY = new Uint8Array(32).fill(7);
const NONCE = new Uint8Array(16).fill(3); // armada's width, matching Vector
const PLAIN = new TextEncoder().encode("the real image bytes");

/** Encrypt as the uploader would, so the fixture is the real wire format. */
async function seal(plain: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    KEY as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const out = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: NONCE as BufferSource },
    key,
    plain as BufferSource,
  );
  return new Uint8Array(out);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  );
}

let served: Uint8Array = new Uint8Array();
let status = 200;

beforeEach(async () => {
  status = 200;
  served = await seal(PLAIN);
  vi.stubGlobal("fetch", async () => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () =>
      served.buffer.slice(
        served.byteOffset,
        served.byteOffset + served.byteLength,
      ),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const pointer = async () => ({
  url: "https://media.example/blob",
  key: bytesToHex(KEY),
  nonce: bytesToHex(NONCE),
  hash: await sha256Hex(PLAIN),
});

describe("fetchEncryptedBlob", () => {
  it("returns the plaintext when everything checks out", async () => {
    const { bytes } = await fetchEncryptedBlob(await pointer());
    expect(new TextDecoder().decode(bytes)).toBe("the real image bytes");
  });

  it("REFUSES a blob whose plaintext does not match the committed hash", async () => {
    // The attack this exists for: a host that swaps the bytes. It decrypts
    // fine under a key the host also holds — only the committed hash catches it.
    const swapped = new TextEncoder().encode("something else entirely");
    served = await seal(swapped);
    await expect(fetchEncryptedBlob(await pointer())).rejects.toThrow(
      /committed hash/,
    );
  });

  it("refuses a blob that was tampered with in transit", async () => {
    const corrupt = await seal(PLAIN);
    corrupt[0] ^= 0xff;
    served = corrupt;
    await expect(fetchEncryptedBlob(await pointer())).rejects.toThrow(
      /did not decrypt/,
    );
  });

  it("does NOT pin the nonce width — armada mints 16, not the usual 12", async () => {
    // The bug this replaces: a 12-byte assumption, taken from NIP-44 and
    // general practice rather than from armada, refused every real community
    // icon on the network.
    for (const width of [12, 16]) {
      const nonce = new Uint8Array(width).fill(5);
      const key = await crypto.subtle.importKey(
        "raw",
        KEY as BufferSource,
        "AES-GCM",
        false,
        ["encrypt"],
      );
      served = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce as BufferSource },
          key,
          PLAIN as BufferSource,
        ),
      );
      const out = await fetchEncryptedBlob({
        ...(await pointer()),
        nonce: bytesToHex(nonce),
      });
      expect(new TextDecoder().decode(out.bytes)).toBe("the real image bytes");
    }
  });

  it("refuses a wrong key without pretending to know why", async () => {
    await expect(
      fetchEncryptedBlob({
        ...(await pointer()),
        key: bytesToHex(new Uint8Array(32).fill(9)),
      }),
    ).rejects.toThrow(/did not decrypt/);
  });

  it("sniffs the mime, without which the browser renders nothing", async () => {
    // The pointer carries no extension and no mime, so a Blob with an empty
    // type will not render in an `<img>`.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2]);
    served = await seal(png);
    const out = await fetchEncryptedBlob({
      ...(await pointer()),
      hash: await sha256Hex(png),
    });
    expect(out.mime).toBe("image/png");
  });

  it("refuses a host that will not serve the blob", async () => {
    status = 404;
    await expect(fetchEncryptedBlob(await pointer())).rejects.toThrow(/404/);
  });

  it("throws EncryptedImageError, never a bare failure", async () => {
    status = 500;
    await expect(fetchEncryptedBlob(await pointer())).rejects.toBeInstanceOf(
      EncryptedImageError,
    );
  });
});
