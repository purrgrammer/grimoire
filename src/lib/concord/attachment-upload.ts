/**
 * Encrypting an attachment before it is uploaded — the write half of CORD-02 §6.
 *
 * Ported from armada `bc19d1f`: `encryptFileForUpload` / `encryptFileWithParams`
 * / `encryptBytes` (`src/lib/encryptedMedia.ts`), and the metadata strip from
 * `resizeImage.ts` + `imageMetadata.ts`.
 *
 * The blob that reaches the media host is CIPHERTEXT. The AES-256-GCM key and
 * nonce travel in the message's `imeta`, readable only by members who can open
 * the event, and `ox` — the SHA-256 of the PLAINTEXT — is what lets a reader
 * fail closed when the untrusted host serves different bytes.
 *
 * **The nonce is 16 bytes.** Same constant, same reason as the read half in
 * `image.ts`: armada mints it that width to match Vector, AES-GCM permits any
 * IV length, and a 12-byte assumption here would mint blobs that every other
 * Concord client can still read (the nonce is published) but that diverge from
 * the format for no reason. Keep the two halves the same width.
 */

import { sha256 } from "@noble/hashes/sha2.js";

import { bytesToHex, hexToBytes } from "@/lib/concord/derive";
import {
  hasStrippableMetadata,
  isAnimatedImage,
  METADATA_SCAN_BYTES,
} from "@/lib/concord/image-metadata";

/** What the sender must publish in `imeta` for anyone to read the blob back. */
export interface AttachmentEncryption {
  /** Always `aes-gcm` — the only algorithm CORD-02 §6 defines. */
  algorithm: "aes-gcm";
  /** AES-256 key, lowercase hex (64 chars). */
  key: string;
  /** 16-byte GCM nonce, lowercase hex. */
  nonce: string;
  /** SHA-256 of the ORIGINAL plaintext. The reader's integrity check. */
  ox: string;
}

export interface EncryptedUpload {
  /** Ciphertext (`ciphertext ‖ 16-byte tag`), ready to upload. */
  file: File;
  encryption: AttachmentEncryption;
  /** The plaintext's MIME, which the ciphertext's own `m` tag would misreport. */
  originalMime: string;
}

/** A fresh ArrayBuffer-backed view — WebCrypto wants a real BufferSource. */
function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

/**
 * AES-256-GCM encrypt raw bytes under a hex key + nonce.
 *
 * WebCrypto's output layout is `ciphertext ‖ 16-byte tag`, which is exactly
 * what Vector and 0xChat expect, so blobs stay readable cross-client.
 */
export async function encryptBytes(
  plaintext: Uint8Array,
  keyHex: string,
  nonceHex: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    buf(hexToBytes(keyHex)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const out = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buf(hexToBytes(nonceHex)) },
    key,
    buf(plaintext),
  );
  return new Uint8Array(out);
}

/**
 * Encrypt a file under caller-supplied parameters.
 *
 * Separate from {@link encryptFileForUpload} because NIP-17 requires a
 * companion blob — a video's `thumb`, a `fallback` source — to be "encrypted
 * with the same key, nonce" as the file it belongs to. That is what lets the
 * single key/nonce pair in the message cover both blobs.
 */
export async function encryptFileWithParams(
  file: File,
  keyHex: string,
  nonceHex: string,
): Promise<EncryptedUpload> {
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const ciphertext = await encryptBytes(plaintext, keyHex, nonceHex);
  const originalMime = file.type || "application/octet-stream";

  return {
    // The ciphertext keeps the ORIGINAL MIME type: many Blossom servers reject
    // `application/octet-stream`, and armada sends the original for that reason.
    file: new File([ciphertext], file.name, { type: originalMime }),
    encryption: {
      algorithm: "aes-gcm",
      key: keyHex.toLowerCase(),
      nonce: nonceHex.toLowerCase(),
      ox: bytesToHex(sha256(plaintext)),
    },
    originalMime,
  };
}

/** Encrypt a file under a fresh random key and nonce. */
export async function encryptFileForUpload(
  file: File,
): Promise<EncryptedUpload> {
  return encryptFileWithParams(
    file,
    bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
  );
}

/** Longest side an uploaded image is scaled down to. */
const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.85;

/**
 * Prepare an image for upload: cap its longest side and strip embedded
 * metadata.
 *
 * Both are the same operation — drawing to a canvas and re-encoding discards
 * every ancillary chunk, EXIF included, and phone cameras put GPS COORDINATES
 * in EXIF. Encrypting the blob does not help there: the recipients are exactly
 * the people the location is hidden from, and a forwarded file carries it on.
 *
 * Re-encoding costs a generation of quality, so an image already within the
 * size limit AND carrying no metadata is uploaded byte-for-byte. Animated
 * images always pass through — a canvas round-trip would flatten them to one
 * frame.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  const head = new Uint8Array(
    await file.slice(0, METADATA_SCAN_BYTES).arrayBuffer(),
  );

  // `imageOrientation: "from-image"` bakes EXIF rotation into the pixels.
  // Without it, stripping the metadata leaves a sideways photo — the tag just
  // dropped was the only thing rotating it.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const { width, height } = bitmap;
  const needsResize = width > MAX_DIMENSION || height > MAX_DIMENSION;

  if (
    isAnimatedImage(file.type, head) ||
    (!needsResize && !hasStrippableMetadata(head))
  ) {
    bitmap.close();
    return file;
  }

  const scale = needsResize ? MAX_DIMENSION / Math.max(width, height) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // Encode both ways and keep the smaller: a photo wins as JPEG, a screenshot
  // or a transparent image as PNG.
  const [jpeg, png] = await Promise.all([
    canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY),
    canvasToBlob(canvas, "image/png"),
  ]);
  const best =
    jpeg.size <= png.size
      ? { blob: jpeg, ext: ".jpg", mime: "image/jpeg" }
      : { blob: png, ext: ".png", mime: "image/png" };

  return new File([best.blob], replaceExtension(file.name, best.ext), {
    type: best.mime,
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`Failed to encode ${type}`))),
      type,
      quality,
    );
  });
}

function replaceExtension(filename: string, ext: string): string {
  const dot = filename.lastIndexOf(".");
  return (dot > 0 ? filename.slice(0, dot) : filename) + ext;
}

/**
 * Strip metadata (images only), then encrypt.
 *
 * The order matters: the strip re-encodes the pixels, so encrypting first would
 * hand the canvas ciphertext and produce an unreadable blob.
 */
export async function prepareAttachment(file: File): Promise<EncryptedUpload> {
  const stripped = file.type.startsWith("image/")
    ? await prepareImageForUpload(file)
    : file;
  return encryptFileForUpload(stripped);
}
