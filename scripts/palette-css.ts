// Prints the CSS classes for the palette. Paste the output between the
// "palette:start" and "palette:end" markers in src/styles/main.css whenever
// src/editor/palette.ts changes (tests/palette.test.ts will remind you).
// Run: node --experimental-strip-types scripts/palette-css.ts
import { COLORS, FONTS, HIGHLIGHTS, SIZES } from "../src/editor/palette.ts";

const stacks: Record<string, string> = {
  arial: 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif',
  verdana: 'Verdana, "DejaVu Sans", sans-serif',
  trebuchet: '"Trebuchet MS", "Lucida Grande", "DejaVu Sans", sans-serif',
  georgia: 'Georgia, "DejaVu Serif", serif',
  times: '"Times New Roman", Times, "Liberation Serif", serif',
  courier: '"Courier New", Courier, "Liberation Mono", monospace',
  comic: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive',
};

const out: string[] = [];
for (const f of FONTS) out.push(`.ff-${f.key} { font-family: ${stacks[f.key] ?? "inherit"}; }`);
for (const s of SIZES) out.push(`.doc .fs-${s} { font-size: ${s}pt; }`);
for (const c of COLORS) out.push(`.c-${c.key} { color: ${c.hex}; }`);
for (const c of HIGHLIGHTS) out.push(`.hl-${c.key} { background-color: ${c.hex}; color: #1d211f; }`);
for (const c of COLORS) out.push(`.sw-c-${c.key} { background-color: ${c.hex}; }`);
for (const c of HIGHLIGHTS) out.push(`.sw-hl-${c.key} { background-color: ${c.hex}; }`);
console.log(out.join("\n"));
