#!/usr/bin/env node
/**
 * Generate PWA icons and favicons from the Grimoire logo SVG.
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 *
 * Requires: npm install --save-dev sharp
 *
 * This script generates:
 * - favicon-16x16.png
 * - favicon-32x32.png
 * - favicon-192x192.png (PWA icon)
 * - favicon-512x512.png (PWA icon)
 * - favicon-192x192-maskable.png (PWA maskable icon with padding)
 * - favicon-512x512-maskable.png (PWA maskable icon with padding)
 * - apple-touch-icon.png (180x180)
 * - favicon.ico (multi-resolution ico file)
 */

import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");
const PUBLIC_DIR = join(ROOT_DIR, "public");
const LOGO_PATH = join(PUBLIC_DIR, "logo.svg");

// Read the SVG file
const svgBuffer = readFileSync(LOGO_PATH);

// Icon sizes to generate
const STANDARD_SIZES = [16, 32, 192, 512];
const MASKABLE_SIZES = [192, 512];
const APPLE_TOUCH_SIZE = 180;

// Transparent background for the icons
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * Generate a standard icon (logo fills most of the space with small padding)
 */
async function generateStandardIcon(size, outputName) {
  // Add 10% padding on each side for standard icons
  const padding = Math.round(size * 0.1);
  const logoSize = size - padding * 2;

  // Calculate logo dimensions maintaining aspect ratio (122:160)
  const aspectRatio = 122 / 160;
  const logoHeight = logoSize;
  const logoWidth = Math.round(logoHeight * aspectRatio);

  // Center the logo
  const left = Math.round((size - logoWidth) / 2);
  const top = Math.round((size - logoHeight) / 2);

  const resizedLogo = await sharp(svgBuffer)
    .resize(logoWidth, logoHeight, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: resizedLogo, left, top }])
    .png()
    .toFile(join(PUBLIC_DIR, outputName));

  console.log(`Generated: ${outputName} (${size}x${size})`);
}

/**
 * Generate a maskable icon (logo with more padding for safe zone)
 * Maskable icons need the important content within the "safe zone" (center 80%)
 */
async function generateMaskableIcon(size, outputName) {
  // Maskable icons need 20% padding (40% total safe zone margin)
  const padding = Math.round(size * 0.2);
  const logoSize = size - padding * 2;

  // Calculate logo dimensions maintaining aspect ratio (122:160)
  const aspectRatio = 122 / 160;
  const logoHeight = logoSize;
  const logoWidth = Math.round(logoHeight * aspectRatio);

  // Center the logo
  const left = Math.round((size - logoWidth) / 2);
  const top = Math.round((size - logoHeight) / 2);

  const resizedLogo = await sharp(svgBuffer)
    .resize(logoWidth, logoHeight, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: resizedLogo, left, top }])
    .png()
    .toFile(join(PUBLIC_DIR, outputName));

  console.log(`Generated: ${outputName} (${size}x${size}, maskable)`);
}

/**
 * Generate favicon.ico with multiple resolutions
 */
async function generateFavicon() {
  // Generate 16x16, 32x32, and 48x48 versions for the .ico file
  const sizes = [16, 32, 48];
  const pngBuffers = [];

  for (const size of sizes) {
    const padding = Math.round(size * 0.1);
    const logoSize = size - padding * 2;
    const aspectRatio = 121 / 160;
    const logoHeight = logoSize;
    const logoWidth = Math.round(logoHeight * aspectRatio);
    const left = Math.round((size - logoWidth) / 2);
    const top = Math.round((size - logoHeight) / 2);

    const resizedLogo = await sharp(svgBuffer)
      .resize(logoWidth, logoHeight, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .toBuffer();

    const buffer = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: TRANSPARENT,
      },
    })
      .composite([{ input: resizedLogo, left, top }])
      .png()
      .toBuffer();

    pngBuffers.push({ size, buffer });
  }

  // Create a simple ICO file manually
  // ICO format: https://en.wikipedia.org/wiki/ICO_(file_format)
  const icoBuffer = createIcoFromPngs(pngBuffers);
  writeFileSync(join(PUBLIC_DIR, "favicon.ico"), icoBuffer);
  console.log("Generated: favicon.ico (16x16, 32x32, 48x48)");
}

/**
 * Create an ICO file from PNG buffers
 */
function createIcoFromPngs(pngBuffers) {
  const numImages = pngBuffers.length;

  // Calculate total size
  let dataOffset = 6 + numImages * 16; // Header (6) + Directory entries (16 each)
  const imageData = [];

  for (const { size, buffer } of pngBuffers) {
    imageData.push({
      size,
      buffer,
      offset: dataOffset,
    });
    dataOffset += buffer.length;
  }

  // Create the ICO buffer
  const totalSize = dataOffset;
  const ico = Buffer.alloc(totalSize);
  let offset = 0;

  // ICO Header
  ico.writeUInt16LE(0, offset); // Reserved
  offset += 2;
  ico.writeUInt16LE(1, offset); // Type (1 = ICO)
  offset += 2;
  ico.writeUInt16LE(numImages, offset); // Number of images
  offset += 2;

  // Directory entries
  for (const { size, buffer, offset: dataOff } of imageData) {
    ico.writeUInt8(size === 256 ? 0 : size, offset); // Width (0 means 256)
    offset += 1;
    ico.writeUInt8(size === 256 ? 0 : size, offset); // Height (0 means 256)
    offset += 1;
    ico.writeUInt8(0, offset); // Color palette
    offset += 1;
    ico.writeUInt8(0, offset); // Reserved
    offset += 1;
    ico.writeUInt16LE(1, offset); // Color planes
    offset += 2;
    ico.writeUInt16LE(32, offset); // Bits per pixel
    offset += 2;
    ico.writeUInt32LE(buffer.length, offset); // Image size
    offset += 4;
    ico.writeUInt32LE(dataOff, offset); // Image offset
    offset += 4;
  }

  // Image data
  for (const { buffer } of imageData) {
    buffer.copy(ico, offset);
    offset += buffer.length;
  }

  return ico;
}

async function main() {
  console.log("Generating PWA icons from logo.svg...\n");

  // Generate standard icons
  for (const size of STANDARD_SIZES) {
    const name =
      size === 16 || size === 32
        ? `favicon-${size}x${size}.png`
        : `favicon-${size}x${size}.png`;
    await generateStandardIcon(size, name);
  }

  // Generate maskable icons
  for (const size of MASKABLE_SIZES) {
    await generateMaskableIcon(size, `favicon-${size}x${size}-maskable.png`);
  }

  // Generate Apple Touch Icon
  await generateStandardIcon(APPLE_TOUCH_SIZE, "apple-touch-icon.png");

  // Generate favicon.ico
  await generateFavicon();

  console.log("\nAll icons generated successfully!");
}

main().catch((err) => {
  console.error("Error generating icons:", err);
  process.exit(1);
});
