/**
 * The encrypt half against the decrypt half.
 *
 * The point of pairing them in one test is that neither side is authority for
 * the format: both are ports, and a shared mistake (the 12-vs-16-byte nonce
 * this codebase already made once) would let them agree with each other and
 * with nobody else. What this DOES prove is that grimoire can read back what it
 * writes, and that the integrity check refuses a swapped blob — the property
 * CORD-02 §6 exists for.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  encryptBytes,
  encryptFileForUpload,
  encryptFileWithParams,
} from "@/lib/concord/attachment-upload";
import { imetaTag } from "@/lib/chat/adapters/concord-adapter";
import { bytesToHex } from "@/lib/concord/derive";
import { fetchEncryptedBlob } from "@/lib/concord/image";
import { encryptedPointerOf, parseImetaTag } from "@/lib/imeta";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);

/** Serve `bytes` at any URL, the way the media host would. */
function serve(bytes: Uint8Array): void {
  vi.stubGlobal("fetch", async () =>
    Promise.resolve(
      new Response(bytes.slice().buffer as ArrayBuffer, { status: 200 }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an encrypted attachment", () => {
  it("reads back through the decrypt path", async () => {
    const file = new File([PNG], "icon.png", { type: "image/png" });
    const out = await encryptFileForUpload(file);
    serve(new Uint8Array(await out.file.arrayBuffer()));

    const read = await fetchEncryptedBlob({
      url: "https://blossom.example/blob",
      key: out.encryption.key,
      nonce: out.encryption.nonce,
      hash: out.encryption.ox,
    });
    expect(bytesToHex(read.bytes)).toBe(bytesToHex(PNG));
    // Sniffed from the plaintext, so the browser will render it.
    expect(read.mime).toBe("image/png");
  });

  it("mints a 32-byte key and a 16-byte nonce", async () => {
    // Armada's widths. AES-GCM accepts any IV length, so nothing downstream
    // would complain about 12 — it would just diverge from every other client
    // for no reason, which is how the read half got this wrong once already.
    const out = await encryptFileForUpload(
      new File([PNG], "x.png", { type: "image/png" }),
    );
    expect(out.encryption.key).toHaveLength(64);
    expect(out.encryption.nonce).toHaveLength(32);
    expect(out.encryption.algorithm).toBe("aes-gcm");
  });

  it("commits `ox` to the PLAINTEXT, not the ciphertext", async () => {
    const out = await encryptFileForUpload(
      new File([PNG], "x.png", { type: "image/png" }),
    );
    expect(out.encryption.ox).toBe(bytesToHex(sha256(PNG)));
  });

  it("keeps the plaintext MIME on the ciphertext", async () => {
    // Many Blossom servers reject `application/octet-stream`, and the reader
    // needs the real type to classify the attachment.
    const out = await encryptFileForUpload(
      new File([PNG], "x.png", { type: "image/png" }),
    );
    expect(out.file.type).toBe("image/png");
    expect(out.originalMime).toBe("image/png");
  });

  it("fails closed when the host swaps the blob", async () => {
    const out = await encryptFileForUpload(
      new File([PNG], "x.png", { type: "image/png" }),
    );
    // A DIFFERENT payload, encrypted under the same key and nonce: it decrypts
    // cleanly, so only the `ox` check can catch it. That is the whole reason
    // the plaintext hash is published.
    const other = new Uint8Array([9, 9, 9, 9]);
    serve(await encryptBytes(other, out.encryption.key, out.encryption.nonce));

    await expect(
      fetchEncryptedBlob({
        url: "https://blossom.example/blob",
        key: out.encryption.key,
        nonce: out.encryption.nonce,
        hash: out.encryption.ox,
      }),
    ).rejects.toThrow(/committed hash/);
  });

  it("encrypts a companion blob under the same key and nonce", async () => {
    // NIP-17: a `thumb` is "encrypted with the same key, nonce" as the file it
    // belongs to, so one published pair covers both blobs.
    const main = await encryptFileForUpload(
      new File([PNG], "video.mp4", { type: "video/mp4" }),
    );
    const poster = await encryptFileWithParams(
      new File([PNG], "poster.jpg", { type: "image/jpeg" }),
      main.encryption.key,
      main.encryption.nonce,
    );
    expect(poster.encryption.key).toBe(main.encryption.key);
    expect(poster.encryption.nonce).toBe(main.encryption.nonce);
  });
});

describe("the published imeta tag", () => {
  it("carries everything the reader needs to open the blob", async () => {
    // The crypto round-trip above proves the BYTES survive. This proves the
    // TAG does — which is the half that actually ships, and where a renamed or
    // dropped field makes a perfectly good blob permanently unreadable.
    const url = "https://blossom.example/abc";
    const out = await encryptFileForUpload(
      new File([PNG], "x.png", { type: "image/png" }),
    );
    const tag = imetaTag({
      url,
      sha256: "cc".repeat(32),
      mimeType: "application/octet-stream",
      encryption: out.encryption,
      originalMime: out.originalMime,
    });

    const pointer = encryptedPointerOf(parseImetaTag(tag) ?? undefined);
    expect(pointer).toBeDefined();

    serve(new Uint8Array(await out.file.arrayBuffer()));
    const read = await fetchEncryptedBlob(pointer!);
    expect(bytesToHex(read.bytes)).toBe(bytesToHex(PNG));
  });
});
