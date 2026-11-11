import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { deleteRuleBefore, insertImage, selectedImage, setAlign, setImage } from "../src/editor/commands.ts";
import { cleanAlt, displaySize, EXPORT_COLUMN, IMAGE_SIZES, imageAttrs, imageDims, parseDataUrl, sniffImage } from "../src/editor/image.ts";
import { schema } from "../src/editor/schema.ts";
import { newState } from "../src/editor/setup.ts";
import { toDocxParts } from "../src/export/docx.ts";
import { toMarkdown } from "../src/export/markdown.ts";
import { toRtf } from "../src/export/rtf.ts";
import { toPlainText } from "../src/export/text.ts";

const N = schema.nodes;
const p = (text: string) => N.paragraph.create(null, text ? schema.text(text) : undefined);

/** A PNG header for a w x h image (enough for imageDims, not a full file). */
function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

/** A JPEG start: SOI, an APP0 segment, then a baseline start of frame for w x h. */
function jpegHeader(w: number, h: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0, 16, ...new Array(14).fill(0)];
  const sof = [0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, ...new Array(9).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const pngSrc = (w: number, h: number) => `data:image/png;base64,${b64(pngHeader(w, h))}`;
const image = (w: number, h: number, extra: Record<string, unknown> = {}) => N.image.create({ ...imageAttrs(pngSrc(w, h), "", null, null), ...extra });

test("image types are recognized by their first bytes", () => {
  assert.equal(sniffImage(pngHeader(1, 1)), "image/png");
  assert.equal(sniffImage(jpegHeader(1, 1)), "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a")), "image/gif");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF....WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns")), null);
});

test("the size is read from PNG and JPEG headers", () => {
  assert.deepEqual(imageDims(pngHeader(640, 480), "image/png"), { width: 640, height: 480 });
  assert.deepEqual(imageDims(jpegHeader(1200, 900), "image/jpeg"), { width: 1200, height: 900 });
  assert.equal(imageDims(pngHeader(0, 10), "image/png"), null, "empty images are refused");
  assert.equal(imageDims(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0]), "image/jpeg"), null);
});

test("only PNG and JPEG data URLs are accepted as image sources", () => {
  assert.ok(parseDataUrl(pngSrc(1, 1)));
  for (const bad of ["https://example.com/a.png", "file:///C:/a.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/webp;base64,UklGRg==", "data:image/png;base64,abc", 'data:image/png;base64,AAAA" onerror="x', null]) {
    assert.equal(parseDataUrl(bad), null, String(bad));
  }
});

test("image attributes are checked and the size comes from the data", () => {
  const a = imageAttrs(pngSrc(300, 200), "A  cat\n", "medium", "right")!;
  assert.deepEqual([a.width, a.height, a.alt, a.size, a.align], [300, 200, "A  cat", "medium", "right"]);
  const d = imageAttrs(pngSrc(300, 200), 42, "huge", "justify")!;
  assert.deepEqual([d.alt, d.size, d.align], ["", "original", "center"], "unknown values fall back to the defaults");
  assert.equal(imageAttrs("https://example.com/a.png", "", null, null), null);
  assert.equal(cleanAlt("x".repeat(900)).length, 500);
});

test("display sizes keep the aspect ratio and stay inside the column and the page", () => {
  assert.deepEqual(displaySize({ width: 100, height: 50, size: "original" }, 600, 900), { w: 100, h: 50 }, "small images keep their size");
  assert.deepEqual(displaySize({ width: 1200, height: 600, size: "original" }, 600, 900), { w: 600, h: 300 });
  assert.deepEqual(displaySize({ width: 100, height: 50, size: "medium" }, 600, 900), { w: 300, h: 150 });
  assert.deepEqual(displaySize({ width: 100, height: 400, size: "full" }, 600, 900), { w: 225, h: 900 }, "a tall image fits one page");
});

test("every image size has a CSS class", () => {
  const css = readFileSync(new URL("../src/styles/main.css", import.meta.url), "utf8");
  const missing = IMAGE_SIZES.filter((s) => s.pct !== null && !new RegExp(`\\.doc figure\\.img-${s.key} img \\{\\s*width: ${s.pct}%;`).test(css));
  assert.deepEqual(missing.map((s) => s.key), []);
});

test("an image added in an empty paragraph goes before it, with the caret below", () => {
  let state = newState(N.doc.create(null, [p("a"), p("")]));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
  insertImage(imageAttrs(pngSrc(10, 10), "", null, null)!)(state, (tr) => (state = state.apply(tr)));
  assert.deepEqual(state.doc.content.content.map((n) => n.type.name), ["paragraph", "image", "paragraph"]);
  assert.equal(state.selection.$from.parent.type.name, "paragraph");
  assert.equal(state.selection.from, state.doc.content.size - 1);
});

test("an image added inside a paragraph splits it, and one at the end gets a paragraph after it", () => {
  let state = newState(N.doc.create(null, [p("abcd")]));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
  insertImage(imageAttrs(pngSrc(10, 10), "", null, null)!)(state, (tr) => (state = state.apply(tr)));
  assert.deepEqual(state.doc.content.content.map((n) => n.textContent || n.type.name), ["ab", "image", "cd"]);
  assert.equal(state.selection.from, state.doc.content.size - 3, "caret at the start of cd");

  state = newState(N.doc.create(null, [p("ab")]));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
  insertImage(imageAttrs(pngSrc(10, 10), "", null, null)!)(state, (tr) => (state = state.apply(tr)));
  assert.deepEqual(state.doc.content.content.map((n) => n.type.name), ["paragraph", "image", "paragraph"]);
});

