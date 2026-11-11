// Rich Text Format export, written by hand (RTF 1.5 subset).
// RTF is the native format of the original WordPad and opens in Word,
// LibreOffice, TextEdit and WordPad itself.
//
// Spec: Microsoft "Rich Text Format (RTF) Specification, version 1.9.1".

import type { Mark, Node as PMNode } from "prosemirror-model";
import { base64ToBytes, displaySize, EXPORT_COLUMN, parseDataUrl } from "../editor/image.ts";
import { COLORS, docFont, FONTS, HIGHLIGHTS } from "../editor/palette.ts";
import { colorKey, type ResolvedStyle, resolveStyles, type StyleId } from "../editor/styles.ts";

const TWIPS_PER_INDENT = 720; // half an inch

/** Escapes text for RTF. Non-ASCII becomes \uN? with a "?" fallback. */
export function rtfEscape(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const code = text.charCodeAt(i); // UTF-16 code unit; RTF wants these, surrogates included
    if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
    else if (ch === "\t") out += "\\tab ";
    else if (ch === "\n") out += "\\line ";
    else if (code < 0x20) continue;
    else if (code < 0x80) out += ch;
    else out += `\\u${code > 0x7fff ? code - 0x10000 : code}?`;
  }
  return out;
}

function hexToRtf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `\\red${(n >> 16) & 255}\\green${(n >> 8) & 255}\\blue${n & 255};`;
}

// Color table: index 0 is "auto", then text colors, then highlights.
const colorIndex = new Map<string, number>();
COLORS.forEach((c, i) => colorIndex.set("c:" + c.key, i + 1));
HIGHLIGHTS.forEach((c, i) => colorIndex.set("h:" + c.key, COLORS.length + i + 1));
const fontIndex = new Map(FONTS.map((f, i) => [f.key, i]));

/** The document's default font and paragraph styles, set by toRtf before anything is written. */
let docFontKey = FONTS[0]!.key;
let styles = resolveStyles({});

function header(pageNumbers: boolean): string {
  const fonts = FONTS.map((f, i) => `{\\f${i}\\f${f.rtfFamily}\\fcharset0 ${f.name};}`).join("");
  const colors = ";" + [...COLORS, ...HIGHLIGHTS].map((c) => hexToRtf(c.hex)).join("");
  // A footer group with the current page number, centered and small.
  const footer = pageNumbers ? "{\\footer\\pard\\qc\\fs18 \\chpgn\\par}" : "";
  return `{\\rtf1\\ansi\\ansicpg1252\\deff${fontIndex.get(docFontKey) ?? 0}\\uc1{\\fonttbl${fonts}}{\\colortbl${colors}}\\viewkind4\\paperw11906\\paperh16838\\margl1440\\margr1440\\margt1440\\margb1440\n${footer}`;
}

/** Character controls for a run: its paragraph style first, then its marks. */
function runControls(marks: readonly Mark[], base: ResolvedStyle): string {
  let font = base.font.key;
  let size = base.size;
  const color = colorKey(base.color);
  let c = (base.bold ? "\\b" : "") + (base.italic ? "\\i" : "") + (color ? `\\cf${colorIndex.get("c:" + color) ?? 0}` : "");
  for (const m of marks) {
    switch (m.type.name) {
      case "strong": c += "\\b"; break;
      case "em": c += "\\i"; break;
      case "underline": c += "\\ul"; break;
      case "strike": c += "\\strike"; break;
      case "code": font = "courier"; break;
      case "font": font = m.attrs.key; break;
      case "size": size = Number(m.attrs.key); break;
      case "color": c += `\\cf${colorIndex.get("c:" + m.attrs.key) ?? 0}`; break;
      case "highlight": c += `\\highlight${colorIndex.get("h:" + m.attrs.key) ?? 0}`; break;
    }
  }
  return `\\f${fontIndex.get(font) ?? 0}\\fs${size * 2}${c}`;
}

