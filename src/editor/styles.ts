// Paragraph styles: how each role (Normal, the headings, Quote and Code) looks.
// Pure data, no DOM.
//
// Styles belong to the document. Every new document starts from the fixed
// DEFAULT_STYLES below, with the user's default font as Normal's font. The
// doc node's `styles` attribute is null until the user changes a style; then
// it holds the full set, so the document keeps its look even if these
// defaults change in a later version.
//
// Like the formatting marks, every value is a key from a fixed list, never
// free CSS: a hostile file cannot inject styles, and exports know every value.

import { docFont, findColor, findFont, type FontDef, SIZES } from "./palette.ts";

export const STYLE_IDS = ["normal", "h1", "h2", "h3", "quote", "code"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export const STYLE_LABELS: Record<StyleId, string> = {
  normal: "Normal",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  quote: "Quote",
  code: "Code",
};

/** Font value meaning "the document's font", which is Normal's font. */
export const SAME_FONT = "same";
/** Color values besides the palette keys: the text color, and a softer gray. */
export const AUTO_COLOR = "auto";
export const SOFT_COLOR = "soft";

export const LINE_HEIGHTS: readonly number[] = [1, 1.15, 1.2, 1.4, 1.45, 1.5, 1.75, 2];
/** Space before and after a paragraph, in points. */
export const SPACINGS: readonly number[] = [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32];

export interface TextStyle {
  /** A font key, or SAME_FONT. Normal is always SAME_FONT: its font is the doc's font attribute. */
  font: string;
  /** Points, from SIZES. */
  size: number;
  /** A COLORS key, AUTO_COLOR or SOFT_COLOR. */
  color: string;
  bold: boolean;
  italic: boolean;
  lineHeight: number;
  before: number;
  after: number;
}

export type DocStyles = Record<StyleId, TextStyle>;

const base: TextStyle = { font: SAME_FONT, size: 12, color: AUTO_COLOR, bold: false, italic: false, lineHeight: 1.45, before: 0, after: 6 };
const heading = (size: number, before: number, after: number): TextStyle => ({ ...base, size, bold: true, lineHeight: 1.2, before, after });

/** The look of every new document, and of documents from before styles existed. */
export const DEFAULT_STYLES: DocStyles = {
  normal: base,
  h1: heading(24, 20, 8),
  h2: heading(18, 16, 6),
  h3: heading(14, 12, 4),
  quote: { ...base, color: SOFT_COLOR },
  code: { ...base, font: "courier", size: 10, lineHeight: 1.4 },
};

const isColor = (v: unknown) => v === AUTO_COLOR || v === SOFT_COLOR || !!findColor(v);

function normalizeStyle(raw: unknown, fallback: TextStyle, id: StyleId): TextStyle {
  const out = { ...fallback };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (id !== "normal" && (r.font === SAME_FONT || findFont(r.font))) out.font = r.font as string;
  if (typeof r.size === "number" && SIZES.includes(r.size)) out.size = r.size;
  if (isColor(r.color)) out.color = r.color as string;
  if (typeof r.bold === "boolean") out.bold = r.bold;
  if (typeof r.italic === "boolean") out.italic = r.italic;
  if (typeof r.lineHeight === "number" && LINE_HEIGHTS.includes(r.lineHeight)) out.lineHeight = r.lineHeight;
  if (typeof r.before === "number" && SPACINGS.includes(r.before)) out.before = r.before;
  if (typeof r.after === "number" && SPACINGS.includes(r.after)) out.after = r.after;
  return out;
}

/** Validates stored styles: unknown values fall back to the defaults. Null when there are none. */
export function normalizeStyles(raw: unknown): DocStyles | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return Object.fromEntries(STYLE_IDS.map((id) => [id, normalizeStyle(r[id], DEFAULT_STYLES[id], id)])) as DocStyles;
}

/** A style with its font resolved, ready to render or export. */
export interface ResolvedStyle extends Omit<TextStyle, "font"> {
  font: FontDef;
}

/** The styles of a document, from its doc node attributes (`font` and `styles`). */
export function resolveStyles(attrs: { font?: unknown; styles?: unknown }): Record<StyleId, ResolvedStyle> {
  const styles = normalizeStyles(attrs.styles) ?? DEFAULT_STYLES;
  const docFontDef = docFont(attrs.font);
  return Object.fromEntries(
    STYLE_IDS.map((id) => {
      const s = styles[id];
      return [id, { ...s, font: s.font === SAME_FONT ? docFontDef : (findFont(s.font) ?? docFontDef) }];
    }),
  ) as Record<StyleId, ResolvedStyle>;
}

/** The palette key saved files and exports use for a color (soft is gray); null for the text color. */
export const colorKey = (color: string): string | null => (color === SOFT_COLOR ? "gray" : findColor(color) ? color : null);

/** Hex color for saved files and exports, which are always on white paper; null for the text color. */
export const exportColor = (color: string): string | null => findColor(colorKey(color))?.hex ?? null;

/**
 * CSS custom properties that render a document's styles in the editor
 * (main.css reads them as --s-<style>-<property>). Set through the CSSOM,
 * which the CSP allows. The soft color follows the theme.
 */
export function styleVars(attrs: { font?: unknown; styles?: unknown }): [string, string][] {
  const out: [string, string][] = [];
  for (const [id, s] of Object.entries(resolveStyles(attrs))) {
    const color = s.color === SOFT_COLOR ? "var(--soft)" : (findColor(s.color)?.hex ?? "inherit");
    out.push(
      [`--s-${id}-font`, s.font.stack],
      [`--s-${id}-size`, `${s.size}pt`],
      [`--s-${id}-color`, color],
      [`--s-${id}-weight`, s.bold ? "700" : "400"],
      [`--s-${id}-style`, s.italic ? "italic" : "normal"],
      [`--s-${id}-lh`, String(s.lineHeight)],
      [`--s-${id}-before`, `${s.before}pt`],
      [`--s-${id}-after`, `${s.after}pt`],
    );
  }
  return out;
}
