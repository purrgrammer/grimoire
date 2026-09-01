import QRCode from "qrcode";
import { getEmojiMaskUrl, isValidAvatarShape } from "@/lib/avatar-shape";

/** Fraction of the QR's width the avatar occupies. */
const AVATAR_SCALE = 0.25;
/** White border around the avatar, in canvas pixels. */
const PLATE_PADDING = 4;

function loadImage(
  src: string,
  crossOrigin?: string,
): Promise<HTMLImageElement> {
  const image = new Image();
  if (crossOrigin) image.crossOrigin = crossOrigin;

  return new Promise((resolve) => {
    image.onload = () => resolve(image);
    // Callers check `naturalHeight`; a failed load resolves rather than throws
    // so a missing picture degrades to a plain QR.
    image.onerror = () => resolve(image);
    image.src = src;
  });
}

/**
 * Draw the picture into a square, cropping the long side instead of squashing
 * it — most avatars are not square, and scaling one to a square box stretches
 * the face.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  picture: HTMLImageElement,
  x: number,
  y: number,
  size: number,
) {
  const { naturalWidth: w, naturalHeight: h } = picture;
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;

  ctx.drawImage(picture, sx, sy, side, side, x, y, size, size);
}

/**
 * The avatar, cut to the silhouette the profile picked (NIP-0 `shape`), on a
 * white plate of the same silhouette. Returns false if the mask could not be
 * rendered, so the caller can fall back to a circle.
 */
function drawShaped(
  ctx: CanvasRenderingContext2D,
  picture: HTMLImageElement,
  mask: HTMLImageElement,
  x: number,
  y: number,
  size: number,
): boolean {
  if (!mask.complete || mask.naturalHeight === 0) return false;

  const plate = size + PLATE_PADDING * 2;
  ctx.drawImage(mask, x - PLATE_PADDING, y - PLATE_PADDING, plate, plate);

  // The picture is masked on its own canvas: `destination-in` against the QR
  // would erase the code everywhere the silhouette isn't.
  const cut = document.createElement("canvas");
  cut.width = size;
  cut.height = size;
  const cutCtx = cut.getContext("2d");
  if (!cutCtx) return false;

  drawCover(cutCtx, picture, 0, 0, size);
  cutCtx.globalCompositeOperation = "destination-in";
  cutCtx.drawImage(mask, 0, 0, size, size);

  ctx.drawImage(cut, x, y, size, size);
  return true;
}

/** The default: a circular cut-out on a circular white plate. */
function drawCircular(
  ctx: CanvasRenderingContext2D,
  picture: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  cx: number,
  cy: number,
) {
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + PLATE_PADDING, 0, 2 * Math.PI);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, 2 * Math.PI);
  ctx.clip();
  drawCover(ctx, picture, x, y, size);
  ctx.restore();
}

/**
 * A QR code with the recipient's picture punched into the middle, cut to the
 * avatar shape their profile declares (falling back to a circle).
 *
 * The overlay eats about a quarter of the symbol, so the code is generated at
 * error-correction level H — anything lower stops scanning once the picture
 * lands on it. If the picture will not load (or the canvas is unavailable),
 * the plain QR is returned rather than nothing.
 */
export async function generateQrWithAvatar(
  text: string,
  pictureUrl?: string,
  shape?: string,
): Promise<string> {
  const qrDataUrl = await QRCode.toDataURL(text, {
    width: 300,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#000000", light: "#FFFFFF" },
  });

  if (!pictureUrl) return qrDataUrl;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return qrDataUrl;

  const qrImage = new Image();
  await new Promise((resolve, reject) => {
    qrImage.onload = resolve;
    qrImage.onerror = reject;
    qrImage.src = qrDataUrl;
  });

  canvas.width = qrImage.width;
  canvas.height = qrImage.height;
  ctx.drawImage(qrImage, 0, 0);

  const picture = await loadImage(pictureUrl, "anonymous");
  if (!picture.complete || picture.naturalHeight === 0) return qrDataUrl;

  const size = canvas.width * AVATAR_SCALE;
  const x = (canvas.width - size) / 2;
  const y = (canvas.height - size) / 2;

  const maskUrl = isValidAvatarShape(shape) ? getEmojiMaskUrl(shape) : "";
  const mask = maskUrl ? await loadImage(maskUrl) : null;

  if (!mask || !drawShaped(ctx, picture, mask, x, y, size)) {
    drawCircular(ctx, picture, x, y, size, canvas.width / 2, canvas.height / 2);
  }

  return canvas.toDataURL();
}
