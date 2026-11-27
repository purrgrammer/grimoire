#!/usr/bin/env node
/**
 * Generate the Android launcher, adaptive, themed (monochrome) and splash
 * resources from the Grimoire logo — the same `public/logo.svg` the PWA icons
 * come from, on the app's own background colour. No new artwork.
 *
 * Usage: node scripts/generate-android-icons.mjs
 * Requires sharp (already a dependency of the PWA icon script).
 *
 * Writes into android/app/src/main/res. The output is committed: these are
 * app resources, not build products, and the APK must not depend on a tool
 * run at build time to have an icon.
 */

import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RES = join(ROOT, "android/app/src/main/res");
const LOGO = readFileSync(join(ROOT, "public/logo.svg"));

/** `--background` of the default dark theme; also the manifest's colour. */
export const BACKGROUND = "#020817";
const BG = { r: 2, g: 8, b: 23, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const ASPECT = 122 / 160; // logo.svg viewBox

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

function out(dir, name, buffer) {
  mkdirSync(join(RES, dir), { recursive: true });
  writeFileSync(join(RES, dir, name), buffer);
}

/** The logo, `height` px tall, centred on a `w`x`h` canvas. */
/**
 * Where the logo's visual weight sits, relative to its own box.
 *
 * The mark is a heavy hexagonal G with a light star at its lower right, so
 * its bounding box is centred while its mass is not: centring the box left
 * the G visibly to the left inside the launcher's circle (measured: the
 * alpha-weighted centroid sat 3.1% left and 1% low of the canvas centre).
 * Placing the centroid on the centre is what reads as centred.
 */
async function massOffset(png, width, height) {
  const { data } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      sx += x * a;
      sy += y * a;
      sw += a;
    }
  }
  // How far to move the logo so its centroid lands where its box centre was.
  return { dx: width / 2 - sx / sw, dy: height / 2 - sy / sw };
}

/** The logo, `height` px tall, optically centred on a `w`x`h` canvas. */
async function logoOn(w, h, height, background, { monochrome = false } = {}) {
  const width = Math.round(height * ASPECT);
  let logoPng = await sharp(LOGO)
    .resize(width, height, { fit: "contain", background: CLEAR })
    .png()
    .toBuffer();
  const { dx, dy } = await massOffset(logoPng, width, height);
  if (monochrome) {
    // Themed icons (Android 13+): the launcher tints the alpha mask, so the
    // layer is the logo's silhouette in white.
    const alpha = await sharp(logoPng).extractChannel("alpha").png().toBuffer();
    logoPng = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .joinChannel(alpha)
      .png()
      .toBuffer();
  }
  return sharp({
    create: { width: w, height: h, channels: 4, background },
  })
    .composite([
      {
        input: logoPng,
        left: Math.round((w - width) / 2 + dx),
        top: Math.round((h - height) / 2 + dy),
      },
    ])
    .png()
    .toBuffer();
}

async function circleMask(size) {
  const r = size / 2;
  return Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`,
  );
}

async function main() {
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const dir = `mipmap-${density}`;

    // Legacy (pre-API 26) square icon: 48dp, logo ~70% tall.
    const legacy = Math.round(48 * scale);
    out(
      dir,
      "ic_launcher.png",
      await logoOn(legacy, legacy, Math.round(legacy * 0.64), BG),
    );

    // Legacy round icon: same art clipped to a circle.
    const round = await sharp(
      await logoOn(legacy, legacy, Math.round(legacy * 0.58), BG),
    )
      .composite([{ input: await circleMask(legacy), blend: "dest-in" }])
      .png()
      .toBuffer();
    out(dir, "ic_launcher_round.png", round);

    // Adaptive foreground: 108dp canvas; launchers mask to a 66dp safe
    // zone; the logo is 52dp tall, centred by its visual mass.
    const adaptive = Math.round(108 * scale);
    out(
      dir,
      "ic_launcher_foreground.png",
      await logoOn(adaptive, adaptive, Math.round(52 * scale), CLEAR),
    );
    out(
      dir,
      "ic_launcher_monochrome.png",
      await logoOn(adaptive, adaptive, Math.round(52 * scale), CLEAR, {
        monochrome: true,
      }),
    );

    // Android 12+ splash icon: 288dp canvas, shown inside a 192dp circle.
    const splashIcon = Math.round(288 * scale);
    out(
      `drawable-${density}`,
      "splash_icon.png",
      await logoOn(splashIcon, splashIcon, Math.round(120 * scale), CLEAR),
    );

    // Pre-12 splash (window background), portrait and landscape.
    const [pw, ph] = [Math.round(320 * scale), Math.round(480 * scale)];
    out(
      `drawable-port-${density}`,
      "splash.png",
      await logoOn(pw, ph, Math.round(pw * 0.4), BG),
    );
    out(
      `drawable-land-${density}`,
      "splash.png",
      await logoOn(ph, pw, Math.round(pw * 0.4), BG),
    );
  }
  out("drawable", "splash.png", await logoOn(480, 320, 128, BG));

  console.log(`Android icons written to ${RES}`);
}

await main();
