// Turns a picked, pasted or dropped image file into what a document stores.
//
// Every image is decoded and drawn again on a canvas, which:
// - scales it down to MAX_IMAGE_SIDE, so photos do not bloat the document;
// - converts GIF, WebP and BMP to PNG or JPEG, the formats every exporter reads;
// - drops all metadata, such as the GPS position a phone writes into photos.
// Nothing here needs a URL the CSP forbids: the file becomes a data: URL,
// which img-src allows, and the canvas is never added to the page.

import { MAX_IMAGE_FILE, MAX_IMAGE_SIDE, sniffImage } from "../editor/image.ts";

export interface PreparedImage {
  src: string;
  width: number;
  height: number;
}

/** JPEG quality for photos. High enough that text in a photo stays sharp. */
const JPEG_QUALITY = 0.85;
/** Opaque PNGs larger than this are also tried as JPEG, and the smaller one is kept. */
const PNG_TRY_JPEG = 1024 * 1024;

const readDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("The file could not be read"));
    r.readAsDataURL(blob);
  });

async function decode(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    throw new Error("The image could not be decoded");
  }
  return img;
}

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  return false;
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (file.size > MAX_IMAGE_FILE) throw new Error("The image is larger than 32 MB");
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const type = sniffImage(head);
  if (!type) throw new Error("This is not a PNG, JPEG, GIF, WebP or BMP image");

  const img = await decode(await readDataUrl(new Blob([file], { type })));
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("The image could not be converted");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  let src: string;
  if (type === "image/jpeg") {
    src = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } else {
    // Screenshots and drawings stay PNG, sharp and with their transparency.
    src = canvas.toDataURL("image/png");
    if (src.length > PNG_TRY_JPEG && !hasTransparency(ctx, width, height)) {
      const jpeg = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      if (jpeg.length < src.length / 2) src = jpeg;
    }
  }
  // A canvas that failed to encode returns "data:,".
  if (!src.startsWith("data:image/png;base64,") && !src.startsWith("data:image/jpeg;base64,")) {
    throw new Error("The image could not be converted");
  }
  return { src, width, height };
}

/** Lets the user pick an image with the browser's file chooser (browser preview only). */
export function pickWithInput(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/bmp";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
