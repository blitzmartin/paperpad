// Images inside documents.
//
// An image is stored in the document itself as a base64 `data:` URL, so a
// saved file stays one standalone .html that any browser opens. Only PNG and
// JPEG are kept: every exporter (Word, RTF) and every browser reads them, and
// they cannot carry scripts. Anything else is converted when it is added
// (see ui/image-import.ts). Remote images are never accepted, so a document
// cannot load anything from the network.
//
// Pure functions only: the schema, the exporters and the tests share them.

export type ImageMime = "image/png" | "image/jpeg";

export interface ImageSizeDef {
  key: string;
  label: string;
  /** Width as a share of the text column, or null for the image's own size (never wider than the column). */
  pct: number | null;
}

/** The fixed set of image sizes. Each key has an `img-<key>` class in main.css. */
export const IMAGE_SIZES: readonly ImageSizeDef[] = [
  { key: "original", label: "Original size", pct: null },
  { key: "small", label: "Small", pct: 25 },
  { key: "medium", label: "Medium", pct: 50 },
  { key: "large", label: "Large", pct: 75 },
  { key: "full", label: "Page width", pct: 100 },
];
export const DEFAULT_IMAGE_SIZE = "original";
export const findImageSize = (key: unknown) => IMAGE_SIZES.find((s) => s.key === key);

/** wrap-left and wrap-right float the image to that side, with the text flowing around it. */
export const IMAGE_ALIGNS = ["left", "center", "right", "wrap-left", "wrap-right"] as const;
export type ImageAlign = (typeof IMAGE_ALIGNS)[number];
export const DEFAULT_IMAGE_ALIGN: ImageAlign = "center";
export const IMAGE_ALIGN_LABELS: Record<ImageAlign, string> = {
  left: "Left",
  center: "Center",
  right: "Right",
  "wrap-left": "Left, text around",
  "wrap-right": "Right, text around",
};
export const isWrapped = (align: unknown) => align === "wrap-left" || align === "wrap-right";
/** A wrapped image takes at most this share of the column, so there is room for the text beside it. */
export const WRAP_MAX = 0.6;

/** Longest side of an added image, in pixels. Enough for a sharp A4 print. */
export const MAX_IMAGE_SIDE = 2000;
/** Largest file that can be added, before it is scaled down (same as the Rust limit). */
export const MAX_IMAGE_FILE = 32 * 1024 * 1024;
/** Largest saved document, in characters (MAX_DOC_BYTES in src-tauri/src/commands.rs). */
export const MAX_DOC_CHARS = 32 * 1024 * 1024;
export const MAX_ALT = 500;

const DATA_URL = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;

/** The type and base64 payload of an image source we accept, or null. */
export function parseDataUrl(src: unknown): { mime: ImageMime; base64: string } | null {
  if (typeof src !== "string") return null;
  const m = DATA_URL.exec(src);
  return m && m[2]!.length % 4 === 0 ? { mime: m[1] as ImageMime, base64: m[2]! } : null;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The file type, from its first bytes. Covers what the webview can decode for us. */
export function sniffImage(b: Uint8Array): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp" | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x42, 0x4d)) return "image/bmp";
  return null;
}

/** Width and height in pixels, read from a PNG or JPEG header. */
export function imageDims(b: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
  const u16 = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u32 = (i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
  let width = 0;
  let height = 0;
  if (mime === "image/png") {
    // Signature (8), chunk length (4), "IHDR" (4), then width and height.
    if (b.length < 24 || b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
    width = u32(16);
    height = u32(20);
  } else {
    // Walk the segments to the first start of frame (SOF0 to SOF15, without DHT, JPG and DAC).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        height = u16(i + 5);
        width = u16(i + 7);
        break;
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      i += 2 + u16(i + 2);
    }
  }
  return validSide(width) && validSide(height) ? { width, height } : null;
}

const validSide = (n: number) => Number.isInteger(n) && n > 0 && n <= 30000;

/**
 * Checked image attributes from the parts of an <img> (and its figure), or
 * null when the source is not an image we accept. The size in pixels always
 * comes from the image data itself, never from the markup.
 */
export function imageAttrs(src: unknown, alt: unknown, size: unknown, align: unknown) {
  const data = parseDataUrl(src);
  if (!data) return null;
  // The header is near the start; a JPEG may put up to 64 KB of metadata first.
  const head = data.base64.slice(0, 96 * 1024);
  let dims: ReturnType<typeof imageDims> = null;
  try {
    dims = imageDims(base64ToBytes(head.slice(0, head.length - (head.length % 4))), data.mime);
  } catch {
    return null;
  }
  if (!dims) return null;
  return {
    src: src as string,
    alt: cleanAlt(alt),
    width: dims.width,
    height: dims.height,
    size: findImageSize(size)?.key ?? DEFAULT_IMAGE_SIZE,
    align: (IMAGE_ALIGNS as readonly unknown[]).includes(align) ? (align as ImageAlign) : DEFAULT_IMAGE_ALIGN,
  };
}

export const cleanAlt = (alt: unknown): string =>
  typeof alt === "string" ? alt.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, MAX_ALT) : "";

/**
 * The size an image is shown at in a text column of colW by colH (any unit
 * where one image pixel is one unit, such as CSS pixels). Keeps the aspect
 * ratio and never exceeds the column or a page.
 */
export function displaySize(attrs: { width: number; height: number; size: string; align?: string }, colW: number, colH: number): { w: number; h: number } {
  const pct = findImageSize(attrs.size)?.pct ?? null;
  let w = pct === null ? Math.min(attrs.width, colW) : (colW * pct) / 100;
  if (isWrapped(attrs.align)) w = Math.min(w, colW * WRAP_MAX);
  let h = (w * attrs.height) / attrs.width;
  if (h > colH) {
    w = (w * colH) / h;
    h = colH;
  }
  return { w, h };
}

/**
 * The text column of exported pages (Word and RTF: A4 with 2.54 cm margins),
 * in CSS pixels. Word measures in twips: 15 to a pixel.
 */
export const EXPORT_COLUMN = { w: (11906 - 2 * 1440) / 15, h: (16838 - 2 * 1440) / 15 };

/** Characters the images of a document add to its saved file. */
export function imageChars(doc: { descendants(f: (n: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void): void }): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === "image") n += String(node.attrs.src).length;
  });
  return n;
}

/** The text that stands in for an image in Markdown and plain text. */
export const imagePlaceholder = (alt: string) => (alt ? `[Image: ${alt}]` : "[Image]");
