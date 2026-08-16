/**
 * Detecting embedded image metadata, so an upload knows whether it must be
 * re-encoded.
 *
 * Ported verbatim from armada `bc19d1f` (`src/lib/imageMetadata.ts`).
 *
 * Phone cameras write GPS coordinates into EXIF. An image carrying metadata is
 * re-encoded through a canvas — which drops every ancillary chunk — while a
 * clean one is uploaded byte-for-byte rather than paying a generation of
 * quality for nothing.
 */

/** How much of the file to inspect. Metadata lives near the front in practice. */
export const METADATA_SCAN_BYTES = 64 * 1024;

/**
 * Whether the head of an image file carries metadata worth stripping.
 *
 * JPEG is parsed exactly by walking its marker segments. Other formats fall
 * back to scanning for known chunk names, which can report a false positive —
 * the cost is one unnecessary re-encode, so the check errs toward stripping.
 */
export function hasStrippableMetadata(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegHasMetadata(bytes);
  return containsMetadataChunkName(bytes);
}

/**
 * Walk a JPEG's marker segments for the ones that carry metadata: APP1
 * (EXIF/XMP), APP2 (ICC/FlashPix), APP13 (IPTC/Photoshop) and COM.
 *
 * Other APPn markers are left alone — APP0 is the JFIF header and APP14 is
 * Adobe's colour-transform marker, which affect decoding rather than describing
 * the photographer.
 */
function jpegHasMetadata(bytes: Uint8Array): boolean {
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false; // desynced; stop guessing
    const marker = bytes[offset + 1];

    if (marker === 0xda) return false; // start of scan: image data follows
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2; // standalone markers carry no length field
      continue;
    }
    if (
      marker === 0xe1 ||
      marker === 0xe2 ||
      marker === 0xed ||
      marker === 0xfe
    )
      return true;

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return false;
    offset += 2 + length;
  }
  return false;
}

/** Metadata container names used by PNG, WebP, HEIF and friends. */
const METADATA_CHUNK_NAMES = [
  "Exif\0\0",
  "eXIf",
  "tEXt",
  "iTXt",
  "zTXt",
  "XMP ",
  "EXIF",
  "http://ns.adobe.com/xap",
];

function containsMetadataChunkName(bytes: Uint8Array): boolean {
  // latin1, so byte values map 1:1 to code units.
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return METADATA_CHUNK_NAMES.some((name) => text.includes(name));
}

/**
 * Whether an image is animated, and so must not be round-tripped through a
 * canvas — which would flatten it to a single frame.
 */
export function isAnimatedImage(mime: string, bytes: Uint8Array): boolean {
  // Every GIF is treated as animated: the safe default, and GIF has no EXIF to
  // leak anyway.
  if (mime === "image/gif") return true;

  if (mime === "image/webp") {
    // RIFF....WEBPVP8X with the animation flag, signalled by an ANIM chunk.
    for (let i = 12; i + 4 <= Math.min(bytes.length, 1024); i++) {
      if (
        bytes[i] === 0x41 &&
        bytes[i + 1] === 0x4e &&
        bytes[i + 2] === 0x49 &&
        bytes[i + 3] === 0x4d
      ) {
        return true;
      }
    }
    return false;
  }

  if (mime === "image/png" || mime === "image/apng") {
    // APNG is a PNG with an `acTL` chunk before the first `IDAT`.
    for (let i = 8; i + 4 <= Math.min(bytes.length, 4096); i++) {
      if (
        bytes[i] === 0x61 &&
        bytes[i + 1] === 0x63 &&
        bytes[i + 2] === 0x54 &&
        bytes[i + 3] === 0x4c
      ) {
        return true;
      }
      if (
        bytes[i] === 0x49 &&
        bytes[i + 1] === 0x44 &&
        bytes[i + 2] === 0x41 &&
        bytes[i + 3] === 0x54
      ) {
        return false;
      }
    }
    return false;
  }

  return false;
}
