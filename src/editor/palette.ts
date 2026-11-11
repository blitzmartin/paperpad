// Fixed sets of fonts, sizes and colors.
//
// Formatting is stored as a key from these lists (never as free CSS). That
// gives us three things: the document can only contain values we know how
// to render and export, pasted content cannot smuggle arbitrary styles in,
// and the page renders with CSS classes so the CSP can forbid inline styles.
//
// Every key here must have a matching class in src/styles/main.css
// (tests/palette.test.ts checks this).

export interface FontDef {
  key: string;
  label: string;
  /** Name written into RTF and DOCX exports. */
  name: string;
  /** RTF font family keyword. */
  rtfFamily: "swiss" | "roman" | "modern" | "script";
  /** CSS font stack, with fallbacks for systems that lack the font. */
  stack: string;
}

export const FONTS: readonly FontDef[] = [
  { key: "arial", label: "Arial", name: "Arial", rtfFamily: "swiss", stack: 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif' },
  { key: "verdana", label: "Verdana", name: "Verdana", rtfFamily: "swiss", stack: 'Verdana, "DejaVu Sans", sans-serif' },
  { key: "trebuchet", label: "Trebuchet MS", name: "Trebuchet MS", rtfFamily: "swiss", stack: '"Trebuchet MS", "Lucida Grande", "DejaVu Sans", sans-serif' },
  { key: "georgia", label: "Georgia", name: "Georgia", rtfFamily: "roman", stack: 'Georgia, "DejaVu Serif", serif' },
  { key: "times", label: "Times New Roman", name: "Times New Roman", rtfFamily: "roman", stack: '"Times New Roman", Times, "Liberation Serif", serif' },
  { key: "courier", label: "Courier New", name: "Courier New", rtfFamily: "modern", stack: '"Courier New", Courier, "Liberation Mono", monospace' },
  { key: "comic", label: "Comic Sans MS", name: "Comic Sans MS", rtfFamily: "script", stack: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive' },
];

/** Font of documents made before the default font could be chosen. */
export const DEFAULT_FONT = FONTS[0]!;

export const SIZES: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
export const DEFAULT_SIZE = 12;

/** Heading sizes in points, shared by the stylesheet and the exporters. */
export const HEADING_SIZES: Record<number, number> = { 1: 24, 2: 18, 3: 14 };

export interface ColorDef {
  key: string;
  label: string;
  hex: string;
}

// Mid-tone colors that stay readable on both the light and the dark paper.
export const COLORS: readonly ColorDef[] = [
  { key: "red", label: "Red", hex: "#D43B3B" },
  { key: "orange", label: "Orange", hex: "#DD7420" },
  { key: "amber", label: "Amber", hex: "#B8920A" },
  { key: "green", label: "Green", hex: "#2E9E4F" },
  { key: "teal", label: "Teal", hex: "#1C9696" },
  { key: "blue", label: "Blue", hex: "#2F6FDB" },
  { key: "navy", label: "Navy", hex: "#3A4FA8" },
  { key: "purple", label: "Purple", hex: "#8A4FD6" },
  { key: "magenta", label: "Magenta", hex: "#C63D9A" },
  { key: "brown", label: "Brown", hex: "#8B5A2B" },
  { key: "gray", label: "Gray", hex: "#7A7A7A" },
  { key: "black", label: "Black", hex: "#1A1A1A" },
];

// Highlights are pale; highlighted text is always drawn in dark ink.
export const HIGHLIGHTS: readonly ColorDef[] = [
  { key: "yellow", label: "Yellow", hex: "#FFF176" },
  { key: "lime", label: "Lime", hex: "#C5F29B" },
  { key: "cyan", label: "Cyan", hex: "#B3E5FC" },
  { key: "pink", label: "Pink", hex: "#F8BBD0" },
  { key: "peach", label: "Peach", hex: "#FFD8A8" },
  { key: "lavender", label: "Lavender", hex: "#D9CCF0" },
];

export const findFont = (key: unknown) => FONTS.find((f) => f.key === key);
/** A document's own default font (the doc node's font attribute). */
export const docFont = (key: unknown): FontDef => findFont(key) ?? DEFAULT_FONT;
export const findColor = (key: unknown) => COLORS.find((c) => c.key === key);
export const findHighlight = (key: unknown) => HIGHLIGHTS.find((c) => c.key === key);
export const isSize = (n: unknown): n is number => typeof n === "number" && SIZES.includes(n);

/** Closest allowed size for a pasted size in points. */
export function nearestSize(pt: number): number {
  let best = DEFAULT_SIZE;
  for (const s of SIZES) if (Math.abs(s - pt) < Math.abs(best - pt)) best = s;
  return best;
}

/** Maps a CSS font-family list to one of our fonts, if any name matches. */
export function fontFromCss(value: string): FontDef | undefined {
  const names = value.split(",").map((n) => n.trim().replace(/^['"]|['"]$/g, "").toLowerCase());
  for (const n of names) {
    const hit = FONTS.find((f) => f.name.toLowerCase() === n);
    if (hit) return hit;
  }
  return undefined;
}

/** Maps a pasted CSS color to a palette entry only on an exact match. */
export function colorFromCss(value: string, list: readonly ColorDef[]): ColorDef | undefined {
  const hex = cssColorToHex(value);
  return hex ? list.find((c) => c.hex.toUpperCase() === hex) : undefined;
}

function cssColorToHex(value: string): string | undefined {
  const v = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return "#" + m[1]!.toUpperCase();
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (m) {
    return (
      "#" +
      [m[1], m[2], m[3]]
        .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    );
  }
  return undefined;
}