test("backspace after an image at the end of the document removes it", () => {
  let state = newState(N.doc.create(null, [p("a"), image(10, 10)]));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
  assert.ok(deleteRuleBefore(state, (tr) => (state = state.apply(tr))));
  assert.deepEqual(state.doc.content.content.map((n) => n.type.name), ["paragraph", "paragraph"]);
});

test("a selected image changes size, alignment and text and stays selected", () => {
  let state = newState(N.doc.create(null, [p("a"), image(10, 10), p("b")]));
  const pos = state.doc.child(0).nodeSize;
  assert.equal(setImage({ size: "small" })(state), false, "nothing selected");
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  for (const cmd of [setImage({ size: "small" }), setImage({ alt: "A cat" }), setAlign("right")]) assert.ok(cmd(state, (tr) => (state = state.apply(tr))));
  assert.equal(setAlign("justify")(state), false, "images are not justified");
  const img = selectedImage(state)!;
  assert.deepEqual([img.attrs.size, img.attrs.alt, img.attrs.align], ["small", "A cat", "right"]);
});

test("exports show images: embedded in Word and RTF, as their text in Markdown and plain text", () => {
  const doc = N.doc.create(null, [p("Look:"), image(1200, 600, { alt: "A *cat*", align: "center" }), image(1200, 600), p("End")]);
  assert.match(toMarkdown(doc), /^\\\[Image: A \\\*cat\\\*\\\]$/m);
  assert.match(toMarkdown(doc), /^\\\[Image\\\]$/m);
  assert.match(toPlainText(doc), /^\[Image: A \*cat\*\]$/m);

  const rtf = toRtf(doc);
  // Original size, 1200 px wide, is scaled to the column: 9026 twips.
  assert.match(rtf, /\\qc\\li0 \{\\pict\\pngblip\\picw1200\\pich600\\picwgoal9026\\pichgoal4513\n89504e47/);

  const parts = toDocxParts(doc, "t");
  const part = (name: string) => parts.find((x) => x.name === name)!;
  const media = parts.filter((x) => x.base64);
  assert.deepEqual(media.map((m) => m.name), ["word/media/image1.png"], "the same image is stored once");
  assert.equal(media[0]!.content, b64(pngHeader(1200, 600)));
  const xml = part("word/document.xml").content;
  assert.equal(xml.match(/<w:drawing>/g)?.length, 2);
  assert.match(xml, /xmlns:wp=/);
  assert.match(xml, new RegExp(`<wp:extent cx="${Math.round(EXPORT_COLUMN.w * 9525)}" cy="${Math.round((EXPORT_COLUMN.w / 2) * 9525)}"/>`));
  assert.match(xml, /descr="A \*cat\*"/);
  assert.match(xml, /r:embed="rIdImg1"/);
  assert.match(part("[Content_Types].xml").content, /<Default Extension="png" ContentType="image\/png"\/>/);
  assert.match(part("word/_rels/document.xml.rels").content, /Id="rIdImg1"[^>]*Target="media\/image1\.png"/);
});

test("an image with text around floats in Word beside the next paragraph", () => {
  const doc = N.doc.create(null, [image(1200, 600, { align: "wrap-right", size: "full" }), p("Beside"), p("")]);
  const xml = toDocxParts(doc, "t").find((x) => x.name === "word/document.xml")!.content;
  assert.match(xml, /<w:p><w:r><w:drawing><wp:anchor [^>]*><wp:simplePos x="0" y="0"\/><wp:positionH relativeFrom="column"><wp:align>right<\/wp:align>/);
  assert.match(xml, /<wp:wrapSquare wrapText="bothSides"\/>/);
  assert.match(xml, /<\/wp:anchor><\/w:drawing><\/w:r><w:r><w:t xml:space="preserve">Beside</, "anchored in the paragraph it floats beside");
  // Page width is capped at 60% of the column when text goes around.
  assert.match(xml, new RegExp(`<wp:extent cx="${Math.round(EXPORT_COLUMN.w * 0.6 * 9525)}"`));
  assert.match(toRtf(doc), /\\qr\\li0 \{\\pict/, "RTF aligns it to its side");
});

test("Word image parts are named the way the Rust export command allows", () => {
  const rust = readFileSync(new URL("../src-tauri/src/commands.rs", import.meta.url), "utf8");
  assert.match(rust, /strip_prefix\("word\/media\/image"\)/);
  assert.match(rust, /matches!\(ext, "png" \| "jpeg"\)/);
  const jpeg = N.image.create({ ...imageAttrs(`data:image/jpeg;base64,${b64(jpegHeader(8, 8))}`, "", null, null) });
  const names = toDocxParts(N.doc.create(null, [image(4, 4), jpeg, p("")]), "t").filter((x) => x.base64).map((x) => x.name);
  assert.deepEqual(names, ["word/media/image1.png", "word/media/image2.jpeg"]);
});
