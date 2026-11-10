// The document schema. It is the single source of truth for what a
// PaperPad document can contain, and it doubles as the sanitizer: when HTML
// is opened or pasted, anything without a parse rule here (scripts, iframes,
// event handlers, links, images, inline styles) is dropped.

import { Schema, type Attrs, type MarkSpec, type NodeSpec, type ParseRule, type TagParseRule } from "prosemirror-model";
import { marks as basicMarks, nodes as basicNodes } from "prosemirror-schema-basic";
import { bulletList, listItem, orderedList } from "prosemirror-schema-list";
import {
  colorFromCss,
  COLORS,
  findColor,
  findFont,
  findHighlight,
  fontFromCss,
  HIGHLIGHTS,
  isSize,
  nearestSize,
} from "./palette.ts";

export const ALIGNS = ["left", "center", "right", "justify"] as const;
export type Align = (typeof ALIGNS)[number];
export const MAX_INDENT = 8;

// ---- block attributes (alignment and indent) --------------------------------

function classValue(dom: HTMLElement, prefix: string): string | undefined {
  for (const c of Array.from(dom.classList)) if (c.startsWith(prefix)) return c.slice(prefix.length);
  return undefined;
}

function readBlockAttrs(dom: HTMLElement): { align: Align; indent: number } {
  const raw = classValue(dom, "al-") ?? dom.style?.textAlign ?? "";
  const align = (ALIGNS as readonly string[]).includes(raw) ? (raw as Align) : "left";
  const n = Number(classValue(dom, "ind-") ?? 0);
  const indent = Number.isInteger(n) ? Math.min(MAX_INDENT, Math.max(0, n)) : 0;
  return { align, indent };
}

function blockClass(attrs: Attrs): { class?: string } {
  const parts: string[] = [];
  if (attrs.align && attrs.align !== "left") parts.push(`al-${attrs.align}`);
  if (attrs.indent) parts.push(`ind-${attrs.indent}`);
  return parts.length ? { class: parts.join(" ") } : {};
}

const blockAttrs = { align: { default: "left" }, indent: { default: 0 } };

const paragraph: NodeSpec = {
  attrs: blockAttrs,
  content: "inline*",
  group: "block",
  parseDOM: [{ tag: "p", getAttrs: (dom) => readBlockAttrs(dom as HTMLElement) }],
  toDOM: (node) => ["p", blockClass(node.attrs), 0],
};

const heading: NodeSpec = {
  attrs: { ...blockAttrs, level: { default: 1 } },
  content: "inline*",
  group: "block",
  defining: true,
  parseDOM: [1, 2, 3, 4, 5, 6].map(
    (level): TagParseRule => ({
      tag: `h${level}`,
      getAttrs: (dom) => ({ ...readBlockAttrs(dom as HTMLElement), level: Math.min(level, 3) }),
    }),
  ),
  toDOM: (node) => [`h${node.attrs.level}`, blockClass(node.attrs), 0],
};

const { doc, text, blockquote, horizontal_rule, code_block, hard_break } = basicNodes;

// ---- marks -------------------------------------------------------------------

const underline: MarkSpec = {
  parseDOM: [
    { tag: "u" },
    { style: "text-decoration", getAttrs: (v) => (/\bunderline\b/.test(v) ? null : false) },
    { style: "text-decoration-line", getAttrs: (v) => (/\bunderline\b/.test(v) ? null : false) },
  ],
  toDOM: () => ["u", 0],
};

const strike: MarkSpec = {
  parseDOM: [
    { tag: "s" },
    { tag: "del" },
    { tag: "strike" },
    { style: "text-decoration", getAttrs: (v) => (/\bline-through\b/.test(v) ? null : false) },
    { style: "text-decoration-line", getAttrs: (v) => (/\bline-through\b/.test(v) ? null : false) },
  ],
  toDOM: () => ["s", 0],
};

/** A mark whose only attribute is a key from one of the palette lists. */
function keyedMark(prefix: string, valid: (key: string) => boolean, fromStyle?: { prop: string; map: (v: string) => string | undefined }): MarkSpec {
  const rules: ParseRule[] = [
    {
      tag: `span[class*="${prefix}"]`,
      consuming: false,
      getAttrs: (dom) => {
        const key = classValue(dom as HTMLElement, prefix);
        return key !== undefined && valid(key) ? { key } : false;
      },
    },
  ];
  if (fromStyle) {
    rules.push({
      style: fromStyle.prop,
      getAttrs: (v: string) => {
        const key = fromStyle.map(v);
        return key ? { key } : false;
      },
    });
  }
  return {
    attrs: { key: {} },
    parseDOM: rules,
    toDOM: (mark) => ["span", { class: `${prefix}${mark.attrs.key}` }, 0],
  };
}

function cssSizeToPt(v: string): number | undefined {
  const m = /^([\d.]+)(pt|px)$/.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === "px" ? n * 0.75 : n;
}

const font = keyedMark("ff-", (k) => !!findFont(k), { prop: "font-family", map: (v) => fontFromCss(v)?.key });
const size = keyedMark("fs-", (k) => isSize(Number(k)), {
  prop: "font-size",
  map: (v) => {
    const pt = cssSizeToPt(v);
    return pt ? String(nearestSize(pt)) : undefined;
  },
});
const color = keyedMark("c-", (k) => !!findColor(k), { prop: "color", map: (v) => colorFromCss(v, COLORS)?.key });
const highlight: MarkSpec = {
  ...keyedMark("hl-", (k) => !!findHighlight(k), {
    prop: "background-color",
    map: (v) => colorFromCss(v, HIGHLIGHTS)?.key,
  }),
};
highlight.parseDOM = [...(highlight.parseDOM ?? []), { tag: "mark", getAttrs: () => ({ key: "yellow" }) }];

export const schema = new Schema({
  nodes: {
    // pageNumbers: print and export add a page number at the bottom of each page.
    doc: { ...doc, attrs: { pageNumbers: { default: false } } },
    paragraph,
    heading,
    blockquote,
    horizontal_rule,
    code_block,
    text,
    hard_break,
    ordered_list: { ...orderedList, content: "list_item+", group: "block" },
    bullet_list: { ...bulletList, content: "list_item+", group: "block" },
    list_item: { ...listItem, content: "paragraph block*" },
  },
  // Order matters: it decides how marks nest when rendered.
  marks: {
    font,
    size,
    color,
    highlight,
    strong: basicMarks.strong,
    em: basicMarks.em,
    underline,
    strike,
    code: basicMarks.code,
  },
});

export type MarkName = keyof typeof schema.marks;
