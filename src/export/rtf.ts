// Rich Text Format export, written by hand (RTF 1.5 subset).
// RTF is the native format of the original WordPad and opens in Word,
// LibreOffice, TextEdit and WordPad itself.
//
// Spec: Microsoft "Rich Text Format (RTF) Specification, version 1.9.1".

import type { Mark, Node as PMNode } from "prosemirror-model";
import { COLORS, DEFAULT_FONT, DEFAULT_SIZE, FONTS, HEADING_SIZES, HIGHLIGHTS } from "../editor/palette.ts";

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

function header(pageNumbers: boolean): string {
  const fonts = FONTS.map((f, i) => `{\\f${i}\\f${f.rtfFamily}\\fcharset0 ${f.name};}`).join("");
  const colors = ";" + [...COLORS, ...HIGHLIGHTS].map((c) => hexToRtf(c.hex)).join("");
  // A footer group with the current page number, centered and small.
  const footer = pageNumbers ? "{\\footer\\pard\\qc\\fs18 \\chpgn\\par}" : "";
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl${fonts}}{\\colortbl${colors}}\\viewkind4\\paperw11906\\paperh16838\\margl1440\\margr1440\\margt1440\\margb1440\n${footer}`;
}

interface Base {
  bold?: boolean;
  size?: number;
  font?: string;
}

function runControls(marks: readonly Mark[], base: Base): string {
  let font = base.font ?? DEFAULT_FONT.key;
  let size = base.size ?? DEFAULT_SIZE;
  let c = base.bold ? "\\b" : "";
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

function inline(block: PMNode, base: Base): string {
  let out = "";
  block.forEach((child) => {
    if (child.isText) out += `{${runControls(child.marks, base)} ${rtfEscape(child.text!)}}`;
    else if (child.type.name === "hard_break") out += "\\line ";
  });
  return out;
}

const ALIGN: Record<string, string> = { left: "\\ql", center: "\\qc", right: "\\qr", justify: "\\qj" };

function para(controls: string, body: string): string {
  return `\\pard\\plain\\sa120${controls} ${body}\\par\n`;
}

function walk(node: PMNode, indent: number, out: string[]) {
  const name = node.type.name;
  if (name === "paragraph" || name === "heading") {
    const li = (indent + (node.attrs.indent as number)) * TWIPS_PER_INDENT;
    const base: Base = name === "heading" ? { bold: true, size: HEADING_SIZES[node.attrs.level as number] } : {};
    const extra = name === "heading" ? "\\keepn\\sb240" : "";
    out.push(para(`${ALIGN[node.attrs.align as string] ?? ""}\\li${li}${extra}`, inline(node, base)));
  } else if (name === "code_block") {
    out.push(para(`\\li${indent * TWIPS_PER_INDENT}`, `{\\f${fontIndex.get("courier")}\\fs20 ${rtfEscape(node.textContent)}}`));
  } else if (name === "horizontal_rule") {
    out.push(`\\pard\\plain\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n`);
  } else if (name === "blockquote") {
    node.forEach((c) => walk(c, indent + 1, out));
  } else if (name === "bullet_list" || name === "ordered_list") {
    let n = name === "ordered_list" ? (node.attrs.order as number) : 0;
    node.forEach((item) => {
      const marker = n ? `${n++}.` : "\\u8226?";
      item.forEach((child, _o, i) => {
        if (child.isTextblock) {
          const li = (indent + 1) * TWIPS_PER_INDENT;
          const lead = i === 0 ? `${marker}\\tab ` : "";
          const fi = i === 0 ? "\\fi-360" : "";
          out.push(para(`${fi}\\li${li}\\tx${li}`, lead + inline(child, {})));
        } else walk(child, indent + 1, out);
      });
    });
  } else {
    node.forEach((c) => walk(c, indent, out));
  }
}

export function toRtf(doc: PMNode): string {
  const out: string[] = [header(!!doc.attrs.pageNumbers)];
  doc.forEach((n) => walk(n, 0, out));
  out.push("}\n");
  return out.join("");
}
