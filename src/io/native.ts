// PaperPad's native format: a small, standalone HTML file.
//
// Why HTML: it is human readable, opens in any browser forever, diffs well
// in git, and round-trips losslessly through the schema. The body only ever
// contains elements the schema produces; on open, the schema's parser drops
// everything else, so a hostile .html file cannot inject script or styles.

import { DOMParser as PMDOMParser, DOMSerializer, type Node as PMNode } from "prosemirror-model";
import { COLORS, docFont, FONTS, HIGHLIGHTS, SIZES } from "../editor/palette.ts";
import { MAX_INDENT, schema } from "../editor/schema.ts";
import { exportColor, normalizeStyles, type ResolvedStyle, resolveStyles } from "../editor/styles.ts";
import { toPlainText } from "../export/text.ts";

export type EditableFormat = "html" | "md" | "txt";

const VERSION = "0.1.0";

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Prints a page number in the bottom margin. Used by saved files and by the app's own print. */
export const PAGE_NUMBER_CSS = "@page{@bottom-center{content:counter(page);font:9pt Arial,sans-serif;color:#555}}";

/** CSS declarations for one paragraph style. `auto` is the color used for the text color. */
function styleCss(st: ResolvedStyle, auto = "inherit"): string {
  return (
    `font-family:${st.font.stack};font-size:${st.size}pt;line-height:${st.lineHeight};` +
    `font-weight:${st.bold ? 700 : 400};font-style:${st.italic ? "italic" : "normal"};color:${exportColor(st.color) ?? auto}`
  );
}

/** Stylesheet embedded in saved files so they look right in a browser. */
function standaloneCss(doc: PMNode): string {
  const st = resolveStyles(doc.attrs);
  const a = "article.paperpad";
  const rules = [
    `body{margin:0;background:#f4f1ea}`,
    `${a}{box-sizing:border-box;max-width:21cm;margin:2rem auto;padding:2.5cm;background:#fff;${styleCss(st.normal, "#1a1a1a")};white-space:pre-wrap;tab-size:4}`,
    `${a} p{margin:${st.normal.before}pt 0 ${st.normal.after}pt}`,
    `${a} li>p{margin:0 0 .2em}`,
    ...([1, 2, 3] as const).map((l) => `${a} h${l}{${styleCss(st[`h${l}`])};margin:${st[`h${l}`].before}pt 0 ${st[`h${l}`].after}pt}`),
    `${a} blockquote{${styleCss(st.quote)};margin:${st.quote.before}pt 0 0;padding-left:1em;border-left:3px solid #999}`,
    `${a} blockquote p{margin:0 0 ${st.quote.after}pt}`,
    `${a} pre{${styleCss(st.code)};margin:${st.code.before}pt 0 ${st.code.after}pt;background:#f2f2f2;padding:.5em}`,
    `${a}>:first-child{margin-top:0}`,
    `.al-center{text-align:center}.al-right{text-align:right}.al-justify{text-align:justify}`,
    ...Array.from({ length: MAX_INDENT }, (_, i) => `.ind-${i + 1}{margin-left:${(i + 1) * 0.5}in}`),
    ...FONTS.map((f) => `.ff-${f.key}{font-family:${f.stack}}`),
    ...SIZES.map((s) => `.fs-${s}{font-size:${s}pt}`),
    ...COLORS.map((c) => `.c-${c.key}{color:${c.hex}}`),
    ...HIGHLIGHTS.map((c) => `.hl-${c.key}{background:${c.hex};color:#1a1a1a}`),
  ];
  if (doc.attrs.pageNumbers) rules.push(PAGE_NUMBER_CSS);
  return rules.join("\n");
}

export function serializeHtml(doc: PMNode, title: string): string {
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
  const holder = document.createElement("div");
  holder.appendChild(fragment);
  const pageNumbers = !!doc.attrs.pageNumbers;
  const font = docFont(doc.attrs.font);
  const styles = doc.attrs.styles ? ` data-styles="${escapeHtml(JSON.stringify(doc.attrs.styles))}"` : "";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta name="generator" content="PaperPad ${VERSION}">`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${standaloneCss(doc)}\n</style>`,
    "</head>",
    "<body>",
    `<article class="paperpad" data-font="${font.key}"${styles}${pageNumbers ? ' data-page-numbers="on"' : ""}>${holder.innerHTML}</article>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * `font` is the default font for HTML that is not ours. Our own files name
 * theirs, and files from before the font setting were always Arial.
 */
export function parseHtml(html: string, font: string): PMNode {
  // DOMParser builds an inert document: no scripts run, nothing loads.
  const dom = new DOMParser().parseFromString(html, "text/html");
  const ours = dom.querySelector("article.paperpad");
  // Our own files keep tabs and repeated spaces; foreign HTML is normalized.
  const doc = PMDOMParser.fromSchema(schema).parse(ours ?? dom.body, { preserveWhitespace: ours ? true : undefined });
  // The page number, font and style settings are document attributes, stored on the article element.
  const pageNumbers = ours?.getAttribute("data-page-numbers") === "on";
  const key = docFont(ours ? ours.getAttribute("data-font") : font).key;
  return doc.type.create({ pageNumbers, font: key, styles: readStyles(ours?.getAttribute("data-styles")) }, doc.content);
}

/** The styles stored on our article element, validated. */
function readStyles(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    return normalizeStyles(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parsePlainText(text: string, font: string): PMNode {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return schema.node(
    "doc",
    { font: docFont(font).key },
    lines.map((l) => schema.node("paragraph", null, l ? [schema.text(l)] : [])),
  );
}

// The Markdown module (with markdown-it) is loaded only when first needed,
// which keeps startup fast for the common case.
const markdown = () => import("../export/markdown.ts");

/** `font` is the default font for files that do not name one (see parseHtml). */
export async function parseDocument(content: string, format: EditableFormat, font: string): Promise<PMNode> {
  switch (format) {
    case "html":
      return parseHtml(content, font);
    case "md": {
      const doc = (await markdown()).fromMarkdown(content);
      return doc.type.create({ ...doc.attrs, font: docFont(font).key }, doc.content);
    }
    case "txt":
      return parsePlainText(content, font);
  }
}

export async function serializeDocument(doc: PMNode, format: EditableFormat, title: string): Promise<string> {
  switch (format) {
    case "html":
      return serializeHtml(doc, title);
    case "md":
      return (await markdown()).toMarkdown(doc);
    case "txt":
      return toPlainText(doc);
  }
}