function inline(block: PMNode, base: ResolvedStyle): string {
  let out = "";
  block.forEach((child) => {
    if (child.isText) out += `{${runControls(child.marks, base)} ${rtfEscape(child.text!)}}`;
    else if (child.type.name === "hard_break") out += "\\line ";
  });
  return out;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** An embedded PNG or JPEG picture, as hex in lines of 128 characters. */
function picture(node: PMNode): string {
  const data = parseDataUrl(node.attrs.src);
  if (!data) return "";
  const bytes = base64ToBytes(data.base64);
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 64) {
    let line = "";
    for (const b of bytes.subarray(i, i + 64)) line += HEX[b];
    lines.push(line);
  }
  const { w, h } = displaySize(node.attrs as { width: number; height: number; size: string }, EXPORT_COLUMN.w, EXPORT_COLUMN.h);
  const blip = data.mime === "image/png" ? "\\pngblip" : "\\jpegblip";
  return `{\\pict${blip}\\picw${node.attrs.width}\\pich${node.attrs.height}\\picwgoal${Math.round(w * 15)}\\pichgoal${Math.round(h * 15)}\n${lines.join("\n")}}`;
}

// RTF has no simple text wrapping: images with text around are aligned to their side.
const ALIGN: Record<string, string> = { left: "\\ql", center: "\\qc", right: "\\qr", justify: "\\qj", "wrap-left": "\\ql", "wrap-right": "\\qr" };

/** A paragraph with the spacing of its style (points become twips). */
function para(st: ResolvedStyle, controls: string, body: string): string {
  const spacing = `\\sb${st.before * 20}\\sa${st.after * 20}\\sl${Math.round(st.lineHeight * 240)}\\slmult1`;
  return `\\pard\\plain${spacing}${controls} ${body}\\par\n`;
}

/** The style of a text block. Headings keep theirs inside quotes. */
function styleOf(node: PMNode, quote: boolean): ResolvedStyle {
  const id: StyleId = node.type.name === "heading" ? (`h${node.attrs.level}` as StyleId) : quote ? "quote" : "normal";
  return styles[id];
}

function walk(node: PMNode, indent: number, out: string[], quote = false) {
  const name = node.type.name;
  if (name === "paragraph" || name === "heading") {
    const li = (indent + (node.attrs.indent as number)) * TWIPS_PER_INDENT;
    const st = styleOf(node, quote);
    const extra = name === "heading" ? "\\keepn" : "";
    out.push(para(st, `${ALIGN[node.attrs.align as string] ?? ""}\\li${li}${extra}`, inline(node, st)));
  } else if (name === "code_block") {
    out.push(para(styles.code, `\\li${indent * TWIPS_PER_INDENT}`, `{${runControls([], styles.code)} ${rtfEscape(node.textContent)}}`));
  } else if (name === "image") {
    out.push(`\\pard\\plain${ALIGN[node.attrs.align as string] ?? ""}\\li${indent * TWIPS_PER_INDENT} ${picture(node)}\\par\n`);
  } else if (name === "horizontal_rule") {
    out.push(`\\pard\\plain\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n`);
  } else if (name === "blockquote") {
    node.forEach((c) => walk(c, indent + 1, out, true));
  } else if (name === "bullet_list" || name === "ordered_list") {
    let n = name === "ordered_list" ? (node.attrs.order as number) : 0;
    node.forEach((item) => {
      const marker = n ? `${n++}.` : "\\u8226?";
      item.forEach((child, _o, i) => {
        if (child.isTextblock) {
          const li = (indent + 1) * TWIPS_PER_INDENT;
          const lead = i === 0 ? `${marker}\\tab ` : "";
          const fi = i === 0 ? "\\fi-360" : "";
          const st = styleOf(child, quote);
          out.push(para(st, `${fi}\\li${li}\\tx${li}`, lead + inline(child, st)));
        } else walk(child, indent + 1, out, quote);
      });
    });
  } else {
    node.forEach((c) => walk(c, indent, out, quote));
  }
}

export function toRtf(doc: PMNode): string {
  docFontKey = docFont(doc.attrs.font).key;
  styles = resolveStyles(doc.attrs);
  const out: string[] = [header(!!doc.attrs.pageNumbers)];
  doc.forEach((n) => walk(n, 0, out));
  out.push("}\n");
  return out.join("");
}
